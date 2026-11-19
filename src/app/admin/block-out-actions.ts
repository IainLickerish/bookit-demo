'use server';

import { adminDependencies, requireAdmin } from '@/server/admin/context';
import { saveBlockOut, type BlockOutErrorCode, type SavedBlockOut } from '@/server/admin/block-outs';
import { withoutQueryDetails } from '@/server/errors';
import { formText } from '../form-data';

interface BlockOutFormValues {
  practitionerId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export interface BlockOutFormState {
  attempt: number;
  timeZone?: string;
  values?: BlockOutFormValues;
  error?: BlockOutErrorCode;
  saved?: SavedBlockOut;
}

export async function saveBlockOutAction(previous: BlockOutFormState, form: FormData): Promise<BlockOutFormState> {
  await requireAdmin();
  const { db, clock, log } = await adminDependencies();
  const values = {
    practitionerId: formText(form, 'practitionerId'),
    startsAt: formText(form, 'startsAt'),
    endsAt: formText(form, 'endsAt'),
    reason: formText(form, 'reason'),
  };
  const attempt = previous.attempt + 1;
  try {
    const result = await saveBlockOut(db, clock, { ...values, timeZone: formText(form, 'timeZone') });
    if ('error' in result) return { attempt, error: result.error, timeZone: result.timeZone, values };
    log.info({ event: 'admin.block_out_saved', block_out_id: result.saved.id }, 'Block-out saved');
    return { attempt, saved: result.saved, timeZone: result.saved.timeZone };
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
