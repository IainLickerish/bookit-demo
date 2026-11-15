'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requireAdmin } from '@/server/admin/context';
import { InvalidBlockError, saveBlockedPeriod, type BlockErrors, type BlockInput } from '@/server/admin/blocked-time';
import { withoutQueryDetails } from '@/server/errors';
import { requestLogger } from '@/server/request-context';
import { BLOCK_MESSAGES } from '../../messages';

export interface BlockFormState {
  values: BlockInput;
  errors: BlockErrors;
  message?: string;
}

export async function saveBlockedPeriodAction(_previous: BlockFormState, form: FormData): Promise<BlockFormState> {
  await requireAdmin();
  const log = await requestLogger();
  const text = (key: string) => (typeof form.get(key) === 'string' ? String(form.get(key)) : '');
  const values = {
    practitionerId: text('practitionerId'),
    start: text('start'),
    end: text('end'),
    reason: text('reason'),
  };
  let id: string;
  try {
    id = await saveBlockedPeriod(getDatabase(), getClock(), values);
  } catch (error) {
    if (error instanceof InvalidBlockError) return { values, errors: error.fields, message: BLOCK_MESSAGES.invalid };
    throw withoutQueryDetails(error);
  }
  log.info({ event: 'admin.blocked_period_saved' }, 'Blocked period saved');
  revalidatePath('/', 'layout');
  redirect(`/admin/blocked-time?saved=${id}`);
}
