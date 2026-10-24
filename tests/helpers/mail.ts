import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import type { MailSettings } from '@/server/notifications/confirmation';
import { assertTestAddress, type Mailer, type OutgoingEmail } from '@/server/notifications/mailer';

export const TEST_MAIL_FROM = 'noreply@clinic.example.test';

export interface RecordingMailer extends Mailer {
  sent: OutgoingEmail[];
}

/** Keeps every email in memory; applies the same .test address rule as the real mailers. */
export function recordingMailer(): RecordingMailer {
  const sent: OutgoingEmail[] = [];
  return {
    kind: 'recording',
    sent,
    send: async (email) => {
      assertTestAddress(email.from, 'sender');
      assertTestAddress(email.to, 'recipient');
      sent.push(email);
      return { messageId: `<recorded-${sent.length}@test>` };
    },
  };
}

export function testMail(mailer: Mailer = recordingMailer()): MailSettings {
  return { mailer, from: TEST_MAIL_FROM };
}

export interface ReceivedMessage {
  from: string;
  to: string[];
  raw: string;
}

export interface SmtpReceiver {
  url: string;
  messages: ReceivedMessage[];
  /** Calls `listener` for each message accepted from now on. */
  onMessage(listener: (message: ReceivedMessage) => void): void;
  stop(): Promise<void>;
}

/** A local SMTP server standing in for Mailpit; nothing leaves the machine. */
export async function startSmtpReceiver(): Promise<SmtpReceiver> {
  const messages: ReceivedMessage[] = [];
  const listeners: ((message: ReceivedMessage) => void)[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, session, callback) {
      let raw = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => (raw += chunk));
      stream.on('end', () => {
        const from = session.envelope.mailFrom === false ? '' : session.envelope.mailFrom.address;
        const message = { from, to: session.envelope.rcptTo.map((r) => r.address), raw };
        messages.push(message);
        listeners.forEach((listener) => listener(message));
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.server.address() as AddressInfo;
  return {
    url: `smtp://127.0.0.1:${port}`,
    messages,
    onMessage: (listener) => listeners.push(listener),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
