import { createConnection } from 'node:net';
import nodemailer from 'nodemailer';
import { parseConnectionUrl } from 'nodemailer/lib/shared';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface SentEmail {
  /** Message-ID assigned by the SMTP transport, or null when nothing was sent. */
  messageId: string | null;
}

export interface Mailer {
  /** `smtp` sends through BOOKIT_SMTP_URL; `disabled` sends nothing; `recording` is for tests. */
  readonly kind: 'smtp' | 'disabled' | 'recording';
  send(email: OutgoingEmail): Promise<SentEmail>;
}

export class EmailAddressRefusedError extends Error {
  override readonly name = 'EmailAddressRefusedError';
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

/** The reminder deadline closes the SMTP socket, including while waiting for acceptance. */
function boundedSmtpTransport(url: string, timeoutMs: number) {
  return nodemailer.createTransport({
    ...parseConnectionUrl(url),
    pool: false,
    proxy: undefined,
    getSocket({ host, port, secure, localAddress }, callback) {
      const connection = createConnection({
        host: host ?? 'localhost',
        port: Number(port) || (secure ? 465 : 587),
        localAddress,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const connectionFailed = (error: Error) => callback(error);
      connection.once('error', connectionFailed);
      connection.once('connect', () => {
        connection.removeListener('error', connectionFailed);
        callback(null, { connection });
      });
    },
  });
}

/** Sends through an SMTP server such as Mailpit (`smtp://mailpit:1025`). */
export function createSmtpMailer(url: string, timeoutMs?: number): Mailer {
  const transport = timeoutMs === undefined ? nodemailer.createTransport(url) : boundedSmtpTransport(url, timeoutMs);
  return {
    kind: 'smtp',
    async send(email) {
      assertTestAddress(email.from, 'sender');
      assertTestAddress(email.to, 'recipient');
      const info = await transport.sendMail(email);
      return { messageId: info.messageId };
    },
  };
}

export function mailerFromEnv(env: Readonly<Record<string, string | undefined>>, timeoutMs?: number): Mailer {
  const url = (env.BOOKIT_SMTP_URL ?? '').trim();
  return url === '' ? disabledMailer : createSmtpMailer(url, timeoutMs);
}

const MAILER_KEY = Symbol.for('bookit.mailer');

export function getMailer(): Mailer {
  const holder = globalThis as { [MAILER_KEY]?: Mailer };
  holder[MAILER_KEY] ??= mailerFromEnv(process.env);
  return holder[MAILER_KEY];
}
