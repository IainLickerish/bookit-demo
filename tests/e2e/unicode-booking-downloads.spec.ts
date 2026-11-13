import { expect, test } from '@playwright/test';
import { bookingDownloadChecks } from '../../evals/csv-checks';
import { buildComposeImage, COMPOSE_CLOCK, type ComposeTenant } from '../helpers/compose';
import { prepareExportClinic } from '../helpers/export-clinic';

// The same public journeys also run with fictional combined accents, other alphabets,
// CSV delimiters and formula-like names, in both clinics and with two practitioners.
const clinics: ComposeTenant[] = [];
test.use({ trace: 'off' });
test.beforeAll(async () => {
  test.setTimeout(900_000);
  if (process.env.BOOKIT_COMPOSE_SKIP_BUILD !== '1') {
    expect((await buildComposeImage(true)).code, 'the export-check copy builds').toBe(0);
  }
  for (const name of ['acme', 'beacon'] as const) {
    const clinic = await prepareExportClinic(name);
    clinics.push(clinic);
    expect((await clinic.start()).code, `${clinic.tenant.settings.clinicName} starts`).toBe(0);
  }
});

test.afterAll(async () => {
  test.setTimeout(300_000);
  await Promise.all(clinics.map((clinic) => clinic.stop()));
});

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

for (const check of bookingDownloadChecks) {
  test(check.title, async ({ browser }) => {
    test.setTimeout(180_000);
    await check.run(
      browser,
      clinics.map((clinic) => ({
        name: clinic.tenant.tenant,
        now: process.env.EVAL_NOW ?? COMPOSE_CLOCK,
        label: clinic.tenant.settings.clinicName,
        domain: clinic.tenant.domain,
        url: clinic.url,
        accounts: clinic.accounts,
        clients: clinic.tenant.accounts.filter((account) => account.role === 'patient').map((account) => account.name),
        practitioners: clinic.tenant.practitioners.map((practitioner) => practitioner.name),
      })),
    );
  });
}
