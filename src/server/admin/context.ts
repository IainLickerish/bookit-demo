import { redirect } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { currentUser, requestLogger } from '@/server/request-context';
import type { AdminReportDependencies } from './http';

export async function adminDependencies(): Promise<AdminReportDependencies> {
  return { db: getDatabase(), clock: getClock(), log: await requestLogger() };
}

export async function requireAdmin() {
  const user = await currentUser();
  if (!user) redirect('/auth/sign-in');
  if (user.role !== 'admin') redirect('/bookings');
  return user;
}
