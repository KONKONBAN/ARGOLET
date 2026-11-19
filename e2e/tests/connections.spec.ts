import { expect, test } from '@playwright/test';
import { expectClean, go, login, watch } from './helpers';

const TOKEN = 'e2e-sepay-token-0000000000000000000000000000000000000000000000AB12';

test('partner API connections: SePay connected, synced into a document, then up to date', async ({
  page,
}, info) => {
  const w = watch(page);
  await login(page);
  await page.getByRole('link', { name: 'Kết nối API' }).click();
  await expect(page.locator('h1')).toHaveText('Kết nối API');
  // iPOS gives its API to partners only: shown as waiting for the partner's documentation.
  await expect(page.locator('.conn-tile').filter({ hasText: 'iPOS' })).toContainText(
    'Cần tài liệu từ đối tác',
  );
  const sepay = page.locator('.conn-tile').filter({ hasText: 'Ngân hàng qua SePay' });

  if (info.project.name === 'static') {
    // The in-browser app calls the partner itself; when the browser blocks it, it says so plainly.
    await sepay.getByRole('button', { name: 'Kết nối' }).click();
    const dialog = page.getByRole('dialog', { name: 'Kết nối Ngân hàng qua SePay' });
    await dialog.getByLabel('API Token').fill(TOKEN);
    await dialog.getByRole('button', { name: 'Kiểm tra & kết nối' }).click();
    await expect(dialog).toContainText('Trình duyệt không cho trang web gọi thẳng tới');
    // The browser's own report of the blocked request is expected here; nothing else may fail.
    w.problems = w.problems.filter((x) => !/net::ERR_|Failed to fetch|CORS/i.test(x));
    await expectClean(w, info);
    return;
  }

  await sepay.getByRole('button', { name: 'Kết nối' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kết nối Ngân hàng qua SePay' });
  await expect(dialog).toContainText('Vào my.sepay.vn, chọn Cấu hình Công ty, API Access');
  await dialog.getByLabel('API Token').fill('token-sai');
  await dialog.getByRole('button', { name: 'Kiểm tra & kết nối' }).click();
  await expect(dialog.getByText('SePay từ chối thông tin xác thực')).toBeVisible();
  await dialog.getByLabel('API Token').fill(TOKEN);
  await dialog.getByRole('button', { name: 'Kiểm tra & kết nối' }).click();
  await expect(page.getByText('SePay xác nhận 1 tài khoản: VCB đuôi 5631').first()).toBeVisible();
  await expect(dialog).toBeHidden();
  const card = page.locator('.card').filter({ hasText: 'Khóa đuôi AB12' });
  await expect(card).toContainText('Đang hoạt động');
  await expect(page.locator('body')).not.toContainText(TOKEN);

  await card.getByRole('button', { name: 'Đồng bộ ngay' }).click();
  await expect(page.getByText(/Nhận 2 bản ghi, ghi nhận 2 dòng mới vào CT-\d+/).first()).toBeVisible();
  await card.getByRole('button', { name: 'Đồng bộ ngay' }).click();
  await expect(page.getByText('Không có dữ liệu mới từ đối tác').first()).toBeVisible();

  // The document created by the sync opens from the history.
  await card.locator('table tbody tr').filter({ hasText: 'Thành công' }).getByRole('button').first().click();
  await expect(page.locator('h1')).toHaveText('Kiểm tra chứng từ');
  await expect(page.getByText('Giao dịch ngân hàng SePay').first()).toBeVisible();
  await go(page, 'connections', 'Kết nối API');
  await expectClean(w, info);
});
