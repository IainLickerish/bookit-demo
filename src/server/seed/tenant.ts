import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { clinicSettingsInput } from '../settings';

export const tenantName = z.enum(['acme', 'beacon']);
export type TenantName = z.infer<typeof tenantName>;
const text = z.string().min(1).max(300);
const fictionalEmail = z.email().refine((value) => value.endsWith('.test'));
const account = z.strictObject({
  email: fictionalEmail,
  name: text,
  role: z.enum(['patient', 'admin']),
  phone: z
    .string()
    .regex(/^\+44 7700 900\d{3}$/)
    .nullable(),
});

export const tenantSchema = z
  .strictObject({
    version: z.literal(1),
    tenant: tenantName,
    product: z.enum(['ACME', 'BEACON']),
    client: z.enum(['ACMEPHYSIO', 'BEACONDENTAL']),
    domain: z.enum(['acmephysio.test', 'beacondental.test']),
    allowedSenderDomains: z.array(text).length(1),
    mailFrom: fictionalEmail,
    branding: z.strictObject({ practitionerLabel: text, welcome: text }),
    settings: clinicSettingsInput.strict(),
    supportHours: text,
    tone: text,
    contacts: z
      .array(z.strictObject({ name: text, title: text, role: z.enum(['contact', 'approver']), email: fictionalEmail }))
      .length(2),
    endpoints: z.strictObject({ staging: z.url(), production: z.url(), inbound: fictionalEmail }),
    accounts: z.array(account).min(2).max(10),
    practitioners: z
      .array(
        z.strictObject({
          name: text,
          bio: text,
          workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
          workdayStart: z.literal('09:00'),
          workdayEnd: z.literal('17:00'),
        }),
      )
      .min(1)
      .max(5),
  })
  .superRefine((tenant, ctx) => {
    const domain = tenant.tenant === 'acme' ? 'acmephysio.test' : 'beacondental.test';
    const client = tenant.tenant === 'acme' ? 'ACMEPHYSIO' : 'BEACONDENTAL';
    const invalid =
      tenant.domain !== domain ||
      tenant.client !== client ||
      tenant.product !== tenant.tenant.toUpperCase() ||
      tenant.allowedSenderDomains[0] !== domain ||
      tenant.mailFrom !== `noreply@${domain}` ||
      tenant.contacts.some((contact) => !contact.email.endsWith(`@${domain}`)) ||
      tenant.accounts.some(
        (user) => !user.email.endsWith(user.role === 'admin' ? `@${domain}` : `@patients.${domain}`),
      ) ||
      new Set(tenant.accounts.map((user) => user.email)).size !== tenant.accounts.length ||
      tenant.accounts.filter((user) => user.role === 'admin').length !== 1;
    if (invalid) ctx.addIssue({ code: 'custom', message: 'Tenant identity, domain or account boundary mismatch' });
  });

export type Tenant = z.infer<typeof tenantSchema>;

/** The caller selects one of two checked-in files, never an arbitrary path. */
export function loadTenant(name: unknown): Tenant {
  const selected = tenantName.parse(name);
  const file = path.resolve(import.meta.dirname, '../../..', 'tenants', `${selected}.json`);
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const result = tenantSchema.parse(parsed);
  if (result.tenant !== selected) throw new Error('Tenant file identity mismatch');
  return result;
}
