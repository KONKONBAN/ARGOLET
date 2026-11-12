import { expect, type Page, type TestInfo } from '@playwright/test';

export const DEMO = { contact: 'ketoan@minhan.example', password: 'Argolet@2026' };

/**
 * Collects console errors, uncaught exceptions and 5xx responses. Expected 4xx responses
 * (wrong password, step-up) only produce "Failed to load resource" noise, which is ignored.
 */
export function watch(page: Page): { problems: string[] } {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return;
    problems.push(`console: ${text.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return { problems };
}

export async function expectClean(w: { problems: string[] }, info?: TestInfo): Promise<void> {
  if (w.problems.length && info) await info.attach('problems', { body: w.problems.join('\n') });
  expect(w.problems, 'console errors / page errors / 5xx').toEqual([]);
}

/**
 * Waits until skeletons are gone and the page heading is visible. Pass the expected title
 * when navigating: React Router keeps the previous page on screen during lazy transitions.
 */
export async function settled(page: Page, title?: string | RegExp): Promise<string> {
  const h1 = page.locator('h1').first();
  if (title !== undefined) await expect(h1).toHaveText(typeof title === 'string' ? new RegExp(`^\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) : title);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(h1).toBeVisible();
  return (await h1.textContent())?.trim() ?? '';
}

export async function fillLogin(page: Page, contact: string, password: string): Promise<void> {
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(contact);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

/** Signs in with the demo account and opens the Minh An Commerce workspace. */
export async function login(page: Page): Promise<void> {
  await fillLogin(page, DEMO.contact, DEMO.password);
  await expect(page.getByRole('heading', { name: 'Chọn không gian làm việc' })).toBeVisible();
  await page.getByText('Minh An Commerce', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tổng quan kinh doanh' })).toBeVisible();
  await settled(page);
}

export async function go(page: Page, route: string, title?: string | RegExp): Promise<string> {
  await page.goto(`/#/${route}`);
  return settled(page, title);
}

/** Types a 6-digit code into the segmented OTP control. */
export async function typeOtp(page: Page, code: string, group = 'Mã xác minh'): Promise<void> {
  await page.getByRole('group', { name: group }).locator('input').first().click();
  await page.keyboard.type(code);
}

export async function noHorizontalOverflow(page: Page): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}
