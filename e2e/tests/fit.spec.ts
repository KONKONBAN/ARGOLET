/**
 * Automatic fit to the screen: phones and tablets as designed, short laptop screens a little
 * smaller, large monitors larger; full-height panels stay one screen tall; the mode can be turned
 * off and on from the account page and is remembered.
 */
import { expect, test, type Page } from '@playwright/test';
import { expectClean, go, login, noHorizontalOverflow, settled, watch } from './helpers';

const fit = (page: Page) =>
  page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--fit')));

const sidebarFillsScreen = async (page: Page) => {
  const { h, ih } = await page.evaluate(() => ({
    h: Math.round(document.querySelector('.sidebar')!.getBoundingClientRect().height),
    ih: innerHeight,
  }));
  expect(Math.abs(h - ih)).toBeLessThanOrEqual(1);
};

test('the interface fits phones, tablets, laptops and large monitors', async ({ page }, info) => {
  test.skip(info.project.name !== 'static', 'Layout only: once is enough');
  const w = watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const screens: [number, number, number][] = [
    [360, 740, 1],
    [768, 1024, 1],
    [1280, 720, 0.9],
    [1440, 900, 1],
    [1920, 1080, 1.2],
    [2560, 1440, 1.47],
  ];
  for (const [width, height, k] of screens) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => fit(page)).toBe(k);
    for (const [route, title] of [
      ['overview', 'Tổng quan kinh doanh'],
      ['documents', 'Chứng từ'],
      ['finance-report', 'Báo cáo tài chính'],
      ['finance-tools', 'Công cụ tính toán'],
    ] as const) {
      await go(page, route, title);
      await noHorizontalOverflow(page);
    }
    if (width > 1180) await sidebarFillsScreen(page);
  }
  // On a 2K monitor the page now fills most of the screen instead of a narrow column.
  await page.setViewportSize({ width: 2560, height: 1440 });
  await go(page, 'overview', 'Tổng quan kinh doanh');
  const used = await page.evaluate(() => document.querySelector('.page')!.getBoundingClientRect().width);
  expect(used).toBeGreaterThan(1900);
  await expectClean(w, info);
});

test('automatic fit can be turned off and on, and is remembered on this device', async ({ page }, info) => {
  test.skip(info.project.name !== 'static', 'Device preference: once is enough');
  const w = watch(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await login(page);
  await go(page, 'security', 'Bảo mật tài khoản');
  const card = page.locator('.card', { hasText: 'Hiển thị trên thiết bị này' });
  await expect(card.getByRole('status')).toHaveText('Màn hình 1920 x 1080 px, giao diện đang hiển thị 120%');
  const toggle = card.getByRole('switch', { name: 'Tự động căn chỉnh theo màn hình' });
  await expect(toggle).toBeChecked();

  await toggle.uncheck();
  await expect.poll(() => fit(page)).toBe(1);
  await expect(card.getByRole('status')).toHaveText(
    'Màn hình 1920 x 1080 px, giao diện đang hiển thị 100% (đã tắt tự động)',
  );
  await page.reload();
  await settled(page, 'Bảo mật tài khoản');
  await expect.poll(() => fit(page)).toBe(1);
  await expect(toggle).not.toBeChecked();

  await toggle.check();
  await expect.poll(() => fit(page)).toBe(1.2);
  // The larger text still works on top of the fit.
  const large = card.getByRole('switch', { name: 'Chữ lớn' });
  await large.check();
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large');
  await sidebarFillsScreen(page);
  await noHorizontalOverflow(page);
  await large.uncheck();
  await expectClean(w, info);
});
