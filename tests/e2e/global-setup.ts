import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { seedClinic, TEST_PASSWORD } from '../helpers/clinic';
import { manualClock } from '../helpers/clock';
import { startTestDatabase } from '../helpers/database';
import { startSmtpReceiver } from '../helpers/mail';
import { E2E_COMMIT, E2E_DIR, E2E_MAIL_FROM, E2E_START, ROOT, STATE_FILE, writeClock, type E2eState } from './support';

const NEXT = path.join(ROOT, 'node_modules/.bin/next');
const DIST_DIR = '.next-e2e';

async function waitForServer(url: string, exited: () => boolean): Promise<void> {
  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    if (exited()) {
      throw new Error('The BookIt server exited during start-up; see server.log.');
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The BookIt server did not answer ${url} within 60 seconds.`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  mkdirSync(E2E_DIR, { recursive: true });
  const clockFile = path.join(E2E_DIR, 'clock.json');
  const serverLog = path.join(E2E_DIR, 'server.log');
  const mailLog = path.join(E2E_DIR, 'mail.jsonl');
  writeClock(clockFile, E2E_START);
  writeFileSync(mailLog, '');

  // Stands in for Mailpit: confirmation emails stay on this machine.
  const smtp = await startSmtpReceiver();
  smtp.onMessage((message) => appendFileSync(mailLog, `${JSON.stringify(message)}\n`));
  const database = await startTestDatabase(5);
  const clinic = await seedClinic(database.db, manualClock(E2E_START));
  const state: E2eState = {
    databaseUrl: database.url,
    clockFile,
    serverLog,
    mailLog,
    password: TEST_PASSWORD,
    patient1: clinic.patient1.email,
    patient2: clinic.patient2.email,
  };
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

  const baseEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    NEXT_TELEMETRY_DISABLED: '1',
    BOOKIT_DIST_DIR: DIST_DIR,
  };
  if (process.env.BOOKIT_E2E_SKIP_BUILD !== '1') {
    const built = spawnSync(NEXT, ['build'], {
      cwd: ROOT,
      env: { ...baseEnv, BOOKIT_ALLOW_TEST_CLOCK: 'true', GIT_COMMIT: E2E_COMMIT },
      stdio: 'inherit',
      timeout: 300_000,
    });
    if (built.status !== 0) {
      await database.stop();
      await smtp.stop();
      throw new Error('next build failed for the test-clock build.');
    }
  }

  const port = process.env.BOOKIT_E2E_PORT ?? '4199';
  const log = createWriteStream(serverLog);
  const server = spawn(NEXT, ['start', '-p', port, '-H', '127.0.0.1'], {
    cwd: ROOT,
    env: {
      ...baseEnv,
      DATABASE_URL: database.url,
      BOOKIT_TEST_CLOCK: clockFile,
      BOOKIT_TENANT: 'test',
      BOOKIT_ENV: 'local',
      BOOKIT_SMTP_URL: smtp.url,
      BOOKIT_PUBLIC_URL: `http://127.0.0.1:${port}`,
      BOOKIT_MAIL_FROM: E2E_MAIL_FROM,
    },
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  let exited = false;
  const exit = new Promise<void>((resolve) =>
    server.once('exit', () => {
      exited = true;
      resolve();
    }),
  );
  try {
    await waitForServer(`http://127.0.0.1:${port}/auth/sign-in`, () => exited);
  } catch (error) {
    server.kill('SIGTERM');
    await database.stop();
    await smtp.stop();
    throw error;
  }

  return async () => {
    if (!exited) {
      server.kill('SIGTERM');
      await exit;
    }
    log.end();
    await database.stop();
    await smtp.stop();
  };
}
