import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectClean, login, settled, watch } from './helpers';

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

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
    'Mã QR hóa đơn: 1C26TSX · số 777 · 29/10/2026 · 1.650.000 đ · MST 0314222331',
  );
  await page.getByRole('button', { name: /Tiếp nhận 1 tệp/ }).click();
  await expect(page.getByText(/Đã tiếp nhận lô/)).toBeVisible();
  await page.getByRole('button', { name: 'Kiểm tra' }).first().click();
  await settled(page, 'Kiểm tra chứng từ');
  // Filled in from the QR, nothing invented: the seller's name is not in the QR.
  await expect(page.getByLabel('MST người bán')).toHaveValue('0314222331');
  await expect(page.getByLabel('Ký hiệu hóa đơn')).toHaveValue('1C26TSX');
  await expect(page.getByLabel('Số chứng từ')).toHaveValue('777');
  await expect(page.getByLabel('Ngày chứng từ')).toHaveValue('29/10/2026');
  await expect(page.getByLabel('Tổng thanh toán')).toHaveValue('1.650.000 đ');
  await expect(page.getByLabel('Nhà cung cấp')).toHaveValue('');
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
