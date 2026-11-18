'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { adminDependencies, requireAdmin } from '@/server/admin/context';
import { createTimeBlock } from '@/server/admin/time-blocks';
import { TimeBlockInputError, type TimeBlockErrorCode } from '@/server/admin/time-block-input';
import { SESSION_COOKIE } from '@/server/auth/session';
import { withoutQueryDetails } from '@/server/errors';

export interface TimeBlockFormState {
  error?: TimeBlockErrorCode;
  saved?: boolean;
}

export async function saveTimeBlockAction(_previous: TimeBlockFormState, form: FormData): Promise<TimeBlockFormState> {
  await requireAdmin();
  const deps = await adminDependencies();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    await createTimeBlock(deps, token, {
      practitionerId: form.get('practitionerId'),
      start: form.get('start'),
      end: form.get('end'),
      reason: form.get('reason'),
    });
  } catch (error) {
    if (error instanceof TimeBlockInputError) return { error: error.code };
    throw withoutQueryDetails(error);
  }
  revalidatePath('/admin');
  revalidatePath('/slots');
  return { saved: true };
}
