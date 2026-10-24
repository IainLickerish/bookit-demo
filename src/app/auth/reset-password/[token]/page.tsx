import type { Metadata } from 'next';
import Link from 'next/link';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { FORGOT_PASSWORD_PATH } from '@/lib/routes';
import { runtimeIdentity } from '@/lib/runtime-identity';
import { isResetTokenUsable } from '@/server/auth/password-reset';
import { MIN_PASSWORD_LENGTH } from '@/server/auth/password';
import { requestLogger } from '@/server/request-context';
import { single, type SearchParams } from '../../../messages';
import { completePasswordResetAction } from '../../password-reset-actions';

// The token is in this page's URL: never send it to another site as a Referer.
export const metadata: Metadata = { referrer: 'no-referrer' };

const ERRORS: Record<string, string> = {
  mismatch: 'The two passwords do not match.',
  weak_password: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
};

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: SearchParams;
}) {
  const { token } = await params;
  const usable = await isResetTokenUsable(
    { db: getDatabase(), clock: getClock(), log: await requestLogger(), tenant: runtimeIdentity().tenant },
    token,
  );
  if (!usable) {
    return (
      <section className="max-w-sm">
        <h1>Reset your password</h1>
        <p role="alert" className="alert" data-testid="reset-password-invalid">
          This reset link has expired or has already been used.
        </p>
        <p>
          <Link href={FORGOT_PASSWORD_PATH}>Request a new link</Link>
        </p>
      </section>
    );
  }
  const error = single((await searchParams).error);
  const message = error !== undefined && Object.hasOwn(ERRORS, error) ? ERRORS[error] : null;
  return (
    <section className="max-w-sm">
      <h1>Choose a new password</h1>
      {message ? (
        <p role="alert" className="alert" data-testid="reset-password-error">
          {message}
        </p>
      ) : null}
      <form action={completePasswordResetAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <label>
          New password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            data-testid="reset-password-new"
          />
        </label>
        <label>
          Repeat the new password
          <input
            name="confirmation"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            data-testid="reset-password-confirm"
          />
        </label>
        <button type="submit" className="button" data-testid="reset-password-submit">
          Set new password
        </button>
      </form>
    </section>
  );
}
