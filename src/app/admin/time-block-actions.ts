'use server';

import { redirect } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requireAdmin } from '@/server/admin/context';
import { saveTimeBlock, type TimeBlockErrorCode, type TimeBlockFields } from '@/server/admin/time-blocks';
import { withoutQueryDetails } from '@/server/errors';
import { requestLogger } from '@/server/request-context';

export interface TimeBlockFormError {
  error: TimeBlockErrorCode;
  field: keyof TimeBlockFields;
  values: TimeBlockFields;
  attempt: number;
}

export async function saveTimeBlockAction(
  filterQuery: string,
  previous: TimeBlockFormError | null,
  form: FormData,
): Promise<TimeBlockFormError> {
  await requireAdmin();
  const read = (name: keyof TimeBlockFields) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const values = {
    practitionerId: read('practitionerId'),
    startsAt: read('startsAt'),
    endsAt: read('endsAt'),
    reason: read('reason'),
  };
  const log = await requestLogger();
  let result: Awaited<ReturnType<typeof saveTimeBlock>>;
  try {
    result = await saveTimeBlock(getDatabase(), getClock(), values);
  } catch (error) {
    throw withoutQueryDetails(error);
  }
  if ('error' in result) return { ...result, values, attempt: (previous?.attempt ?? 0) + 1 };
  log.info({ event: 'admin.time_block_saved' }, 'Time block saved');
  const query = new URLSearchParams(filterQuery);
  query.set('timeBlock', result.id);
  redirect(`/admin?${query}#time-block-result`);
}
