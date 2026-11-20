'use server';

import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { formatSlot } from '@/lib/time';
import { requireAdmin } from '@/server/admin/context';
import type { TimeBlockFields } from '@/server/admin/time-block-input';
import { submitTimeBlock, type TimeBlockConfirmation } from '@/server/admin/time-blocks';
import { withoutQueryDetails } from '@/server/errors';
import { requestLogger } from '@/server/request-context';
import { TIME_BLOCK_MESSAGES } from '../../messages';

type SessionDetails = {
  id: string;
  patientName: string;
  patientEmail: string;
  phone: string | null;
  start: string;
  end: string;
};

export type TimeBlockFormState =
  | { step: 'edit'; fields: TimeBlockFields; error?: string }
  | {
      step: 'review';
      fields: TimeBlockFields;
      confirmation: TimeBlockConfirmation;
      changed: boolean;
      practitionerName: string;
      start: string;
      end: string;
      reason: string | null;
      timeZone: string;
      bookings: SessionDetails[];
    }
  | { step: 'saved' };

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export async function timeBlockAction(previous: TimeBlockFormState, form: FormData): Promise<TimeBlockFormState> {
  await requireAdmin();
  const intent = form.get('intent');
  if (intent === 'edit' && previous?.step === 'review') return { step: 'edit', fields: previous.fields };
  const reviewed = intent === 'save' && previous?.step === 'review' ? previous : undefined;
  const fields = reviewed?.fields ?? {
    practitionerId: formText(form, 'practitionerId'),
    startsAt: formText(form, 'startsAt'),
    endsAt: formText(form, 'endsAt'),
    reason: formText(form, 'reason'),
  };
  const log = await requestLogger();
  try {
    const result = await submitTimeBlock(getDatabase(), getClock(), fields, reviewed?.confirmation);
    if (result.status === 'saved') {
      log.info({ event: 'admin.time_block_saved', time_block_id: result.id }, 'Time block saved');
      return { step: 'saved' };
    }
    if (result.status !== 'review') {
      return { step: 'edit', fields, error: TIME_BLOCK_MESSAGES[result.status] };
    }
    const { confirmation, block, timeZone, changed, practitionerName, bookings } = result;
    return {
      step: 'review',
      fields,
      confirmation,
      changed,
      practitionerName,
      start: formatSlot(block.startsAt, timeZone),
      end: formatSlot(block.endsAt, timeZone),
      reason: block.reason,
      timeZone,
      bookings: bookings.map(({ startsAt, endsAt, ...booking }) => ({
        ...booking,
        start: formatSlot(startsAt, timeZone),
        end: formatSlot(endsAt, timeZone),
      })),
    };
  } catch (error) {
    log.error({ event: 'admin.time_block_failed' }, 'Time block action failed');
    throw withoutQueryDetails(error);
  }
}
