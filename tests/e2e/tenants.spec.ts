import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import {
  buildComposeImage,
  COMPOSE_CLOCK,
  prepareComposeTenant,
  PRODUCTION_IMAGE,
  runDocker,
  type ComposeTenant,
} from '../helpers/compose';
import { TEST_COMMIT } from '../helpers/built-server';
import { tenantEvidenceDirectory, writeTenantEvidence } from '../helpers/tenant-evidence';

test.describe.configure({ mode: 'serial' });
// The fixture fills generated passwords; browser traces must not retain them.
test.use({ trace: 'off' });
let acme: ComposeTenant;
let beacon: ComposeTenant;
const outcomes: unknown[] = [];
const startupLogs = new Map<string, string>();
const buildDirectory = tenantEvidenceDirectory('container-build');

test.beforeAll(async () => {
  test.setTimeout(900_000);
  if (process.env.BOOKIT_COMPOSE_SKIP_BUILD !== '1') {
    const build = await buildComposeImage(true);
    writeTenantEvidence(
      buildDirectory,
      { testId: 'container-test-clock-build', expected: 0, observed: build.code },
      build.output,
      [],
    );
    expect(build.code, `Container build failed; see ${buildDirectory}/evidence.json`).toBe(0);
  }
  acme = await prepareComposeTenant('acme');
  beacon = await prepareComposeTenant('beacon');
  for (const clinic of [acme, beacon]) {
    const up = await clinic.start();
    startupLogs.set(clinic.project, up.output);
    outcomes.push({ testId: `${clinic.tenant.tenant}-compose-up`, expected: 0, observed: up.code });
    if (up.code !== 0) writeTenantEvidence(clinic.directory, outcomes, up.output, clinic.canaries);
    expect(up.code, `Compose startup failed; see ${clinic.directory}/evidence.json`).toBe(0);
  }
});

test.afterEach(({}, info) => {
  outcomes.push({
    testId: info.title,
    ids: ['REQ-18.1-03', 'REQ-18.1-06', 'REQ-18.2-01'],
    expected: info.expectedStatus,
    observed: info.status,
  });
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  const failures: unknown[] = [];
  for (const clinic of [acme, beacon]) {
    if (!clinic) continue;
    try {
      const logs = await clinic.command(['logs', '--no-color']);
      const health = await clinic.command(['ps', '--all', '--format', 'json']);
      let receiver: unknown = { available: false };
      try {
        const events = (await (
          await fetch(`${clinic.receiverUrl}/events`, { signal: AbortSignal.timeout(5_000) })
        ).json()) as Record<string, unknown>[];
        receiver = {
          available: true,
          events: events.map((event) => {
            const tags = event.tags as Record<string, unknown> | undefined;
            return {
              release: event.release,
              environment: event.environment,
              product: tags?.product,
              tenant: tags?.tenant,
              requestId: tags?.request_id,
            };
          }),
        };
      } catch {
        /* Startup-failure bundles still retain container logs and health. */
      }
      writeTenantEvidence(
        clinic.directory,
        { outcomes, health: health.output, independentSdkReceiver: receiver },
        `${startupLogs.get(clinic.project) ?? ''}\n${logs.output}`,
        clinic.canaries,
      );
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await clinic.stop();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Tenant evidence or cleanup failed');
});

async function signIn(browser: Browser, clinic: ComposeTenant, localPart: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = clinic.tenant.accounts.find((account) => account.email.startsWith(`${localPart}@`))!.email;
  await page.goto(`${clinic.url}/auth/sign-in`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(clinic.accounts[email]!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(localPart === 'admin' ? `${clinic.url}/` : `${clinic.url}/bookings`);
  await expect(page.getByTestId('clinic-name')).toHaveText(clinic.tenant.settings.clinicName);
  return context;
}

test('REQ-18.1-06 both local Compose tenants expose distinct identity, virtual time and local SDK receipt', async () => {
  for (const clinic of [acme, beacon]) {
    const publicOrigin = await clinic.command(['exec', '-T', 'bookit', 'node', '-p', 'process.env.BOOKIT_PUBLIC_URL']);
    expect(publicOrigin.code).toBe(0);
    expect(publicOrigin.output.trim()).toBe(clinic.url);
    expect((await fetch(`${clinic.url}/api/health`, { signal: AbortSignal.timeout(10_000) })).status).toBe(200);
    const version = (await (
      await fetch(`${clinic.url}/api/version`, { signal: AbortSignal.timeout(10_000) })
    ).json()) as Record<string, unknown>;
    expect(version).toMatchObject({
      product: clinic.tenant.product,
      tenant: clinic.tenant.tenant,
      environment: 'staging',
      commit: TEST_COMMIT,
      startedAt: COMPOSE_CLOCK,
      buildId: 'm0-24d-tests',
    });
    expect((await fetch(`${clinic.url}/api/debug/error`, { signal: AbortSignal.timeout(10_000) })).status).toBe(500);
    await expect
      .poll(
        async () => {
          const events = (await (
            await fetch(`${clinic.receiverUrl}/events`, { signal: AbortSignal.timeout(10_000) })
          ).json()) as Record<string, unknown>[];
          return events.find((event) => JSON.stringify(event.exception).includes('InjectedTestError'));
        },
        { timeout: 20_000 },
      )
      .toMatchObject({
        release: TEST_COMMIT,
        environment: 'staging',
        tags: expect.objectContaining({
          product: clinic.tenant.product,
          tenant: clinic.tenant.tenant,
          request_id: expect.stringMatching(/^req-\d{6}$/),
        }),
      });
    const log = await clinic.command(['logs', '--no-color', 'bookit']);
    expect(log.output).toContain(COMPOSE_CLOCK);
    expect(log.output).toMatch(/req-\d{6}/);
  }
});

test('REQ-18.2-01 admin pages and downloaded exports contain only their own seeded tenant', async ({ browser }) => {
  const a = await signIn(browser, acme, 'admin');
  const b = await signIn(browser, beacon, 'admin');
  try {
    for (const [context, clinic, ownName, foreignName] of [
      [a, acme, 'Zoë Brontë', 'Niamh O’Connell'],
      [b, beacon, 'Niamh O’Connell', 'Zoë Brontë'],
    ] as const) {
      const page = context.pages()[0]!;
      await page.goto(`${clinic.url}/admin`);
      await expect(page.locator('table')).toContainText(ownName);
      await expect(page.locator('table')).not.toContainText(foreignName);
      // Ordinary export coverage uses an empty selection; the seeded Unicode
      // export regression is exercised externally by SupportAgents' DEF-02 test.
      const exported = await context.request.get(`${clinic.url}/api/admin/export?date=2026-10-21&status=cancelled`);
      expect(exported.status()).toBe(200);
      const csv = await exported.body();
      expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(csv.toString('utf8').split('\r\n')).toHaveLength(2);
      expect(csv.toString('utf8')).not.toContain(foreignName);
      const stalePath = await context.request.get(`${clinic.url}/account/reset-password`);
      expect(stalePath.status()).toBe(404);
    }
    const foreign = await browser.newContext();
    try {
      await foreign.addCookies(await a.cookies());
      const response = await foreign.request.get(`${beacon.url}/api/admin/export`);
      expect(response.status()).toBe(401);
    } finally {
      await foreign.close();
    }
  } finally {
    await a.close();
    await b.close();
  }
});

test('REQ-18.2-01 patient sees the three-hour appointment, rerun seed preserves data and database role denies foreign databases', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await signIn(browser, acme, 'patient1');
  try {
    const page = context.pages()[0]!;
    await page.goto(`${acme.url}/bookings`);
    await expect(page.getByTestId('booking-when').first()).toContainText('11:00');
    const reseed = await acme.command(['run', '--no-deps', 'seed']);
    expect(reseed.code).toBe(0);
    expect(reseed.output).toContain('"outcome":"unchanged"');
    const denied = await acme.command([
      'exec',
      '-T',
      'bookit',
      'bun',
      '-e',
      "const {Pool}=require('pg');const fs=require('fs');const password=fs.readFileSync('/run/secrets/database_password','utf8').trim();const p=new Pool({host:'db',user:'bookit',password,database:'postgres'});try{await p.query('select 1');process.exitCode=2}catch{console.log('foreign-database-denied')}finally{await p.end()}",
    ]);
    expect(denied.code).toBe(0);
    expect(denied.output).toContain('foreign-database-denied');
    const foreignContainer = await beacon.command(['ps', '-q', 'bookit']);
    const address = await runDocker([
      'inspect',
      '--format',
      '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
      foreignContainer.output.trim(),
    ]);
    expect(address.code).toBe(0);
    expect(address.output.trim()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    const networkDenied = await acme.command([
      'exec',
      '-T',
      '-e',
      `FOREIGN_TEST_URL=http://${address.output.trim()}:3000/api/health`,
      'bookit',
      'bun',
      '-e',
      "try{await fetch(process.env.FOREIGN_TEST_URL,{signal:AbortSignal.timeout(2000)});process.exitCode=2}catch{console.log('foreign-network-denied')}",
    ]);
    expect(networkDenied.code).toBe(0);
    expect(networkDenied.output).toContain('foreign-network-denied');
    const mismatch = await acme.command([
      'run',
      '--no-deps',
      '-e',
      'BOOKIT_TENANT=beacon',
      '-e',
      'BOOKIT_PRODUCT=BEACON',
      '-e',
      'BOOKIT_MAIL_FROM=noreply@beacondental.test',
      'bookit',
    ]);
    expect(mismatch.code).toBe(1);
    expect(mismatch.output).toContain('configuration refused');
    writeFileSync(acme.clockFile, JSON.stringify({ now: '2026-10-20T08:00:00.000Z' }));
    await fetch(`${acme.url}/api/version`, { signal: AbortSignal.timeout(10_000) });
    expect((await acme.command(['logs', '--no-color', 'bookit'])).output).toContain('2026-10-20T08:00:00.000Z');
  } finally {
    await context.close();
  }
});

test('REQ-18.1-06 container build requires GIT_COMMIT and the production image refuses the virtual clock', async () => {
  test.setTimeout(900_000);
  const directory = tenantEvidenceDirectory('production-build');
  const results: unknown[] = [];
  const logs: string[] = [];
  try {
    const missing = await buildComposeImage(false, '');
    results.push({ testId: 'missing-commit-build', expected: 'nonzero', observed: missing.code });
    logs.push(missing.output);
    expect(missing.code).not.toBe(0);
    expect(missing.output).toContain('GIT_COMMIT');
    const build = await buildComposeImage(false);
    results.push({ testId: 'production-build', expected: 0, observed: build.code });
    logs.push(build.output);
    expect(build.code).toBe(0);
    const override = JSON.parse(readFileSync(`${acme.directory}/compose.override.json`, 'utf8')) as {
      services: { bookit: { image?: string } };
    };
    override.services.bookit.image = PRODUCTION_IMAGE;
    writeFileSync(`${acme.directory}/compose.override.json`, JSON.stringify(override));
    const refused = await acme.command(['run', '--no-deps', 'bookit']);
    results.push({ testId: 'production-clock-refusal', expected: 1, observed: refused.code });
    logs.push(refused.output);
    expect(refused.code).toBe(1);
    expect(refused.output).toContain('BOOKIT_TEST_CLOCK is set');
    outcomes.push({
      testId: 'image-refusals',
      missingCommitExit: missing.code,
      productionBuildExit: build.code,
      testClockRefusalExit: refused.code,
    });
  } finally {
    writeTenantEvidence(directory, results, logs.join('\n'), acme.canaries);
  }
});
