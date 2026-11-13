import { expect } from '@playwright/test';
import { test } from '../../evals/10-unicode-booking-downloads.eval';
import { buildComposeImage, COMPOSE_CLOCK, type ComposeTenant } from '../helpers/compose';
import { prepareExportClinic } from '../helpers/export-clinic';

// Import the owner journeys and supply fresh fictional copies with combined accents,
// other alphabets, CSV delimiters, formula-like names and two practitioners in both clinics.
const clinics: ComposeTenant[] = [];
test.use({
  trace: 'off',
  clinics: async ({ browser }, provideClinics) => {
    expect(browser.isConnected()).toBe(true);
    await provideClinics(
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
  },
});

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
