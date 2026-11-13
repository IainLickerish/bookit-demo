import { expect, test, type Page } from '@playwright/test';
import { ADMIN, signIn, step } from './support';

async function expectTypeface(page: Page, testId: string, family: 'Fraunces' | 'Figtree') {
  const element = page.getByTestId(testId);
  await expect(element).toBeVisible();
  await expect(element).toHaveCSS('font-family', new RegExp(`^"?${family}"?(,|$)`));
  // A family name alone can hide a failed download and a fallback font.
  expect(
    await element.evaluate(async (node, name) => {
      const style = getComputedStyle(node);
      // Empty form controls still need a character to exercise font loading.
      const fonts = await document.fonts.load(
        `${style.fontWeight} ${style.fontSize} "${name}"`,
        node.textContent || ' ',
      );
      return fonts.length > 0 && fonts.every((font) => font.status === 'loaded');
    }, family),
  ).toBe(true);
}

test('Clinic names and titles use locally served Fraunces and other text uses locally served Figtree, with both licences included and no outside font requests', async ({
  page,
}) => {
  const fontRequests: string[] = [];
  const outsideFontRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === 'font') fontRequests.push(url.href);
    if (
      url.origin !== new URL(page.url()).origin &&
      (request.resourceType() === 'font' || /fonts\.(googleapis|gstatic)\.com/.test(url.hostname))
    ) {
      outsideFontRequests.push(url.href);
    }
  });

  await step(page, 'Open BookIt and see the clinic name and title in Fraunces, with the form in Figtree', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expectTypeface(page, 'clinic-name', 'Fraunces');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Fraunces/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-weight', '500');
    await expectTypeface(page, 'sign-in-email', 'Figtree');
    await expectTypeface(page, 'sign-in-submit', 'Figtree');
    await expect(page.getByText('Email address', { exact: true })).toHaveCSS('font-family', /Figtree/);
  });

  await step(page, 'Sign in as staff and see the same typefaces on the clinic home screen', async () => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await expectTypeface(page, 'clinic-name', 'Fraunces');
    await expect(page.getByRole('heading', { level: 1, name: 'Clinic administration' })).toHaveCSS(
      'font-family',
      /Fraunces/,
    );
    await expectTypeface(page, 'admin-home', 'Figtree');
    await expectTypeface(page, 'home-clinic-bookings', 'Figtree');
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCSS('font-family', /Figtree/);
  });

  await step(page, 'On a phone, see the same fonts on a missing page, all supplied by BookIt', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/a-page-that-does-not-exist');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toHaveCSS('font-family', /Fraunces/);
    await expectTypeface(page, 'not-found-home', 'Figtree');
    await expectTypeface(page, 'clinic-name', 'Fraunces');
    const origin = new URL(page.url()).origin;
    expect(fontRequests.some((url) => url.includes('/fonts/fraunces-'))).toBe(true);
    expect(fontRequests.some((url) => url.includes('/fonts/figtree-'))).toBe(true);
    expect(fontRequests.every((url) => new URL(url).origin === origin)).toBe(true);
    expect(outsideFontRequests).toEqual([]);
  });

  await step(page, 'Find both font licences supplied by BookIt alongside its fonts', async () => {
    for (const family of ['fraunces', 'figtree']) {
      const response = await page.request.get(`/fonts/${family}-OFL.txt`);
      expect(response.ok()).toBe(true);
      const licence = await response.text();
      expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(licence).toMatch(new RegExp(`Copyright.*${family}`, 'i'));
    }
  });
});
