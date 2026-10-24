import type { OutgoingEmail } from './mailer';

export interface PasswordResetEmailInput {
  to: string;
  name: string;
  clinicName: string;
  /** The reset link, `<BOOKIT_PUBLIC_URL>/auth/reset-password/<token>`. */
  link: string;
  validMinutes: number;
  from: string;
}

/** The only place the reset link appears: the user's own inbox. */
export function composePasswordResetEmail(input: PasswordResetEmailInput): OutgoingEmail {
  const lines = [
    `Dear ${input.name},`,
    '',
    `Someone asked to reset the password for your ${input.clinicName} account.`,
    `To choose a new password, open this link within ${input.validMinutes} minutes:`,
    '',
    input.link,
    '',
    'The link works once. If you did not ask for this, ignore this email: your password stays the same.',
    '',
    input.clinicName,
  ];
  return {
    from: input.from,
    to: input.to,
    subject: `Reset your ${input.clinicName} password`,
    text: `${lines.join('\n')}\n`,
  };
}
