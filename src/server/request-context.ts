import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { getLogger, type Logger } from '@/lib/logger';
import { REQUEST_ID_HEADER, ROUTE_HEADER } from '@/lib/request-id';
import { findSessionUser, SESSION_COOKIE } from './auth/session';
import type { BookingDependencies } from './bookings/book';
import type { PublicUser } from './users';

/** The logger for the current request, carrying its request ID and route. */
export async function requestLogger(): Promise<Logger> {
  const incoming = await headers();
  return getLogger().child({
    request_id: incoming.get(REQUEST_ID_HEADER) ?? 'none',
    route: incoming.get(ROUTE_HEADER) ?? 'unknown',
  });
}

export async function bookingDependencies(): Promise<BookingDependencies> {
  return { db: getDatabase(), clock: getClock(), log: await requestLogger() };
}

export async function currentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  return findSessionUser(getDatabase(), getClock(), token);
}

/** The signed-in patient; anyone else is sent to the sign-in page. */
export async function requirePatient(): Promise<PublicUser> {
  const user = await currentUser();
  if (!user) {
    redirect('/auth/sign-in');
  }
  if (user.role !== 'patient') {
    redirect('/');
  }
  return user;
}

export async function secureCookies(): Promise<boolean> {
  return (await headers()).get('x-forwarded-proto') === 'https';
}
