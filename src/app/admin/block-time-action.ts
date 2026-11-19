'use server';

import { revalidatePath } from 'next/cache';
import {
  reviewPractitionerBlock,
  savePractitionerBlock,
  type BlockError,
  type BlockFields,
  type BlockReview,
} from '@/server/admin/blocked-periods';
import { adminDependencies, requireAdmin } from '@/server/admin/context';
import { withoutQueryDetails } from '@/server/errors';

export type BlockDetails = Pick<BlockReview, 'practitionerName' | 'startsAt' | 'endsAt' | 'timeZone' | 'reason'>;

export type BlockState =
  | { step: 'edit'; fields: BlockFields; error?: BlockError }
  | { step: 'review'; fields: BlockFields; review: BlockReview; changed?: boolean }
  | { step: 'saved'; details: BlockDetails };

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export async function blockTimeAction(_previous: BlockState, form: FormData): Promise<BlockState> {
  await requireAdmin();
  const fields: BlockFields = {
    practitionerId: formText(form, 'practitionerId'),
    start: formText(form, 'start'),
    end: formText(form, 'end'),
    reason: formText(form, 'reason'),
  };
  const intent = form.get('intent');
  if (intent === 'edit' || intent === 'new') return { step: 'edit', fields };

  const { db, clock, log } = await adminDependencies();
  try {
    if (intent === 'save') {
      const result = await savePractitionerBlock(db, clock, fields, {
        id: formText(form, 'reviewId'),
        version: formText(form, 'reviewVersion'),
      });
      if (result.error) return { step: 'edit', fields, error: result.error };
      if (!result.saved) return { step: 'review', fields, review: result.review, changed: true };

      const { id, practitionerId, practitionerName, startsAt, endsAt, timeZone, reason } = result.review;
      log.info({ event: 'admin.time_blocked', block_id: id, practitioner_id: practitionerId }, 'Time blocked');
      revalidatePath('/slots');
      revalidatePath('/bookings/[bookingId]/reschedule', 'page');
      return { step: 'saved', details: { practitionerName, startsAt, endsAt, timeZone, reason } };
    }

    const result = await reviewPractitionerBlock(db, clock, fields);
    return result.error
      ? { step: 'edit', fields, error: result.error }
      : { step: 'review', fields, review: result.review };
  } catch (error) {
    log.error({ event: 'admin.block_time_failed' }, 'Could not block time');
    throw withoutQueryDetails(error);
  }
}
