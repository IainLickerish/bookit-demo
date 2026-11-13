'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { formatSlot } from '@/lib/time';
import {
  BlockedTimeError,
  confirmBlockedTime,
  reviewBlockedTime,
  type BlockedTimeInput,
} from '@/server/admin/blocked-time';
import { requireAdmin } from '@/server/admin/context';
import { withoutQueryDetails } from '@/server/errors';
import { requestLogger } from '@/server/request-context';
import { BLOCKED_TIME_MESSAGES } from '../../messages';

export interface BlockFormState {
  values: BlockedTimeInput;
  error?: string;
  preview?: {
    blockId: string;
    snapshot: string;
    practitionerName: string;
    start: string;
    end: string;
    timeZone: string;
    affected: { id: string; patientName: string; when: string; duration: number }[];
  };
}

export async function blockedTimeAction(_previous: BlockFormState, form: FormData): Promise<BlockFormState> {
  const staff = await requireAdmin();
  const db = getDatabase();
  const clock = getClock();
  const text = (key: string) => (typeof form.get(key) === 'string' ? String(form.get(key)) : '');
  const values = {
    practitionerId: text('practitionerId'),
    start: text('start'),
    end: text('end'),
    reason: text('reason'),
  };
  if (text('intent') === 'edit') return { values };
  let savedId: string | undefined;
  try {
    if (text('intent') === 'confirm') {
      savedId = await confirmBlockedTime(db, clock, staff.id, values, text('blockId'), text('snapshot'));
      const log = await requestLogger();
      log.info({ event: 'admin.blocked_time_saved', block_id: savedId }, 'Blocked time saved');
    } else {
      const checked = await reviewBlockedTime(db, clock, staff.id, values);
      return {
        values: checked.values,
        preview: {
          blockId: newId(clock),
          snapshot: checked.snapshot,
          practitionerName: checked.practitionerName,
          start: formatSlot(checked.startsAt, checked.timeZone),
          end: formatSlot(checked.endsAt, checked.timeZone),
          timeZone: checked.timeZone,
          affected: checked.affected.map((booking) => ({
            id: booking.id,
            patientName: booking.patientName,
            when: formatSlot(booking.startsAt, checked.timeZone),
            duration: (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
          })),
        },
      };
    }
  } catch (error) {
    if (error instanceof BlockedTimeError) return { values, error: BLOCKED_TIME_MESSAGES[error.code] };
    throw withoutQueryDetails(error);
  }
  revalidatePath('/', 'layout');
  redirect(`/admin/blocked-time?block=${savedId}&saved=1`);
}
