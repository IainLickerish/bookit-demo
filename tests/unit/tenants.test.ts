import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTenant, tenantSchema } from '@/server/seed/tenant';
import { clockChangeReferenceStarts, validatePasswords } from '@/server/seed/seed';

describe('REQ-18.2-01 tenant configuration boundaries', () => {
  it('creates private caller credentials without printing values or overwriting a previous set', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'bookit-private-credentials-'));
    const run = () => spawnSync('bun', ['scripts/local-credentials.ts', 'acme', directory], { encoding: 'utf8' });
    const first = run();
    expect(first.status).toBe(0);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    const filename = path.join(directory, 'accounts.json');
    expect(statSync(filename).mode & 0o777).toBe(0o444);
    const before = createHash('sha256').update(readFileSync(filename)).digest('hex');
    const credentials = JSON.parse(readFileSync(filename, 'utf8')) as Record<string, string>;
    expect(
      Object.values(credentials).some((value) => first.stdout.includes(value) || first.stderr.includes(value)),
    ).toBe(false);
    expect(run().status).toBe(1);
    expect(createHash('sha256').update(readFileSync(filename)).digest('hex')).toBe(before);
  });
  it.each([
    ['2026-10-24T22:00:00Z', '2026-10-24T08:00:00.000Z', '2026-10-26T09:00:00.000Z'],
    ['2027-01-01T12:00:00Z', '2027-03-27T09:00:00.000Z', '2027-03-29T08:00:00.000Z'],
  ])('keeps clock-change reference slots when seeded at %s', (now, before, after) => {
    expect(clockChangeReferenceStarts(new Date(now), 'Europe/London').map((date) => date.toISOString())).toEqual([
      before,
      after,
    ]);
  });
  it.each(['acme', 'beacon'] as const)('%s has canonical domains, isolated identity and clinic rules', (name) => {
    const tenant = loadTenant(name);
    expect(tenant.product).toBe(name.toUpperCase());
    expect(tenant.settings).toMatchObject({
      timeZone: 'Europe/London',
      slotHorizonDays: 220,
      lateCancellationHours: name === 'acme' ? 24 : 48,
      sessionMinutes: name === 'acme' ? 45 : 30,
      maxReschedulesPerBooking: name === 'acme' ? 3 : 2,
      includeContactInConfirmation: name === 'acme',
    });
    expect(tenant.allowedSenderDomains).toEqual([tenant.domain]);
    expect(tenant.allowedSenderDomains).not.toContain(`patients.${tenant.domain}`);
  });
  it.each(['../../etc/passwd', 'cobalt', '', 'ACME'])('refuses an unconfigured tenant %j', (name) => {
    expect(() => loadTenant(name)).toThrow();
  });
  it('rejects cross-client contacts, sender subdomains and account/domain mismatches', () => {
    const tenant = loadTenant('acme');
    expect(tenantSchema.safeParse({ ...tenant, domain: 'beacondental.test' }).success).toBe(false);
    expect(tenantSchema.safeParse({ ...tenant, allowedSenderDomains: ['patients.acmephysio.test'] }).success).toBe(
      false,
    );
    expect(tenantSchema.safeParse({ ...tenant, accounts: loadTenant('beacon').accounts }).success).toBe(false);
    expect(tenantSchema.safeParse({ ...tenant, contacts: loadTenant('beacon').contacts }).success).toBe(false);
    expect(tenantSchema.safeParse({ ...tenant, password: 'unexpected-field' }).success).toBe(false);
  });
  it('requires complete caller-supplied passwords without returning sensitive validation input', () => {
    const tenant = loadTenant('acme');
    const passwords = Object.fromEntries(tenant.accounts.map((account) => [account.email, 'synthetic-unit-password']));
    expect(Object.keys(validatePasswords(tenant, passwords))).toHaveLength(4);
    expect(() => validatePasswords(tenant, {})).toThrow('Supply one valid password');
    expect(() => validatePasswords(tenant, { ...passwords, extra: 'synthetic-unit-password' })).toThrow(
      'Supply one valid password',
    );
    expect(() => validatePasswords(tenant, { ...passwords, [tenant.accounts[0]!.email]: 'short' })).toThrow(
      'Supply one valid password',
    );
  });
});

describe('REQ-18.1-03 sixteen tenant-specific guide articles', () => {
  for (const name of ['acme', 'beacon'] as const) {
    const tenant = loadTenant(name);
    const directory = `docs/user-guide/${name}`;
    const files = readdirSync(directory).sort();
    it(`${name} has eight numbered articles with typed front matter and no foreign client facts`, () => {
      expect(files).toHaveLength(8);
      for (const [index, file] of files.entries()) {
        const content = readFileSync(`${directory}/${file}`, 'utf8');
        expect(content).toMatch(
          new RegExp(
            `^---\nid: ['"]${String(index + 1).padStart(2, '0')}['"]\ntenant: ${name}\ntitle: .+\naudience: (patient|admin)\n---\n`,
          ),
        );
        expect(content).not.toMatch(
          name === 'acme' ? /Beacon|beacondental\.test|BEACON-SEED-MARKER/ : /Acme|acmephysio\.test/,
        );
      }
    });
    it(`${name} states the actual booking, cancellation, reschedule and email facts`, () => {
      const body = files.map((file) => readFileSync(`${directory}/${file}`, 'utf8')).join('\n');
      expect(body).toContain(
        name === 'acme' ? 'sessions with your physiotherapist' : 'appointments with your dentist or hygienist',
      );
      expect(body).toContain(`**${tenant.settings.sessionMinutes} minutes**`);
      expect(body).toContain(`**${tenant.settings.lateCancellationHours} hours**`);
      expect(body).toContain(`**${tenant.settings.maxReschedulesPerBooking} reschedules per booking**`);
      expect(body).toContain(tenant.mailFrom);
    });
    it(`${name} Article 08 retains the owner-required old password path baseline`, () => {
      const article = readFileSync(`${directory}/08-account-and-password.md`, 'utf8');
      expect(article).toContain('/account/reset-password');
      expect(article).not.toContain('/auth/forgot-password');
    });
  }
});
