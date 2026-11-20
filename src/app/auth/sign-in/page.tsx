import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FORGOT_PASSWORD_PATH, signInBookingDestination } from '@/lib/routes';
import { currentUser } from '@/server/request-context';
import { single, type SearchParams } from '../../messages';
import { signIn } from '../actions';

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const next = signInBookingDestination(query.next);
  const user = await currentUser();
  if (user) {
    redirect(user.role === 'patient' && next ? next : '/');
  }
  const error = single(query.error);
  const passwordReset = single(query.notice) === 'password_reset';
  return (
    <section className="max-w-sm">
      <h1>Sign in</h1>
      {passwordReset ? (
        <p role="status" className="notice" data-testid="sign-in-notice">
          Your password has been changed. Sign in with your new password.
        </p>
      ) : null}
      {error === 'invalid' ? (
        <p role="alert" className="alert" data-testid="sign-in-error">
          The email address or password is not correct.
        </p>
      ) : null}
      <form action={signIn} className="space-y-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <label>
          Email address
          <input name="email" type="email" autoComplete="username" required data-testid="sign-in-email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            data-testid="sign-in-password"
          />
        </label>
        <button type="submit" className="button" data-testid="sign-in-submit">
          Sign in
        </button>
      </form>
      <p className="mt-4">
        <Link href={FORGOT_PASSWORD_PATH} data-testid="forgot-password-link">
          Forgot your password?
        </Link>
      </p>
    </section>
  );
}
