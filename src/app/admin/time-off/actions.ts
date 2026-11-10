'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requireAdmin } from '@/server/admin/context';
import { createTimeOff, deleteTimeOff, TimeOffInputRejected } from '@/server/admin/time-off';
import { requestLogger } from '@/server/request-context';

const PATH = '/admin/time-off';

function field(form: FormData, name: string): unknown {
  const value = form.get(name);
  return typeof value === 'string' ? value : undefined;
}

export async function addTimeOffAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const log = await requestLogger();
  let outcome: string;
  try {
    const created = await createTimeOff(getDatabase(), getClock(), admin.id, {
      practitionerId: field(form, 'practitionerId'),
      start: field(form, 'start'),
      end: field(form, 'end'),
      reason: field(form, 'reason') ?? '',
    });
    // The reason may describe a practitioner's health, so it is never logged.
    log.info(
      {
        event: 'admin.time_off_created',
        time_off_id: created.id,
        affected_booking_count: created.affectedBookings.length,
      },
      'Practitioner time off recorded',
    );
    outcome = `created=${created.id}`;
  } catch (error) {
    if (error instanceof TimeOffInputRejected) {
      outcome = `error=${error.code}`;
    } else {
      log.error({ event: 'admin.time_off_failed' }, 'Practitioner time off could not be saved');
      outcome = 'error=unavailable';
    }
  }
  revalidatePath('/', 'layout');
  redirect(`${PATH}?${outcome}`);
}

export async function removeTimeOffAction(form: FormData): Promise<void> {
  await requireAdmin();
  const log = await requestLogger();
  const id = field(form, 'timeOffId');
  let outcome = 'removed=1';
  try {
    const removed = typeof id === 'string' && (await deleteTimeOff(getDatabase(), id));
    if (removed) log.info({ event: 'admin.time_off_removed', time_off_id: id }, 'Practitioner time off removed');
    else outcome = 'error=not_found';
  } catch {
    log.error({ event: 'admin.time_off_failed' }, 'Practitioner time off could not be removed');
    outcome = 'error=unavailable';
  }
  revalidatePath('/', 'layout');
  redirect(`${PATH}?${outcome}`);
}
