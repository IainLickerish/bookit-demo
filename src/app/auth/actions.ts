'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { authenticate, createSession, deleteSession, SESSION_COOKIE, SESSION_TTL_HOURS } from '@/server/auth/session';
import { withoutQueryDetails } from '@/server/errors';
import { requestLogger, secureCookies } from '@/server/request-context';

export async function signIn(formData: FormData): Promise<void> {
  const email = formData.get('email');
  const password = formData.get('password');
  if (typeof email !== 'string' || typeof password !== 'string' || password === '') {
    redirect('/auth/sign-in?error=invalid');
  }
  const log = await requestLogger();
  let destination: string;
  try {
    const db = getDatabase();
    const user = await authenticate(db, email, password);
    if (!user) {
      log.info({ event: 'auth.sign_in.failed' }, 'Sign-in failed');
      destination = '/auth/sign-in?error=invalid';
    } else {
      const session = await createSession(db, getClock(), user.id);
      // maxAge rather than an absolute expiry: a test-clock build's virtual
      // time can be far from the browser's clock. The server enforces expiry.
      (await cookies()).set(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: await secureCookies(),
        path: '/',
        maxAge: SESSION_TTL_HOURS * 60 * 60,
      });
      log.info({ event: 'auth.sign_in.succeeded', user_id: user.id, role: user.role }, 'Signed in');
      destination = user.role === 'patient' ? '/bookings' : '/';
    }
  } catch (error) {
    throw withoutQueryDetails(error);
  }
  redirect(destination);
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await deleteSession(getDatabase(), token);
    } catch (error) {
      throw withoutQueryDetails(error);
    }
  }
  store.delete(SESSION_COOKIE);
  (await requestLogger()).info({ event: 'auth.signed_out' }, 'Signed out');
  redirect('/auth/sign-in');
}
