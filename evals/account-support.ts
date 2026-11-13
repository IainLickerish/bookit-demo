import { expect, type Page } from '@playwright/test';
import acme from '../tenants/acme.json' with { type: 'json' };
import beacon from '../tenants/beacon.json' with { type: 'json' };
import { demoPassword } from './support';

/** Use the fictional accounts belonging to whichever clinic this demo is running. */
export async function accountClinic(page: Page) {
  const name = await page.getByTestId('clinic-name').textContent();
  const clinic = [acme, beacon].find((tenant) => tenant.settings.clinicName === name);
  expect(clinic, 'the demo is one of the two fictional clinics').toBeDefined();
  return clinic!;
}

export async function expectAccountCard(page: Page) {
  const card = page.getByTestId('account-card');
  await expect(card).toBeVisible();
  await expect(page.locator('main .card')).toHaveCount(1);
  await expect(card.locator('.card')).toHaveCount(0);
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(card).toHaveCSS('border-radius', '20px');
  await expect(card).toHaveCSS('padding', '24px');
  await expect(card).toHaveCSS('max-width', '440px');
  await expect(card).not.toHaveCSS('box-shadow', 'none');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 248, 244)');
  await expect(card).toHaveCSS('font-family', /Figtree/);
  await expect(card.locator('.page-header h1')).toHaveCSS('font-family', /Fraunces/);
  await expect(card.locator('.page-header h1')).toHaveCSS('font-weight', '500');
  const bounds = await card.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(440);
  const pageWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(Math.abs(bounds!.x + bounds!.width / 2 - pageWidth / 2)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

export async function expectAccountAtBothWidths(page: Page) {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expectAccountCard(page);
  }
}

export async function expectAccountFields(page: Page, fields: [string, string, string][], submit: string) {
  for (const [id, label, autocomplete] of fields) {
    const field = page.getByTestId(id);
    await expect(field).toHaveAccessibleName(label);
    await expect(field).toHaveAttribute('autocomplete', autocomplete);
    await expect(field).toHaveAttribute('required', '');
    await expect(field).toHaveCSS('min-height', '48px');
    await expect(field).toHaveCSS('border-radius', '12px');
    await expect(field).toHaveCSS('border-color', 'rgb(140, 151, 146)');
    const width = await field.evaluate((node) => ({
      field: node.getBoundingClientRect().width,
      label: node.closest('label')!.getBoundingClientRect().width,
    }));
    expect(width.field).toBeCloseTo(width.label, 0);
  }
  const button = page.getByTestId(submit);
  await expect(button).toHaveCSS('min-height', '48px');
  await expect(button).toHaveCSS('border-radius', '999px');
  await expect(button).toHaveCSS('background-color', 'rgb(29, 92, 75)');
  await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
}

export async function expectAccountKeyboard(page: Page, controls: string[]) {
  await page.getByTestId('clinic-name').focus();
  for (const id of controls) {
    await page.keyboard.press('Tab');
    const control = page.getByTestId(id);
    await expect(control).toBeFocused();
    await expect(control).toHaveCSS('outline-color', 'rgb(29, 92, 75)');
    await expect(control).toHaveCSS('outline-style', 'solid');
    await expect(control).toHaveCSS('outline-width', '3px');
  }
}

export async function signInAccount(page: Page, email: string, password = demoPassword()) {
  await page.goto('/auth/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(password);
  await page.getByTestId('sign-in-submit').click();
}

export async function requestAccountReset(page: Page, email: string) {
  await page.goto('/auth/sign-in');
  await page.getByTestId('forgot-password-link').click();
  await page.getByTestId('forgot-password-email').fill(email);
  await page.getByTestId('forgot-password-submit').click();
  await expect(page).toHaveURL(/\/auth\/forgot-password\?sent=1$/);
  await expect(page.getByTestId('forgot-password-sent')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('forgot-password-sent')).toHaveText(
    'If an account uses that email address, we have sent it a link to reset the password. The link works for 30 minutes.',
  );
  await expect(page.locator('body')).not.toContainText('/auth/reset-password/');
  await expect(page.locator('a[href*="/auth/reset-password/"]')).toHaveCount(0);
}

export async function setAccountPassword(page: Page, password: string, confirmation = password) {
  await page.getByTestId('reset-password-new').fill(password);
  await page.getByTestId('reset-password-confirm').fill(confirmation);
  await page.getByTestId('reset-password-submit').click();
}
