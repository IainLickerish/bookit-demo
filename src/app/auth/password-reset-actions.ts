'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { FORGOT_PASSWORD_PATH, resetPasswordPath } from '@/lib/routes';
import { publicBaseUrl, runtimeIdentity } from '@/lib/runtime-identity';
import { completePasswordReset, requestPasswordReset, type ResetOutcome } from '@/server/auth/password-reset';
import { getPasswordResetLimiter } from '@/server/auth/rate-limit';
import { withoutQueryDetails } from '@/server/errors';
import { deliverEmail } from '@/server/notifications/deliver';
import { clientIp, mailSettings, requestLogger } from '@/server/request-context';

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const log = await requestLogger();
  const mail = mailSettings();
  try {
    const result = await requestPasswordReset(
      {
        db: getDatabase(),
        clock: getClock(),
        log,
        tenant: runtimeIdentity().tenant,
        limiter: getPasswordResetLimiter(),
        publicUrl: publicBaseUrl(),
        mailFrom: mail.from,
      },
      { email: formText(formData, 'email'), clientIp: await clientIp() },
    );
    const email = result.email;
    if (email) {
      // Sent after the response, so answering takes the same time whether or
      // not the account exists.
      after(() => deliverEmail(mail, log, email, 'password_reset'));
    }
  } catch (error) {
    throw withoutQueryDetails(error);
  }
  // The same page for every outcome: it never says whether the account exists.
  redirect(`${FORGOT_PASSWORD_PATH}?sent=1`);
}

export async function completePasswordResetAction(formData: FormData): Promise<void> {
  const token = formText(formData, 'token');
  let outcome: ResetOutcome;
  try {
    outcome = await completePasswordReset(
      { db: getDatabase(), clock: getClock(), log: await requestLogger(), tenant: runtimeIdentity().tenant },
      { token, password: formText(formData, 'password'), confirmation: formText(formData, 'confirmation') },
    );
  } catch (error) {
    throw withoutQueryDetails(error);
  }
  if (outcome === 'reset') {
    redirect('/auth/sign-in?notice=password_reset');
  }
  redirect(`${resetPasswordPath(token)}?error=${outcome}`);
}
