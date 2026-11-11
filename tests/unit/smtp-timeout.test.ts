import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { createSmtpMailer } from '@/server/notifications/mailer';
import { TEST_MAIL_FROM } from '../helpers/mail';
import { startStalledSmtp } from '../helpers/stalled-smtp';

it.each(['greeting', 'delivery'] as const)(
  'closes a stalled SMTP %s connection promptly',
  async (stage) => {
    const smtp = await startStalledSmtp(stage);
    try {
      const started = performance.now();
      // Attach the rejection assertion before waiting for the server, so even a
      // connection failure is handled and reported by the test.
      const delivery = expect(
        createSmtpMailer(smtp.url).send({
          from: TEST_MAIL_FROM,
          to: 'patient@clinic.test',
          subject: 'Appointment reminder',
          text: 'Your appointment is tomorrow.',
        }),
      ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
      await smtp.stalled;
      await delivery;
      await smtp.disconnected;
      expect(performance.now() - started).toBeLessThan(5_000);
    } finally {
      await smtp.stop();
    }
  },
  8_000,
);
