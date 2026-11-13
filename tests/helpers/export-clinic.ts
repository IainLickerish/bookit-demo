import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COMPOSE_CLOCK, prepareComposeTenant } from './compose';

// Fictional names for fresh test copies only. Keep the normal tenant seeds unchanged.
export const EXPORT_CLIENTS = ['Zoë Brontë', 'Zoe\u0308 Bronte\u0308', '=架空, "Δοκιμή"\nعميل تجريبي'];

export async function prepareExportClinic(name: 'acme' | 'beacon') {
  const clinic = await prepareComposeTenant(name);
  for (const [index, account] of clinic.tenant.accounts.filter((account) => account.role === 'patient').entries()) {
    account.name = EXPORT_CLIENTS[index]!;
  }
  clinic.tenant.practitioners.push({ ...clinic.tenant.practitioners[0]!, name: 'Robin Export Test' });
  const tenantFile = path.join(clinic.directory, `${name}.json`);
  writeFileSync(tenantFile, JSON.stringify(clinic.tenant));
  writeFileSync(clinic.clockFile, JSON.stringify({ now: process.env.EVAL_NOW ?? COMPOSE_CLOCK }));
  const overrideFile = path.join(clinic.directory, 'compose.override.json');
  const override = JSON.parse(readFileSync(overrideFile, 'utf8')) as {
    services: Record<string, { volumes?: string[] }>;
  };
  for (const service of ['seed', 'bookit']) {
    override.services[service]!.volumes!.push(`${tenantFile}:/app/tenants/${name}.json:ro`);
  }
  writeFileSync(overrideFile, JSON.stringify(override));
  return clinic;
}
