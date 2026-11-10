import { emailHash, type Logger } from '@/lib/logger';
import { reportError } from '../error-reporting';
import { getMailer, type Mailer, type OutgoingEmail } from './mailer';

export interface MailSettings {
  mailer: Mailer;
  /** The clinic's sender address, from BOOKIT_MAIL_FROM. */
  from: string;
}

/** The sender when BOOKIT_MAIL_FROM is unset; each tenant's container sets its own (plan 12.3 article 05). */
const DEFAULT_MAIL_FROM = 'noreply@bookit.test';

export function mailSettings(): MailSettings {
  return { mailer: getMailer(), from: (process.env.BOOKIT_MAIL_FROM ?? '').trim() || DEFAULT_MAIL_FROM };
}

export type EmailKind = 'confirmation' | 'password_reset' | 'reminder';

/**
 * Sends one email and logs `email.<kind>.sent` or `email.<kind>.failed` with
 * a hashed recipient and the given references, never the address or body.
 * A failure is reported and returned as false, never thrown, so it cannot
 * undo the operation that asked for the email.
 */
export async function deliverEmail(
  mail: MailSettings,
  log: Logger,
  email: OutgoingEmail,
  kind: EmailKind,
  refs: Record<string, string> = {},
): Promise<boolean> {
  const fields = { ...refs, recipient_hash: emailHash(email.to), mailer: mail.mailer.kind };
  try {
    const sent = await mail.mailer.send(email);
    log.info(
      { event: `email.${kind}.sent`, ...fields, message_id: sent.messageId },
      mail.mailer.kind === 'disabled' ? 'Email not sent: no SMTP server configured' : 'Email sent',
    );
    return true;
  } catch (error) {
    log.error(
      { event: `email.${kind}.failed`, ...fields, error_name: error instanceof Error ? error.name : 'unknown' },
      'Email failed',
    );
    reportError(error, { operation: `${kind}_email` });
    return false;
  }
}
