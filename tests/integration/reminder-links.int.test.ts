import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn } from '@/app/auth/actions';
import SignInPage from '@/app/auth/sign-in/page';
import MyBookingsPage from '@/app/bookings/page';
import { addHours, formatSlot } from '@/lib/time';
import { bookSlot } from '@/server/bookings/book';
import type { BookingView } from '@/server/bookings/queries';
import { sendDueReminders } from '@/server/notifications/reminders';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, TEST_PASSWORD, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

const baseUrl = new URL('https://clinic.example.test');
const clock = manualClock('2026-10-20T07:00:00Z');
const cookies = new Map<string, { value: string }>();
let database: TestDatabase;
let clinic: SeededClinic;
let booking: BookingView;
let reminderText: string;

vi.mock(import('@/db/client'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDatabase: () => database.db,
}));

vi.mock(import('@/lib/clock'), async (importOriginal) => ({
  ...(await importOriginal()),
  getClock: () => clock,
}));

// Supply the request cookies and headers that Next provides when rendering a route.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookies.get(name),
    set: (name: string, value: string) => cookies.set(name, { value }),
  }),
  headers: async () => new Headers(),
}));

beforeAll(async () => {
  database = await startTestDatabase();
  clinic = await seedClinic(database.db, clock, { settings: { reminderEmailsEnabled: true } });
  const [slot] = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: addHours(clock.now(), 25),
    until: addHours(clock.now(), 72),
  });
  if (!slot) throw new Error('No test slot for a reminder');
  const deps = { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() };
  booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slot.id });
  const mailer = recordingMailer();
  clock.set(addHours(booking.startsAt, -24));
  await sendDueReminders({ ...deps, mail: testMail(mailer) }, baseUrl);
  expect(mailer.sent).toHaveLength(1);
  reminderText = mailer.sent[0]!.text;
});

beforeEach(() => cookies.clear());

afterAll(async () => {
  await database?.stop();
});

async function expectRedirect(result: Promise<unknown>, destination: string) {
  await expect(result).rejects.toMatchObject({ digest: expect.stringContaining(`;${destination};`) });
}

describe('reminder routes in My bookings', () => {
  it.each(['reschedule', 'cancel'] as const)(
    'requires sign-in and serves only the booking owner for the %s email link',
    async (action) => {
      const label = action === 'reschedule' ? 'Reschedule your session' : 'Cancel your session';
      const line = reminderText.split('\n').find((entry) => entry.startsWith(`${label}: `));
      if (!line) throw new Error(`The reminder is missing its ${action} link`);
      const link = new URL(line.slice(label.length + 2));
      expect(link.pathname).toBe('/bookings');
      const path = link.pathname + link.search;
      const linkRequest = { searchParams: Promise.resolve(Object.fromEntries(link.searchParams)) };
      const signInQuery = new URLSearchParams({ returnTo: path });
      await expectRedirect(MyBookingsPage(linkRequest), `/auth/sign-in?${signInQuery}`);

      const signInPage = renderToStaticMarkup(
        await SignInPage({ searchParams: Promise.resolve(Object.fromEntries(signInQuery)) }),
      );
      const returnTo = /name="returnTo" value="([^"]+)"/.exec(signInPage)?.[1]?.replaceAll('&amp;', '&');
      expect(returnTo).toBe(path);

      async function signInFromLink(email: string) {
        const form = new FormData();
        form.set('email', email);
        form.set('password', TEST_PASSWORD);
        form.set('returnTo', returnTo!);
        await expectRedirect(signIn(form), path);
      }

      await signInFromLink(clinic.patient1.email);
      await expectRedirect(MyBookingsPage(linkRequest), `/bookings#${action}-${booking.id}`);
      const ownerPage = renderToStaticMarkup(await MyBookingsPage({ searchParams: Promise.resolve({}) }));
      expect(ownerPage).toContain(`data-booking-id="${booking.id}"`);
      expect(ownerPage).toContain(`id="${action}-${booking.id}"`);

      cookies.clear();
      await signInFromLink(clinic.patient2.email);
      const otherPage = renderToStaticMarkup(await MyBookingsPage(linkRequest));
      expect(otherPage).toContain('My bookings');
      expect(otherPage).not.toContain(booking.id);
      expect(otherPage).not.toContain(formatSlot(booking.startsAt, clinic.settings.timeZone));
      expect(otherPage).not.toContain(booking.practitionerName);
      expect(otherPage).not.toContain('data-testid="reschedule-link"');
      expect(otherPage).not.toContain('data-testid="cancel-booking"');
    },
  );
});
