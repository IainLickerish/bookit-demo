import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FORGOT_PASSWORD_PATH } from '@/lib/routes';
import { currentUser } from '@/server/request-context';
import { single, type SearchParams } from '../../messages';
import { Notice } from '../../notice';
import { PageHeader } from '../../page-header';
import { signIn } from '../actions';

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  if (await currentUser()) {
    redirect('/');
  }
  const query = await searchParams;
  const error = single(query.error);
  const passwordReset = single(query.notice) === 'password_reset';
  return (
    <section className="page page-narrow card card-accent">
      <PageHeader title="Sign in" />
      {passwordReset ? (
        <Notice kind="notice" testId="sign-in-notice">
          Your password has been changed. Sign in with your new password.
        </Notice>
      ) : null}
      {error === 'invalid' ? (
        <Notice kind="alert" testId="sign-in-error">
          The email address or password is not correct.
        </Notice>
      ) : null}
      <form action={signIn} className="space-y-4">
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
        <button type="submit" className="button w-full" data-testid="sign-in-submit">
          Sign in
        </button>
      </form>
      <Link href={FORGOT_PASSWORD_PATH} className="text-action" data-testid="forgot-password-link">
        Forgot your password?
      </Link>
    </section>
  );
}
