import Link from 'next/link';
import { RESET_TOKEN_TTL_MINUTES } from '@/server/auth/password-reset';
import { single, type SearchParams } from '../../messages';
import { requestPasswordResetAction } from '../password-reset-actions';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const sent = single((await searchParams).sent) === '1';
  return (
    <section className="card account-card" data-testid="account-card">
      <header className="page-header" data-testid="client-page-header">
        <h1>Reset your password</h1>
      </header>
      {sent ? (
        <p role="status" className="notice" data-testid="forgot-password-sent">
          If an account uses that email address, we have sent it a link to reset the password. The link works for{' '}
          {RESET_TOKEN_TTL_MINUTES} minutes.
        </p>
      ) : (
        <p className="mb-4">
          Enter the email address you sign in with and we will email you a link to reset your password.
        </p>
      )}
      <form action={requestPasswordResetAction} className="form-stack">
        <label>
          Email address
          <input name="email" type="email" autoComplete="username" required data-testid="forgot-password-email" />
        </label>
        <button type="submit" className="button" data-testid="forgot-password-submit">
          Email me a reset link
        </button>
      </form>
      <p className="account-links">
        <Link href="/auth/sign-in">Back to sign in</Link>
      </p>
    </section>
  );
}
