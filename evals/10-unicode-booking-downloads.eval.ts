import { expect, test } from '@playwright/test';
import { bookingDownloadChecks } from './csv-checks';
import type { ExportClinic } from './csv-support';
import { demoPassword, evalNow } from './support';

const clinics: ExportClinic[] = [];

// Use the copy supplied by the factory, just as the other owner checks do.
// The optional second URL lets a demo runner supply both clinics to the same checks.
test.beforeAll(async ({ request, baseURL }) => {
  for (const url of [...new Set([baseURL!, process.env.EVAL_SECOND_CLINIC_URL].filter(Boolean))]) {
    const response = await request.get(`${url}/api/version`);
    expect(response.ok(), 'the supplied demo identifies its clinic').toBe(true);
    const { tenant } = (await response.json()) as { tenant: string };
    expect(['acme', 'beacon']).toContain(tenant);
    const name = tenant as 'acme' | 'beacon';
    const acme = name === 'acme';
    const domain = acme ? 'acmephysio.test' : 'beacondental.test';
    clinics.push({
      name,
      now: evalNow().toISOString(),
      label: acme ? 'Acme Physio' : 'Beacon Dental',
      domain,
      url: url!,
      accounts: Object.fromEntries(
        [`admin@${domain}`, ...[1, 2, 3].map((number) => `patient${number}@patients.${domain}`)].map((email) => [
          email,
          demoPassword(),
        ]),
      ),
      clients: acme
        ? ['Zoë Brontë', 'Łukasz Wiśniewski', 'Siobhán Ó Briain']
        : ['Niamh O’Connell', 'Emil Andersson', 'Róisín Murphy'],
      practitioners: [acme ? 'Alex Physiotherapist' : 'Blair Dentist'],
    });
  }
});

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

for (const check of bookingDownloadChecks) {
  test(check.title, async ({ browser }) => {
    await check.run(browser, clinics);
  });
}
