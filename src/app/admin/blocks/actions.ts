'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requireAdmin } from '@/server/admin/context';
import { TimeBlockInputError, type BlockFieldErrors, type TimeBlockValues } from '@/server/admin/time-block-input';
import { saveTimeBlock } from '@/server/admin/time-blocks';
import { withoutQueryDetails } from '@/server/errors';
import { requestLogger } from '@/server/request-context';

export interface BlockFormState {
  values: TimeBlockValues;
  errors: BlockFieldErrors;
}

export async function saveBlockAction(_previous: BlockFormState, form: FormData): Promise<BlockFormState> {
  await requireAdmin();
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value : '';
  };
  const values = {
    practitionerId: text('practitionerId'),
    start: text('start'),
    end: text('end'),
    reason: text('reason'),
  };
  const log = await requestLogger();
  let id: string;
  try {
    id = await saveTimeBlock(getDatabase(), getClock(), values);
  } catch (error) {
    if (error instanceof TimeBlockInputError) return { values, errors: error.fields };
    throw withoutQueryDetails(error);
  }
  log.info({ event: 'admin.time_block_saved', block_id: id }, 'Blocked time saved');
  revalidatePath('/admin/blocks');
  revalidatePath('/slots');
  redirect(`/admin/blocks?saved=${id}`);
}
