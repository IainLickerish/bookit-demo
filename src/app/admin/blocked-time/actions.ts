'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requireAdmin } from '@/server/admin/context';
import { createBlockedTime, parseBlockedTime, removeBlockedTime } from '@/server/admin/blocked-time';
import { loadClinicSettings } from '@/server/settings';

export async function blockTimeAction(form: FormData): Promise<void> {
  await requireAdmin();
  const db = getDatabase();
  const settings = await loadClinicSettings(db);
  let input;
  try {
    input = parseBlockedTime(
      {
        practitionerId: form.get('practitionerId'),
        start: form.get('start'),
        end: form.get('end'),
        reason: form.get('reason'),
      },
      settings.timeZone,
    );
  } catch {
    redirect('/admin/blocked-time?error=invalid');
  }
  await createBlockedTime(db, getClock(), input);
  revalidatePath('/', 'layout');
  redirect('/admin/blocked-time?saved=1');
}

export async function removeBlockAction(form: FormData): Promise<void> {
  await requireAdmin();
  await removeBlockedTime(getDatabase(), String(form.get('id') ?? ''));
  revalidatePath('/', 'layout');
  redirect('/admin/blocked-time?removed=1');
}
