import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
import { isResetTokenUsable } from '@/server/auth/password-reset';
import { currentUser } from '@/server/request-context';
import type { PublicUser } from '@/server/users';
import { TEST_CLINIC_SETTINGS } from '../helpers/clinic';

vi.mock('@/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('@/server/request-context', () => ({
  currentUser: vi.fn(),
  requirePatient: async () => patient,
  requestLogger: vi.fn(),
}));
vi.mock('@/server/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/settings')>()),
  loadClinicSettings: async () => TEST_CLINIC_SETTINGS,
}));
vi.mock('@/server/slots/queries', () => ({ findBookableSlot: async () => slot, isSlotFree: async () => true }));
vi.mock('@/server/slots/day-view', () => ({
  loadDayView: async () => ({
    settings: TEST_CLINIC_SETTINGS,
    practitioners: [practitioner],
    practitioner,
    slots: [slot],
    date: '2026-10-22',
    today: '2026-10-20',
    lastDate: '2027-05-28',
  }),
}));
vi.mock('@/server/bookings/queries', () => ({
  findBookingForPatient: async () => booking,
  listBookingsForPatient: async () => [booking],
}));
vi.mock('@/server/admin/bookings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/admin/bookings')>()),
  listAdminBookings: async () => [{ ...booking, patientName: patient.name }],
  listAdminPractitioners: async () => [practitioner],
}));
vi.mock('@/server/auth/password-reset', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/password-reset')>()),
  isResetTokenUsable: vi.fn(),
}));

const patient: PublicUser = {
  id: 'patient',
  email: 'patient@example.test',
  name: 'Test Patient',
  role: 'patient',
  phone: null,
};
const staff: PublicUser = { ...patient, id: 'staff', email: 'staff@example.test', name: 'Test Staff', role: 'admin' };
const practitioner = { id: 'practitioner', name: 'Pat Physio' };
const slot = {
  id: 'available-slot',
  practitionerId: practitioner.id,
  practitionerName: practitioner.name,
  startsAt: new Date('2026-10-22T09:30:00Z'),
};
const booking = { ...slot, id: 'booking', slotId: 'booked-slot', status: 'confirmed', rescheduleCount: 0 };
const props = { searchParams: Promise.resolve({}) };
const resetProps = { ...props, params: Promise.resolve({ token: 'example' }) };

beforeEach(() => {
  vi.mocked(currentUser).mockResolvedValue(null);
  vi.mocked(isResetTokenUsable).mockResolvedValue(true);
  vi.stubEnv('BOOKIT_ENV', 'local');
});

afterEach(() => vi.unstubAllEnvs());

it.each([
  ['Clinic administration', () => HomePage(), 'You are signed in as the clinic admin.', staff],
  ['Book an appointment', () => SlotsPage(props), 'Show times', patient],
  [
    'Confirm your booking',
    () => BookSlotPage({ ...props, params: Promise.resolve({ slotId: slot.id }) }),
    'Confirm booking',
    patient,
  ],
  ['My bookings', () => MyBookingsPage(props), 'Reschedule', patient],
  [
    'Reschedule your appointment',
    () => ReschedulePage({ ...props, params: Promise.resolve({ bookingId: booking.id }) }),
    'Back to my bookings',
    patient,
  ],
  ['Sign in', () => SignInPage(props), 'Forgot your password?', null],
  ['Reset your password', () => ForgotPasswordPage(props), 'Email me a reset link', null],
  ['Choose a new password', () => ResetPasswordPage(resetProps), 'Set new password', null],
  ['Clinic bookings', () => AdminBookingsPage(props), 'Filter bookings', staff],
  ['Clinic settings', () => AdminSettingsPage(props), 'Save settings', staff],
  ['Something went wrong', () => ErrorPage({ reset: vi.fn(), error: new Error() }), 'Try again', null],
  ['Page not found', () => NotFound(), 'Go to the start page', null],
] as const)('renders %s with a title-only header and a card', async (title, render, existingText, user) => {
  vi.mocked(currentUser).mockResolvedValue(user);
  const html = renderToStaticMarkup(await render());
  expect(html).toContain(`<header class="page-header" data-testid="page-header"><h1>${title}</h1></header>`);
  expect(html.match(/<h1>/g)).toHaveLength(1);
  expect(html).toMatch(/class="card(?: |")/);
  expect(html).toContain(existingText);
});

it('shows the expired password link message in the refreshed account layout', async () => {
  vi.mocked(isResetTokenUsable).mockResolvedValue(false);
  const html = renderToStaticMarkup(await ResetPasswordPage(resetProps));
  expect(html).toContain('<h1>Reset your password</h1></header>');
  expect(html).toContain('class="card ');
  expect(html).toContain('This reset link has expired or has already been used.');
  expect(html).not.toContain('Set new password');
});

it('keeps the configured clinic name and patient navigation in the shared header', async () => {
  vi.mocked(currentUser).mockResolvedValue(patient);
  const html = renderToStaticMarkup(await RootLayout({ children: null }));
  const header = html.match(/<header\b[^>]*>(.*?)<\/header>/s)?.[1];
  const navigation = header?.match(/<nav\b[^>]*>(.*?)<\/nav>/s)?.[1];
  expect(header).toContain(
    `class="clinic-name" data-testid="clinic-name" href="/">${TEST_CLINIC_SETTINGS.clinicName}</a>`,
  );
  expect(navigation).toContain('data-testid="nav-book" href="/slots">Book</a>');
  expect(navigation).toContain('data-testid="nav-my-bookings" href="/bookings">My bookings</a>');
  expect(navigation).toContain('data-testid="sign-out">Sign out</button>');
});

it('keeps the mobile confirmation button in the booking form', async () => {
  const html = renderToStaticMarkup(await BookSlotPage({ ...props, params: Promise.resolve({ slotId: slot.id }) }));
  const bookingForm = html.match(/<form\b[^>]*>(.*?)<\/form>/s)?.[1];
  expect(bookingForm).toContain('name="slotId"');
  expect(bookingForm).toContain('data-testid="book-phone"');
  expect(bookingForm).toMatch(/<div class="booking-action"><button type="submit"[^>]*>Confirm booking<\/button>/);
});
