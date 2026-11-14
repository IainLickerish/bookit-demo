import { cookies } from 'next/headers';
import { secureCookies } from '@/server/request-context';

export const CONFIRMATION_COOKIE = 'bookit_confirmation';

/** Keep the existing confirmation URL while identifying the booking just saved. */
export async function rememberConfirmation(bookingId: string): Promise<void> {
  (await cookies()).set(CONFIRMATION_COOKIE, bookingId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await secureCookies(),
    path: '/bookings',
    maxAge: 300,
  });
}
