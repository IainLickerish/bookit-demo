'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requireAdmin } from '@/server/admin/context';
import { BlockInputError, saveAdminBlock, type BlockField } from '@/server/admin/blocks';
import { withoutQueryDetails } from '@/server/errors';
import { requestLogger } from '@/server/request-context';
import { BLOCK_MESSAGES } from '../../messages';

export interface BlockFormState {
  field?: BlockField;
  error?: string;
}

export async function saveBlockAction(_state: BlockFormState, form: FormData): Promise<BlockFormState> {
  await requireAdmin();
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value : '';
  };
  const log = await requestLogger();
  let id: string;
  try {
    id = await saveAdminBlock(getDatabase(), getClock(), {
      practitionerId: text('practitionerId'),
      startsAt: text('startsAt'),
      endsAt: text('endsAt'),
      reason: text('reason'),
    });
  } catch (error) {
    if (error instanceof BlockInputError) return { field: error.field, error: BLOCK_MESSAGES[error.field] };
    throw withoutQueryDetails(error);
  }
  log.info({ event: 'admin.block_saved', block_id: id }, 'Blocked time saved');
  revalidatePath('/', 'layout');
  redirect('/admin/blocks?saved=1');
}
