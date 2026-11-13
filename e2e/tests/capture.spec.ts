import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectClean, login, settled, watch } from './helpers';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

test.use({ permissions: ['camera'] });

test('photograph an invoice with the in-app camera, check the photo and receive it', async ({
  page,
}, info) => {
  const w = watch(page);
  await login(page);
  await page.getByRole('button', { name: 'Chụp hóa đơn' }).click();
  const camera = page.getByRole('dialog', { name: 'Chụp ảnh hóa đơn' });
  const shutter = camera.getByRole('button', { name: 'Chụp', exact: true });
  await expect(shutter).toBeEnabled({ timeout: 15_000 });
  await shutter.click();
  const checks = camera.getByRole('list', { name: 'Kiểm tra ảnh' });
  // Every check passes for a well-lit, sharp invoice (resolution as delivered by the camera).
  await expect(checks).toContainText(/Độ phân giải \d+×\d+/);
  await expect(checks).toContainText('Ánh sáng tốt');
  await expect(checks).toContainText('Ảnh rõ nét');
  await expect(checks.locator('li.warn')).toHaveCount(0);
  await camera.getByRole('button', { name: 'Dùng ảnh & chụp trang tiếp' }).click();
  await expect(camera.getByText('Đã thêm 1 trang')).toBeVisible();
  await shutter.click();
  await camera.getByRole('button', { name: 'Dùng ảnh này' }).click();
  await expect(camera).toBeHidden();
  await expect(page.locator('.picked-file')).toHaveCount(2);
  await expect(page.locator('.picked-thumb')).toHaveCount(2);
  await page.getByRole('button', { name: /Tiếp nhận 2 tệp/ }).click();
  await expect(page.getByText(/Đã tiếp nhận lô/)).toBeVisible();
  await page.getByRole('button', { name: 'Kiểm tra' }).first().click();
  await settled(page, /Kiểm tra chứng từ|CT-\d+/);
  await expectClean(w, info);
});

test('without camera access the device photo picker is offered instead', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  });
  await login(page);
  await page.goto('/#/capture?camera=1');
  const camera = page.getByRole('dialog', { name: 'Chụp ảnh hóa đơn' });
  await expect(camera.getByRole('alert')).toContainText('chưa cho phép dùng camera');
  const chooser = page.waitForEvent('filechooser');
  await camera.getByRole('button', { name: 'Chọn ảnh từ thiết bị' }).click();
  await (await chooser).setFiles(path.join(fixtures, 'phieu-giao-hang-sua.jpg'));
  await expect(page.locator('.picked-file')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Kiểm tra ảnh' })).toContainText('Độ phân giải 600×800');
});
