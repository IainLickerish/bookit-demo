import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const E2E_DIR = path.join(ROOT, 'test-results/m0-24a/e2e');
export const STATE_FILE = path.join(E2E_DIR, 'state.json');
export const E2E_START = '2026-10-20T07:00:00.000Z';

export interface E2eState {
  databaseUrl: string;
  clockFile: string;
  serverLog: string;
  password: string;
  patient1: string;
  patient2: string;
}

export function loadState(): E2eState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2eState;
}

/** Rewrites the shared virtual clock file atomically, as test-control does. */
export function writeClock(file: string, now: string): void {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ now })}\n`);
  renameSync(temporary, file);
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(loadState().password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page).toHaveURL(/\/bookings$/);
}

export async function showDay(page: Page, practitioner: string, date: string): Promise<void> {
  await page.getByTestId('practitioner-select').selectOption({ label: practitioner });
  await page.getByTestId('date-input').fill(date);
  await page.getByTestId('show-slots').click();
  await expect(page.getByTestId('date-input')).toHaveValue(date);
}

export async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client(loadState().databaseUrl);
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

export function serverLogLines(): Record<string, unknown>[] {
  return readFileSync(loadState().serverLog, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
