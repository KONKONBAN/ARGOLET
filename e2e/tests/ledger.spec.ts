import { expect, test } from '@playwright/test';
import { expectClean, go, login, noHorizontalOverflow, watch } from './helpers';

/**
 * Sổ sách & chỉ số: the books are kept from confirmed documents without typing anything; the
 * statements balance, the workbook downloads, and the calculators and the appraisal take their
 * figures from the books.
 */
test('the books, statements and ratios come straight from the documents', async ({ page }, info) => {
  const w = watch(page);
  await login(page);
  await go(page, 'finance-books', 'Sổ sách & chỉ số');
  await expect(page.getByRole('heading', { name: 'Khả năng sinh lời' })).toBeVisible();
  await expect(page.getByText('Tỷ suất lợi nhuận trên vốn chủ sở hữu (ROE)')).toBeVisible();

  await page.getByRole('radio', { name: 'Kết quả kinh doanh' }).click();
  await expect(page.getByText('Lợi nhuận sau thuế thu nhập doanh nghiệp')).toBeVisible();
  await expect(page.getByText('Doanh thu thuần về bán hàng và cung cấp dịch vụ')).toBeVisible();

  await page.getByRole('radio', { name: 'Tình hình tài chính' }).click();
  const total = (label: string) =>
    page.locator('tr').filter({ hasText: label }).locator('td').last().innerText();
  expect(await total('Tổng cộng tài sản')).toBe(await total('Tổng cộng nguồn vốn'));

  await page.getByRole('radio', { name: 'Nhật ký chung' }).click();
  await expect(page.getByRole('heading', { name: 'Sổ Nhật ký chung' })).toBeVisible();
  await expect(page.locator('.books-journal tbody tr')).toHaveCount(10);

  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Xuất Excel' }).click(),
  ]);
  expect(file.suggestedFilename()).toMatch(/^so-ke-toan-\d{4}-\d{2}-den-\d{4}-\d{2}\.xlsx$/);

  // The leverage calculator takes revenue, costs, assets and equity from the books.
  await go(page, 'finance-tools?tool=leverage', 'Công cụ tính toán');
  await page.getByRole('button', { name: 'Lấy từ sổ sách' }).click();
  await expect(page.getByLabel('Doanh thu thuần')).not.toHaveValue('');
  await expect(page.getByText('Đòn bẩy tổng hợp (DTL)')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await go(page, 'finance-books', 'Sổ sách & chỉ số');
  await noHorizontalOverflow(page);
  await expectClean(w, info);
});
