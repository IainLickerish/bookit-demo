import { execFile } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { buildComposeImage, prepareComposeTenant, type ComposeTenant } from '../tests/helpers/compose';
import { bookSlot, bookingRow, demoPassword, evalNow, londonDate, signIn } from './support';

const execute = promisify(execFile);
export const HOUR = 3_600_000;

/** These copies belong only to this eval. No running demo's clock or records are changed. */
export class CancellationClinic {
  private contexts: BrowserContext[] = [];
  constructor(readonly copy: ComposeTenant) {}

  async client(browser: Browser, number = 1): Promise<Page> {
    return this.open(browser, `patient${number}@patients.${this.copy.tenant.domain}`);
  }

  async staff(browser: Browser): Promise<Page> {
    return this.open(browser, `admin@${this.copy.tenant.domain}`);
  }

  async visitor(browser: Browser): Promise<Page> {
    const context = await browser.newContext({ baseURL: this.copy.url });
    this.contexts.push(context);
    return context.newPage();
  }

  private async open(browser: Browser, email: string): Promise<Page> {
    const page = await this.visitor(browser);
    await signIn(page, email);
    return page;
  }

  async refreshSignIn(page: Page, account = 'patient1'): Promise<void> {
    const login = await page.context().newPage();
    await signIn(
      login,
      account === 'admin' ? `admin@${this.copy.tenant.domain}` : `${account}@patients.${this.copy.tenant.domain}`,
    );
    await login.close();
  }

  async close(): Promise<void> {
    await Promise.all(this.contexts.map((context) => context.close()));
  }

  /** Advance only this test's fixed clock, before the next browser action. Never move it back. */
  advanceTo(instant: number): void {
    expect(instant).toBeGreaterThanOrEqual(evalNow().getTime());
    // The existing Compose fixture bind-mounts the file, so preserve its inode.
    writeFileSync(this.copy.clockFile, JSON.stringify({ now: new Date(instant).toISOString() }));
  }

  async showDay(page: Page, date: string): Promise<void> {
    await page.goto('/slots');
    await page.getByTestId('practitioner-select').selectOption({ label: this.copy.tenant.practitioners[0]!.name });
    await page.getByTestId('date-input').fill(date);
    await page.getByTestId('show-slots').click();
    await expect(page.getByTestId('date-input')).toHaveValue(date);
  }

  async book(page: Page, daysAhead = 4) {
    const date = londonDate(daysAhead);
    await this.showDay(page, date);
    const slot = page.getByTestId('slot-link').first();
    await expect(slot).toBeVisible();
    const slotId = (await slot.getAttribute('data-slot-id'))!;
    const startsAt = Date.parse((await slot.getAttribute('data-starts-at'))!);
    expect(Number.isFinite(startsAt)).toBe(true);
    const when = await bookSlot(page, slotId);
    const row = bookingRow(page, 'upcoming-bookings', when);
    await expect(row.getByTestId('booking-status')).toHaveText('Confirmed');
    const id = (await row.getAttribute('data-booking-id'))!;
    return { id, slotId, startsAt, date, when };
  }

  async offered(page: Page, booking: TestBooking): Promise<boolean> {
    await this.showDay(page, booking.date);
    return (await page.locator(`[data-testid="slot-link"][data-slot-id="${booking.slotId}"]`).count()) === 1;
  }

  async window(staff: Page, hours: number): Promise<void> {
    await staff.goto('/admin/settings');
    await staff.getByTestId('admin-late-hours').fill(String(hours));
    await staff.getByTestId('admin-save-settings').click();
    await expect(staff.getByTestId('admin-settings-saved')).toBeVisible();
  }

  async sql(statement: string): Promise<string> {
    const result = await this.copy.command([
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'postgres',
      '-d',
      'bookit',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      statement,
    ]);
    expect(result.code, 'the disposable fixture is ready').toBe(0);
    return result.output.trim();
  }

  /** The real save fails inside PostgreSQL; the browser response is never replaced or intercepted. */
  async failCancellationSave(): Promise<void> {
    await this.sql(`
      create function reject_cancellation() returns trigger language plpgsql as $$
      begin raise exception 'Test cancellation save failure'; end; $$;
      create trigger reject_cancellation after update on booking
      for each row when (new.status = 'cancelled') execute function reject_cancellation();
    `);
  }

  async restoreSaving(): Promise<void> {
    await this.sql('drop trigger reject_cancellation on booking; drop function reject_cancellation();');
  }

  async existingFlows(files: string[], output: string): Promise<void> {
    const result = await execute(
      'bun',
      ['x', 'playwright', 'test', '-c', 'evals', ...files, '--reporter=json', `--output=${output}`],
      {
        env: {
          ...process.env,
          EVAL_BASE_URL: this.copy.url,
          EVAL_MAIL_URL: `http://127.0.0.1:${this.copy.env.BOOKIT_MAIL_PORT}`,
          EVAL_NOW: evalNow().toISOString(),
        },
        timeout: 240_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const report = JSON.parse(result.stdout) as { stats: { unexpected: number; skipped: number; expected: number } };
    expect(report.stats.unexpected).toBe(0);
    expect(report.stats.skipped).toBe(0);
    expect(report.stats.expected).toBeGreaterThan(0);
    await base.info().attach(path.basename(output), { body: result.stdout, contentType: 'application/json' });
  }
}

export type TestBooking = Awaited<ReturnType<CancellationClinic['book']>>;

async function withClinic(name: 'acme' | 'beacon', exercise: (clinic: CancellationClinic) => Promise<void>) {
  const copy = await prepareComposeTenant(name);
  const clinic = new CancellationClinic(copy);
  // Reuse the supplied fictional demo password with the existing browser sign-in helper.
  const accountFile = path.join(copy.privateDir, 'accounts.json');
  chmodSync(accountFile, 0o600);
  writeFileSync(
    accountFile,
    JSON.stringify(Object.fromEntries(Object.keys(copy.accounts).map((email) => [email, demoPassword()]))),
  );
  chmodSync(accountFile, 0o444);
  writeFileSync(copy.clockFile, JSON.stringify({ now: evalNow().toISOString() }));
  try {
    expect((await copy.start()).code, `${name}'s disposable copy starts`).toBe(0);
    await exercise(clinic);
  } finally {
    await clinic.close();
    await copy.stop();
  }
}

export const test = base.extend<{ acme: CancellationClinic; beacon: CancellationClinic }, { cancellationImage: void }>({
  cancellationImage: [
    async ({}, use) => {
      expect((await buildComposeImage(true)).code, 'build the current branch for disposable clinic copies').toBe(0);
      await use();
    },
    { scope: 'worker', timeout: 660_000 },
  ],
  acme: [
    async ({ cancellationImage }, use) => {
      void cancellationImage;
      await withClinic('acme', use);
    },
    { timeout: 300_000 },
  ],
  beacon: [
    async ({ cancellationImage }, use) => {
      void cancellationImage;
      await withClinic('beacon', use);
    },
    { timeout: 300_000 },
  ],
});
