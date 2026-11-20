import Link from 'next/link';
import { RESET_TOKEN_TTL_MINUTES } from '@/server/auth/password-reset';
import { single, type SearchParams } from '../../messages';
import { Notice } from '../../notice';
import { PageHeader } from '../../page-header';
import { requestPasswordResetAction } from '../password-reset-actions';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const sent = single((await searchParams).sent) === '1';
  return (
    <section className="page page-narrow card card-accent">
      <PageHeader title="Reset your password">
        {sent ? null : (
          <p>Enter the email address you sign in with and we will email you a link to reset your password.</p>
        )}
      </PageHeader>
      {sent ? (
        <Notice kind="notice" testId="forgot-password-sent">
          If an account uses that email address, we have sent it a link to reset the password. The link works for{' '}
          {RESET_TOKEN_TTL_MINUTES} minutes.
        </Notice>
      ) : null}
      <form action={requestPasswordResetAction} className="space-y-4">
        <label>
          Email address
          <input name="email" type="email" autoComplete="username" required data-testid="forgot-password-email" />
        </label>
        <button type="submit" className="button w-full" data-testid="forgot-password-submit">
          Email me a reset link
        </button>
      </form>
      <Link href="/auth/sign-in" className="text-action">
        Back to sign in
      </Link>
    </section>
  );
}
