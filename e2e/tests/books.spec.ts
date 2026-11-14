import { readFile } from 'node:fs/promises';
import { expect, test, type Download } from '@playwright/test';
import { expectClean, go, login, watch } from './helpers';

/** The workbook is a real .xlsx (ZIP, stored parts): its XML can be read back as text. */
async function workbook(download: Promise<Download>) {
  const d = await download;
  const bytes = await readFile((await d.path())!);
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  return { name: d.suggestedFilename(), text: bytes.toString('utf8') };
}

test('accounting books are exported as real Excel files on the Ministry of Finance forms', async ({
  page,
}, info) => {
  const w = watch(page);
  await login(page);
  await go(page, 'books', 'Sổ sách & thuế');
  // A company (Thông tư 133): the confirmed source records, for the accountant's postings.
  const company = await workbook(
    Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Xuất bảng kê chứng từ (Excel)' }).click(),
    ]).then(([d]) => d),
  );
  expect(company.name).toBe('bang-ke-chung-tu-2026-10.xlsx');
  expect(company.text).toContain('BẢNG KÊ CHỨNG TỪ ĐÃ XÁC NHẬN');

  if (info.project.name !== 'static') return expectClean(w, info); // API mode shares the organisation

  // Switch to a household paying VAT and PIT as a % of revenue (Thông tư 152/2025, Điều 5).
  await go(page, 'settings', /Cài đặt/);
  await page
    .locator('.tile')
    .filter({ hasText: 'Thông tin tổ chức' })
    .getByRole('button', { name: /Quản lý/ })
    .click();
  const dlg = page.getByRole('dialog', { name: 'Thông tin tổ chức' });
  await expect(dlg.locator('#regime option[value="TT99"]')).toHaveText(/Thông tư 99\/2025/);
  await dlg.locator('#regime').selectOption('HKD');
  await dlg.getByLabel('Địa chỉ (in trên sổ kế toán)').fill('45 Lê Lợi, TP. Hồ Chí Minh');
  await dlg.getByLabel('Nộp thuế GTGT và TNCN theo tỷ lệ % trên doanh thu').check();
  await dlg.getByLabel('Ngành nghề 1').fill('Phân phối, cung cấp hàng hóa');
  await dlg.getByLabel('Tỷ lệ GTGT (%)').fill('1');
  await dlg.getByLabel('Tỷ lệ TNCN (%)').fill('0.5');
  await dlg.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByText('Đã lưu cài đặt')).toBeVisible();

  await go(page, 'books', 'Sổ sách & thuế');
  const household = await workbook(
    Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Xuất sổ kế toán (Excel)' }).click(),
    ]).then(([d]) => d),
  );
  expect(household.name).toBe('so-ke-toan-hkd-2026-10.xlsx');
  for (const s of [
    'Mẫu số S2a-HKD',
    '(Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)',
    'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
    'Địa chỉ: 45 Lê Lợi, TP. Hồ Chí Minh',
    '1. Ngành nghề Phân phối, cung cấp hàng hóa',
    'Thuế GTGT (1%)',
    'Thuế TNCN (0.5%)',
    'NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/ CÁ NHÂN KINH DOANH',
  ])
    expect(household.text).toContain(s);
  await expectClean(w, info);
});
