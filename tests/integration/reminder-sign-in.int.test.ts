import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import SignInPage from '@/app/auth/sign-in/page';
import { addHours } from '@/lib/time';
import { bookSlot } from '@/server/bookings/book';
import { currentUser } from '@/server/request-context';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, TEST_PASSWORD, type SeededClinic } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail } from '../helpers/mail';

class SignInRedirect extends Error {
  constructor(readonly destination: string) {
    super(destination);
  }
}

const cookieValues = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => ({ value: cookieValues.get(name) }),
    set: (name: string, value: string) => cookieValues.set(name, value),
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (destination: string) => {
    throw new SignInRedirect(destination);
  },
}));

vi.mock('@/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/client')>()),
  getDatabase: () => database.db,
}));

const origin = 'https://bookit.example.test';
const clock = manualClock('2026-10-20T07:00:00Z');
let database: TestDatabase;
let clinic: SeededClinic;
let bookingId: string;

beforeAll(async () => {
  database = await startTestDatabase();
  clinic = await seedClinic(database.db, clock);
  const [slot] = await listAvailableSlots(database.db, {
    practitionerId: clinic.practitioners.weekdays,
    after: clock.now(),
    until: addHours(clock.now(), 24),
  });
  const booking = await bookSlot(
    { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() },
    { patientId: clinic.patient1.id, slotId: slot!.id },
  );
  bookingId = booking.id;
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(() => cookieValues.clear());

interface FormProps {
  action: (data: FormData) => Promise<void>;
  children: ReactNode;
}

async function openSignIn(url: URL) {
  const page = await SignInPage({ searchParams: Promise.resolve(Object.fromEntries(url.searchParams)) });
  const form = Children.toArray(page.props.children).find(
    (child): child is ReactElement<FormProps> => isValidElement<FormProps>(child) && child.type === 'form',
  );
  if (!form) throw new Error('The sign-in page has no form');
  const destination = Children.toArray(form.props.children).find(
    (child): child is ReactElement<{ value: string }> =>
      isValidElement<{ type: string; name: string; value: string }>(child) &&
      child.type === 'input' &&
      child.props.type === 'hidden' &&
      child.props.name === 'next',
  )?.props.value;
  return {
    destination,
    async submit(password: string): Promise<URL> {
      const data = new FormData();
      data.set('email', clinic.patient1.email);
      data.set('password', password);
      if (destination !== undefined) data.set('next', destination);
      try {
        await form.props.action(data);
      } catch (error) {
        if (error instanceof SignInRedirect) return new URL(error.destination, origin);
        throw error;
      }
      throw new Error('Sign-in did not redirect');
    },
  };
}

it.each([
  ['reschedule', () => `/bookings/${bookingId}/reschedule`],
  ['cancel', () => `/bookings#booking-${bookingId}`],
])('opens the %s reminder destination after a failed sign-in and retry', async (_action, bookingPath) => {
  const destination = bookingPath();
  const link = new URL('/auth/sign-in', origin);
  link.searchParams.set('next', destination);
  const initial = await openSignIn(link);
  const failed = await initial.submit('incorrect-test-password');
  expect(failed.pathname).toBe('/auth/sign-in');
  expect(failed.searchParams.get('error')).toBe('invalid');
  expect(await currentUser()).toBeNull();

  const retry = await openSignIn(failed);
  expect(retry.destination).toBe(destination);
  expect((await retry.submit(TEST_PASSWORD)).href).toBe(new URL(destination, origin).href);
  expect(await currentUser()).toMatchObject({ id: clinic.patient1.id });
});
