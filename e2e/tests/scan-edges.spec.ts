import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectClean, login, watch } from './helpers';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

// A camera looking at an invoice lying at an angle on a dark desk.
test.use({
  permissions: ['camera'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${path.join(fixtures, 'camera-hoa-don-tren-ban.mjpeg')}`,
    ],
  },
});

test('the scanner finds the sheet on the desk, straightens it and can crop it by hand', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'static', 'Image processing runs in the browser: once is enough');
  const w = watch(page);
  await login(page);
  await page.goto('/#/capture?camera=1');
  const camera = page.getByRole('dialog', { name: 'Chụp chứng từ' });
  // The sheet is outlined live on the viewfinder.
  await expect(camera.locator('.scan-quad polygon')).toBeVisible({ timeout: 15_000 });
  await expect(camera.getByRole('status')).toContainText('Ảnh đã rõ', { timeout: 15_000 });
  await camera.getByRole('button', { name: 'Chụp', exact: true }).click();
  const review = camera.getByRole('region', { name: 'Kiểm tra ảnh vừa chụp' });
  await expect(review.getByRole('radio', { name: 'Tài liệu' })).toHaveAttribute('aria-checked', 'true');
  // Straightened: the landscape camera picture became an upright page, the desk cut away.
  const size = await camera.locator('img.scan-shot').evaluate(
    (img: HTMLImageElement) =>
      new Promise<[number, number]>((r) => {
        const done = () => r([img.naturalWidth, img.naturalHeight]);
        if (img.complete) done();
        else img.onload = done;
      }),
  );
  expect(size[1]).toBeGreaterThan(size[0]);
  await expect(review.getByRole('list', { name: 'Kiểm tra ảnh' })).toContainText(
    'Đã đọc mã QR hóa đơn số 778, 1.320.000 đ',
  );
  // The page keeps the detail the sheet had in the picture: no "too small" warning.
  await expect(review.getByRole('list', { name: 'Kiểm tra ảnh' }).locator('li.warn')).toHaveCount(0);
  // Crop by hand: four corners, moved with the keyboard too.
  await review.getByRole('button', { name: 'Cắt lại' }).click();
  const corner = camera.getByRole('slider', { name: 'Góc trên trái' });
  await corner.focus();
  await page.keyboard.press('ArrowRight');
  await review.getByRole('button', { name: 'Áp dụng' }).click();
  await expect(camera.locator('img.scan-shot')).toBeVisible();
  await review.getByRole('radio', { name: 'Đen trắng' }).click();
  await expect(review.getByRole('radio', { name: 'Đen trắng' })).toHaveAttribute('aria-checked', 'true');
  await review.getByRole('button', { name: 'Dùng ảnh này' }).click();
  await expect(camera).toBeHidden();
  await expect(page.locator('.picked-file')).toHaveCount(1);
  await expectClean(w, info);
});
