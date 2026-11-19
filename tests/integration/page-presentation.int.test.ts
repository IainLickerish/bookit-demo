import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminBookingsPage from '@/app/admin/page';
import AdminSettingsPage from '@/app/admin/settings/page';
import ForgotPasswordPage from '@/app/auth/forgot-password/page';
import ResetPasswordPage from '@/app/auth/reset-password/[token]/page';
import SignInPage from '@/app/auth/sign-in/page';
import BookSlotPage from '@/app/book/[slotId]/page';
import ReschedulePage from '@/app/bookings/[bookingId]/reschedule/page';
import MyBookingsPage from '@/app/bookings/page';
import ErrorPage from '@/app/error';
import RootLayout from '@/app/layout';
import NotFound from '@/app/not-found';
import HomePage from '@/app/page';
import SlotsPage from '@/app/slots/page';
import { getDatabase } from '@/db/client';
import { getClock } from '@/lib/clock';
import { requestPasswordReset } from '@/server/auth/password-reset';
import { createPasswordResetLimiter } from '@/server/auth/rate-limit';
import { createSession, SESSION_COOKIE } from '@/server/auth/session';
import { bookSlot } from '@/server/bookings/book';
import { loadDayView } from '@/server/slots/day-view';
import { seedClinic } from '../helpers/clinic';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { testMail, TEST_MAIL_FROM } from '../helpers/mail';

vi.mock('@/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/client')>()),
  getDatabase: vi.fn(),
}));

let session: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === SESSION_COOKIE && session ? { value: session } : undefined),
  }),
  headers: async () => new Headers(),
}));

const date = '2026-10-22';
const searchParams = Promise.resolve({});
let database: TestDatabase;
let patientSession: string;
let otherPatientSession: string;
let staffSession: string;
let bookingId: string;
let freeSlotId: string;
let practitionerId: string;
let clinicName: string;

beforeAll(async () => {
  vi.stubEnv('BOOKIT_ENV', 'local');
  vi.stubEnv('BOOKIT_TENANT', 'acme');
  database = await startTestDatabase();
  vi.mocked(getDatabase).mockReturnValue(database.db);
  const clock = getClock();
  const clinic = await seedClinic(database.db, clock);
  clinicName = clinic.settings.clinicName;
  practitionerId = clinic.practitioners.weekdays;
  patientSession = (await createSession(database.db, clock, clinic.patient1.id)).token;
  otherPatientSession = (await createSession(database.db, clock, clinic.patient2.id)).token;
  staffSession = (await createSession(database.db, clock, clinic.admin.id)).token;
  const { slots } = await loadDayView(database.db, clock, { practitionerId, date });
  freeSlotId = slots[1]!.id;
  const booking = await bookSlot(
    { db: database.db, clock, log: captureLogs(clock).log, mail: testMail() },
    { patientId: clinic.patient1.id, slotId: slots[0]!.id },
  );
  bookingId = booking.id;
});

beforeEach(() => {
  session = undefined;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await database?.stop();
});

function pageTitle(element: ReactElement): string | undefined {
  return /<header[^>]*data-testid="page-header"[^>]*><h1[^>]*>([^<]+)<\/h1>/.exec(renderToStaticMarkup(element))?.[1];
}

describe('page presentation', () => {
  it('keeps account and fallback titles in the shared page header', async () => {
    expect(pageTitle(await SignInPage({ searchParams }))).toBe('Sign in');
    expect(pageTitle(await ForgotPasswordPage({ searchParams }))).toBe('Reset your password');
    expect(pageTitle(NotFound())).toBe('Page not found');
    expect(pageTitle(ErrorPage({ reset: vi.fn(), error: new Error('Test render failure') }))).toBe(
      'Something went wrong',
    );

    const clock = getClock();
    const reset = await requestPasswordReset(
      {
        db: database.db,
        clock,
        log: captureLogs(clock).log,
        tenant: 'acme',
        limiter: createPasswordResetLimiter(),
        publicUrl: new URL('https://clinic.example.test'),
        mailFrom: TEST_MAIL_FROM,
      },
      { email: 'patient1@patients.example.test', clientIp: '192.0.2.10' },
    );
    const token = /reset-password\/([A-Za-z0-9_-]+)/.exec(reset.email?.text ?? '')?.[1];
    if (!token) throw new Error('The seeded account did not receive a reset link');
    expect(pageTitle(await ResetPasswordPage({ params: Promise.resolve({ token }), searchParams }))).toBe(
      'Choose a new password',
    );
  });

  it('keeps client booking titles, time choices and booking ownership', async () => {
    session = patientSession;
    const day = Promise.resolve({ date, practitioner: practitionerId });
    const slots = await SlotsPage({ searchParams: day });
    expect(pageTitle(slots)).toBe('Book an appointment');
    expect(renderToStaticMarkup(slots)).toContain(`href="/book/${freeSlotId}"`);
    expect(pageTitle(await BookSlotPage({ params: Promise.resolve({ slotId: freeSlotId }), searchParams }))).toBe(
      'Confirm your booking',
    );
    const bookings = await MyBookingsPage({ searchParams });
    expect(pageTitle(bookings)).toBe('My bookings');
    expect(renderToStaticMarkup(bookings)).toContain(`href="/bookings/${bookingId}/reschedule"`);
    const reschedule = { params: Promise.resolve({ bookingId }), searchParams: day };
    expect(pageTitle(await ReschedulePage(reschedule))).toBe('Reschedule your appointment');

    session = otherPatientSession;
    expect(renderToStaticMarkup(await MyBookingsPage({ searchParams }))).not.toContain(bookingId);
    await expect(ReschedulePage(reschedule)).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('keeps the staff headings, role redirects and filtered export link', async () => {
    await expect(HomePage()).rejects.toMatchObject({ digest: expect.stringContaining(';/auth/sign-in;') });
    session = patientSession;
    await expect(HomePage()).rejects.toMatchObject({ digest: expect.stringContaining(';/bookings;') });
    await expect(AdminBookingsPage({ searchParams })).rejects.toMatchObject({
      digest: expect.stringContaining(';/bookings;'),
    });

    session = staffSession;
    const home = await HomePage();
    expect(pageTitle(home)).toBe('Clinic administration');
    const layout = renderToStaticMarkup(await RootLayout({ children: home }));
    expect(layout).toContain('data-testid="site-header"');
    expect(layout).toContain(clinicName);
    expect(layout).toContain('href="/admin"');
    expect(pageTitle(await AdminSettingsPage({ searchParams }))).toBe('Clinic settings');

    const filters = Promise.resolve({ date, status: 'confirmed' });
    const bookings = await AdminBookingsPage({ searchParams: filters });
    expect(pageTitle(bookings)).toBe('Clinic bookings');
    const markup = renderToStaticMarkup(bookings);
    expect(markup).toContain(`href="/api/admin/export?date=${date}&amp;status=confirmed"`);
    expect(markup).toContain('Patient One');
  });
});
