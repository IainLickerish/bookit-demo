import nodemailer, { type NodemailerError } from 'nodemailer';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SentEmail {
  /** Message-ID assigned by the SMTP transport, or null when nothing was sent. */
  messageId: string | null;
}

export interface Mailer {
  /** `smtp` sends through BOOKIT_SMTP_URL; `disabled` sends nothing; `recording` is for tests. */
  readonly kind: 'smtp' | 'disabled' | 'recording';
  send(email: OutgoingEmail, options?: { singleAttempt: true }): Promise<SentEmail>;
}

export class EmailAddressRefusedError extends Error {
  override readonly name = 'EmailAddressRefusedError';
}

const REMINDER_SMTP_TIMEOUT_MS = 5_000;

/** True only for transient errors that establish the message was never accepted. */
export function canRetryEmail(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code, command, syscall, responseCode } = error as NodemailerError;
  if (code === 'EDNS' || (command === 'CONN' && syscall === 'connect')) return true;
  // Nodemailer also uses ETIMEDOUT after DATA. Only these two errors are
  // issued before the SMTP greeting.
  if (command === 'CONN' && code === 'ETIMEDOUT') {
    return error.message === 'Connection timeout' || error.message === 'Greeting never received';
  }
  // A completed SMTP rejection is different from a timeout or a lost reply after DATA.
  return (
    (code === 'EENVELOPE' || code === 'EMESSAGE') &&
    responseCode !== undefined &&
    responseCode >= 400 &&
    responseCode < 500
  );
}

// BookIt is fictional (brief 18): every address it sends from or to is on a
// .test domain, so no email can ever reach a real mailbox, whatever the SMTP
// server is.
const TEST_DOMAIN_ADDRESS = /^[^\s@<>]+@([a-z0-9-]+\.)*[a-z0-9-]+\.test$/i;

export function assertTestAddress(address: string, role: 'sender' | 'recipient'): void {
  if (!TEST_DOMAIN_ADDRESS.test(address)) {
    throw new EmailAddressRefusedError(`Refusing to send: the ${role} address is not on a .test domain.`);
  }
}

export const disabledMailer: Mailer = {
  kind: 'disabled',
  send: async (email) => {
    assertTestAddress(email.from, 'sender');
    assertTestAddress(email.to, 'recipient');
    return { messageId: null };
  },
};

/** Sends through an SMTP server such as Mailpit (`smtp://mailpit:1025`). */
export function createSmtpMailer(url: string): Mailer {
  const transport = nodemailer.createTransport(url);
  let singleAttemptTransport: typeof transport | undefined;
  return {
    kind: 'smtp',
    async send(email, options) {
      assertTestAddress(email.from, 'sender');
      assertTestAddress(email.to, 'recipient');
      let selected = transport;
      if (options?.singleAttempt) {
        if (!singleAttemptTransport) {
          const smtp = new URL(url);
          // A pooled transport can requeue a message when its connection drops.
          smtp.searchParams.set('pool', 'false');
          // Let Nodemailer close the connection on timeout before the caller
          // releases its locks. Honour any shorter configured timeouts.
          for (const key of ['dnsTimeout', 'connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
            const timeout = Number(smtp.searchParams.get(key));
            smtp.searchParams.set(
              key,
              String(timeout > 0 ? Math.min(timeout, REMINDER_SMTP_TIMEOUT_MS) : REMINDER_SMTP_TIMEOUT_MS),
            );
          }
          singleAttemptTransport = nodemailer.createTransport(smtp.href);
        }
        selected = singleAttemptTransport;
      }
      const info = await selected.sendMail(email);
      return { messageId: info.messageId };
    },
  };
}

export function mailerFromEnv(env: Readonly<Record<string, string | undefined>>): Mailer {
  const url = (env.BOOKIT_SMTP_URL ?? '').trim();
  return url === '' ? disabledMailer : createSmtpMailer(url);
}

const MAILER_KEY = Symbol.for('bookit.mailer');

export function getMailer(): Mailer {
  const holder = globalThis as { [MAILER_KEY]?: Mailer };
  holder[MAILER_KEY] ??= mailerFromEnv(process.env);
  return holder[MAILER_KEY];
}
