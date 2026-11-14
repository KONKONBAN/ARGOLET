import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectClean, login, settled, watch } from './helpers';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

test.use({ permissions: ['camera'] });

test('photograph a document with the in-app camera, check the photo and receive it', async ({
  page,
}, info) => {
  const w = watch(page);
  await login(page);
  await page.goto('/#/documents');
  await settled(page, 'Chứng từ');
  await page.getByRole('button', { name: 'Chụp chứng từ' }).click();
  const camera = page.getByRole('dialog', { name: 'Chụp chứng từ' });
  const shutter = camera.getByRole('button', { name: 'Chụp', exact: true });
  await expect(shutter).toBeEnabled({ timeout: 15_000 });
  // Live guidance on the viewfinder: a well-lit, steady, sharp invoice is ready to be captured.
  await expect(camera.getByRole('status')).toContainText('Ảnh đã rõ, bấm nút chụp', { timeout: 15_000 });
  await expect(camera.getByRole('list', { name: 'Kiểm tra trực tiếp' }).locator('li.ok')).toHaveCount(3);
  await shutter.click();
  const sheet = camera.getByRole('region', { name: 'Kiểm tra ảnh vừa chụp' });
  await expect(sheet).toContainText('Ảnh đạt yêu cầu');
  const checks = sheet.getByRole('list', { name: 'Kiểm tra ảnh' });
  // Every check passes for a well-lit, sharp invoice (resolution as delivered by the camera).
  await expect(checks).toContainText(/Độ phân giải \d+,\d MP/);
  await expect(checks).toContainText('Ánh sáng tốt');
  await expect(checks).toContainText('Ảnh rõ nét');
  // The e-invoice QR is read right away, before the photo is even kept.
  await expect(checks).toContainText('Đã đọc mã QR hóa đơn số 778, 1.320.000 đ');
  await expect(checks.locator('li.warn')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Chụp trang tiếp' }).click();
  await expect(camera.getByText('Đã thêm 1 trang')).toBeVisible();
  await expect(camera.getByRole('button', { name: 'Xong, 1 trang' })).toBeVisible();
  await shutter.click();
  await sheet.getByRole('button', { name: 'Dùng ảnh này' }).click();
  await expect(camera).toBeHidden();
  await expect(page.locator('.picked-file')).toHaveCount(2);
  await expect(page.locator('.picked-thumb')).toHaveCount(2);
  // The QR printed on the invoice is read from the camera picture itself.
  await expect(page.getByRole('list', { name: 'Mã QR hóa đơn' }).first()).toContainText(
    'Mã QR hóa đơn: 1C26TSX, số 778, 29/10/2026, 1.320.000 đ, MST 0314222331',
  );
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
  const camera = page.getByRole('dialog', { name: 'Chụp chứng từ' });
  await expect(camera.getByRole('alert')).toContainText('chưa cho phép dùng camera');
  const chooser = page.waitForEvent('filechooser');
  await camera.getByRole('button', { name: 'Chọn ảnh từ thiết bị' }).click();
  await (await chooser).setFiles(path.join(fixtures, 'phieu-giao-hang-sua.jpg'));
  await expect(page.locator('.picked-file')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Kiểm tra ảnh' })).toContainText('Độ phân giải 0,5 MP');
});

test('automatic capture takes the picture once the document is steady and sharp', async ({ page }, info) => {
  const w = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/#/capture?camera=1');
  const camera = page.getByRole('dialog', { name: 'Chụp chứng từ' });
  await expect(camera.getByRole('button', { name: 'Chụp', exact: true })).toBeEnabled({ timeout: 15_000 });
  await camera.getByRole('radio', { name: 'Tự động chụp' }).click();
  // No tap on the shutter: the review sheet opens by itself.
  const sheet = camera.getByRole('region', { name: 'Kiểm tra ảnh vừa chụp' });
  await expect(sheet).toContainText('Ảnh đạt yêu cầu', { timeout: 15_000 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
  await sheet.getByRole('button', { name: 'Dùng ảnh này' }).click();
  await expect(camera).toBeHidden();
  await expect(page.locator('.picked-file')).toHaveCount(1);
  await expectClean(w, info);
});

test('the e-invoice QR on a photo fills in the invoice and exposes an altered total', async ({
  page,
}, info) => {
  const w = watch(page);
  await login(page);
  await page.goto('/#/capture');
  await settled(page, 'Tiếp nhận chứng từ');
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles(path.join(fixtures, 'hoa-don-sua-xanh-0000777.jpg'));
  // Read in the browser and verified with its CRC before anything is sent.
  await expect(page.getByRole('list', { name: 'Mã QR hóa đơn' })).toContainText(
    'Mã QR hóa đơn: 1C26TSX, số 777, 29/10/2026, 1.650.000 đ, MST 0314222331',
  );
  await page.getByRole('button', { name: /Tiếp nhận 1 tệp/ }).click();
  await expect(page.getByText(/Đã tiếp nhận lô/)).toBeVisible();
  await page.getByRole('button', { name: 'Kiểm tra' }).first().click();
  await settled(page, 'Kiểm tra chứng từ');
  // Filled in from the QR (it wins over any reading of the photo). The seller's name is not in the
  // QR: the server's OCR reads it from the photo (still to be reviewed); the browser-only app leaves it empty.
  await expect(page.getByLabel('MST người bán')).toHaveValue('0314222331');
  await expect(page.getByLabel('Ký hiệu hóa đơn')).toHaveValue('1C26TSX');
  await expect(page.getByLabel('Số chứng từ')).toHaveValue('777');
  await expect(page.getByLabel('Ngày chứng từ')).toHaveValue('29/10/2026');
  await expect(page.getByLabel('Tổng thanh toán')).toHaveValue('1.650.000 đ');
  await expect(page.getByLabel('Nhà cung cấp')).toHaveValue(
    info.project.name === 'static' ? '' : 'CÔNG TY TNHH SỮA XANH',
  );
  const panel = page.getByRole('region', { name: 'Kiểm tra chứng từ giả' });
  await expect(panel.locator('li.pass[data-check="QR"]')).toContainText('Đúng chuẩn của cơ quan thuế');

  // Someone types a bigger total than the invoice carries: the QR contradicts it.
  await page.getByLabel('Nhà cung cấp').fill('Công ty TNHH Sữa Xanh');
  await page.getByLabel('Tổng thanh toán').fill('7650000');
  await page.getByRole('button', { name: 'Lưu nháp' }).click();
  await expect(panel.locator('li.fail[data-check="QR"]')).toContainText(
    'Mã QR ghi Tổng tiền thanh toán 1650000 nhưng chứng từ ghi 7650000',
  );
  await expect(panel).toContainText('Rủi ro cao');

  // Back to the invoice's real total: every check passes and the document is confirmed.
  await page.getByLabel('Tổng thanh toán').fill('1650000');
  await page.getByRole('button', { name: 'Lưu nháp' }).click();
  await expect(panel.locator('li.pass[data-check="QR"]')).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận chứng từ' }).click();
  const ack = page.getByRole('checkbox', { name: /Tôi đã kiểm tra và xác nhận cảnh báo/ });
  if (await ack.isVisible().catch(() => false)) {
    await ack.check();
    await page.getByRole('button', { name: 'Xác nhận chứng từ' }).click();
  }
  await expect(page).toHaveURL(/#\/evidence\/[^/]+$/);
  await expectClean(w, info);
});
