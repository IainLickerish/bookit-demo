import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { addHours, formatSlot } from '@/lib/time';
import { SESSION_COOKIE } from '@/server/auth/session';
import { bookSlot } from '@/server/bookings/book';
import { findBookingForPatient } from '@/server/bookings/queries';
import { sendDueBookingReminders } from '@/server/notifications/reminders';
import { listAvailableSlots } from '@/server/slots/queries';
import { seedClinic, TEST_PASSWORD } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase, type TestDatabase } from '../helpers/database';
import { captureLogs } from '../helpers/logs';
import { recordingMailer, testMail } from '../helpers/mail';

const root = path.resolve(import.meta.dirname, '../..');
const clock = manualClock('2026-10-20T07:00:00Z');
let database: TestDatabase | undefined;
let project: string | undefined;
let server: ChildProcess | undefined;
let origin: string;
let output = '';

function next(directory: string, args: string[], databaseUrl: string) {
  const app = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), ...args], {
    cwd: directory,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      GIT_COMMIT: '0000000000000000000000000000000000000000',
      BOOKIT_ALLOW_TEST_CLOCK: 'true',
      BOOKIT_DIST_DIR: '.next',
      BOOKIT_ENV: 'local',
      BOOKIT_LOG_DIR: '',
      BOOKIT_PUBLIC_URL: '',
      BOOKIT_SENTRY_DSN: '',
      BOOKIT_SMTP_URL: '',
      DATABASE_URL: databaseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [app.stdout, app.stderr]) {
    stream.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
  }
  return app;
}

beforeAll(async () => {
  database = await startTestDatabase();
  // Next writes its generated files and TypeScript settings into this isolated copy.
  const scratch = path.join(root, 'test-results');
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'bookit-reminder-links-'));
  project = directory;
  await Promise.all([
    ...['src', 'tsconfig.json', 'postcss.config.mjs', 'package.json'].map((name) =>
      cp(path.join(root, name), path.join(directory, name), { recursive: true }),
    ),
    cp(path.join(root, 'next.config.ts'), path.join(directory, 'app-config.ts')),
    // The separate product typecheck already checks this source. Keep the HTTP test's build small.
    writeFile(
      path.join(directory, 'next.config.ts'),
      `import appConfig from './app-config';
export default (phase: string) => ({
  ...appConfig(phase),
  experimental: { cpus: 2 },
  typescript: { ignoreBuildErrors: true },
});
`,
    ),
  ]);
  const build = next(directory, ['build'], database.url);
  server = build;
  const [exitCode, signal] = (await once(build, 'close')) as [number | null, NodeJS.Signals | null];
  if (exitCode !== 0) throw new Error(`The test app build exited with ${exitCode ?? signal}.\n${output}`);
  output = '';
  const app = next(directory, ['start', '-H', '127.0.0.1', '-p', '0'], database.url);
  server = app;
  await vi.waitFor(
    () => {
      const address = output.match(/Network:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (app.exitCode !== null || !address || !output.includes('Ready')) throw new Error(output);
      origin = address;
    },
    { timeout: 30_000 },
  );
});

afterAll(async () => {
  try {
    if (server?.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  } finally {
    if (project) await rm(project, { recursive: true, force: true });
    await database?.stop();
  }
});

async function submitSignIn(link: string, email: string) {
  const request = async (url: URL | string, options?: RequestInit) => {
    try {
      return await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...options });
    } catch (error) {
      throw new Error(
        `The test app did not respond to ${options?.method ?? 'GET'} ${new URL(url).pathname}.\n${output}`,
        {
          cause: error,
        },
      );
    }
  };
  const page = await request(link);
  expect(page.status).toBe(200);
  const signInForm = (await page.text()).match(/<form\b[^>]*>[\s\S]*?<\/form>/)?.[0];
  expect(signInForm).toContain('data-testid="sign-in-submit"');
  const openingTag = signInForm!.match(/^<form\b[^>]*>/)?.[0];
  expect(openingTag?.match(/\bmethod="([^"]+)"/i)?.[1]?.toUpperCase()).toBe('POST');
  const action = openingTag?.match(/\baction="([^"]*)"/)?.[1];
  expect(action).toBeDefined();

  // Submit the form rendered by Next, including its server action and continuation fields.
  const fields = new FormData();
  for (const [input] of signInForm!.matchAll(/<input\b[^>]*>/g)) {
    if (!input.includes('type="hidden"')) continue;
    const name = input.match(/\bname="([^"]+)"/)?.[1];
    const value = input.match(/\bvalue="([^"]*)"/)?.[1];
    if (name) fields.append(name, value ?? '');
  }
  fields.set('email', email);
  fields.set('password', TEST_PASSWORD);
  const signIn = await request(new URL(action!, link), { method: 'POST', body: fields, headers: { Origin: origin } });
  expect(signIn.status).toBe(303);
  const session = signIn.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  expect(session).toBeDefined();
  const destination = new URL(signIn.headers.get('location')!, origin);
  const pageAfterSignIn = await request(destination, {
    headers: { Cookie: session!.split(';')[0]! },
  });
  expect(pageAfterSignIn.status).toBe(200);
  return { destination, html: await pageAfterSignIn.text() };
}

it('submits sign-in from each reminder link and opens the intended booking control without changing the booking', async () => {
  const db = database!.db;
  const clinic = await seedClinic(db, clock, { settings: { slotHorizonDays: 3 } });
  const [slot] = await listAvailableSlots(db, {
    practitionerId: clinic.practitioners.weekdays,
    after: addHours(clock.now(), 24),
    until: addHours(clock.now(), 26),
  });
  const deps = { db, clock, log: captureLogs(clock).log, mail: testMail() };
  const booking = await bookSlot(deps, { patientId: clinic.patient1.id, slotId: slot!.id });
  const mailer = recordingMailer();
  await sendDueBookingReminders({
    ...deps,
    clock: manualClock(addHours(booking.startsAt, -24)),
    mail: testMail(mailer),
    publicUrl: new URL(origin),
  });
  expect(mailer.sent).toHaveLength(1);
  const [rescheduleLink, cancelLink] = mailer.sent[0]!.text.match(/^http:\/\/\S+$/gm) ?? [];

  const reschedule = await submitSignIn(rescheduleLink!, clinic.patient1.email);
  expect(reschedule.destination.pathname).toBe(`/bookings/${booking.id}/reschedule`);
  expect(reschedule.html).toContain('data-testid="current-when"');
  expect(reschedule.html).toContain(formatSlot(booking.startsAt, clinic.settings.timeZone));
  expect(reschedule.html).toContain('data-testid="reschedule-to"');

  const cancel = await submitSignIn(cancelLink!, clinic.patient1.email);
  expect(cancel.destination.pathname).toBe('/bookings');
  expect(cancel.destination.hash).toBe(`#cancel-${booking.id}`);
  const buttons = Array.from(cancel.html.matchAll(/<button\b[^>]*>/g), ([button]) => button);
  expect(buttons.find((button) => button.includes(`id="${cancel.destination.hash.slice(1)}"`))).toContain(
    'data-testid="cancel-booking"',
  );
  expect(await findBookingForPatient(db, clinic.patient1.id, booking.id)).toMatchObject({
    status: 'confirmed',
    slotId: slot!.id,
  });
});
