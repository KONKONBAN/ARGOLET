import { expect, test } from '@playwright/test';
import { expectClean, go, login, noHorizontalOverflow, watch } from './helpers';

/**
 * Công cụ tính toán: the worked examples of the course materials give the same answers in the
 * browser (loan schedule, leverage, bill discount, depreciation).
 */
test('financial calculators give the textbook answers', async ({ page }, info) => {
  const w = watch(page);
  await login(page);
  await go(page, 'finance-tools', 'Công cụ tính toán');

  // Vay 40 trđ, 10%/năm, 6 kỳ tháng, trả góp đều: PMT = 6.862.456 đ (Excel).
  await page.getByLabel('Số tiền vay').fill('40000000');
  await page.getByLabel('Lãi suất · %/năm').fill('10');
  await page.getByLabel('Số kỳ trả nợ').fill('6');
  await expect(page.getByText('6.862.456 đ')).toBeVisible();
  await expect(page.locator('.tool-table tbody tr')).toHaveCount(6);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Xuất Excel' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe('lich-tra-no-vay.xlsx');

  // Đòn bẩy: DOL 2, DTL 2,63; ROE theo MM = ROE theo DuPont = 30,4%.
  await page.getByRole('tab', { name: 'Đòn bẩy & chỉ số' }).click();
  await page.getByLabel('Doanh thu thuần').fill('1000000000');
  await page.getByLabel('Biến phí (chi phí thay đổi theo doanh thu)').fill('600000000');
  await page.getByLabel('Định phí (không gồm lãi vay)').fill('200000000');
  await page.getByLabel('Chi phí lãi vay').fill('48000000');
  await page.getByLabel('Tổng tài sản').fill('1000000000');
  await page.getByLabel('Vốn chủ sở hữu').fill('400000000');
  await expect(page.getByText('2,00 lần').first()).toBeVisible();
  await expect(page.getByText('2,63 lần')).toBeVisible();
  await expect(page.getByText('30,40%')).toHaveCount(2);

  // Chiết khấu thương phiếu (chương 3, ví dụ 5): AGIO 9.947.945 đ.
  await page.getByRole('tab', { name: 'Lãi suất & chiết khấu' }).click();
  await page.getByLabel('Mệnh giá thương phiếu').fill('300000000');
  await page.getByLabel('Lãi suất chiết khấu · %/năm').fill('9,6');
  await page.getByLabel('Ngày chiết khấu').fill('2026-08-02');
  await page.getByLabel('Ngày đáo hạn').fill('2026-11-15');
  await page.getByLabel('Hoa hồng ký hậu · %/năm').fill('1');
  await page.getByLabel('Hoa hồng chung · % mệnh giá').fill('0,1');
  await page.getByLabel('Phí khác').fill('500000');
  await expect(page.getByText('105 ngày')).toBeVisible();
  await expect(page.getByText('9.947.945 đ')).toBeVisible();

  // Khấu hao số dư giảm dần (TT45/2013, phụ lục 2): 20 – 12 – 7,2 – 5,4 – 5,4 trđ.
  await page.getByRole('tab', { name: 'Khấu hao TSCĐ' }).click();
  await page.getByLabel('Nguyên giá').fill('50000000');
  await page.getByLabel('Phương pháp khấu hao').selectOption('DECLINING');
  const amounts = page.locator('.tool-table tbody tr td:nth-child(3)');
  await expect(amounts).toHaveText(['20.000.000', '12.000.000', '7.200.000', '5.400.000', '5.400.000']);

  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await expectClean(w, info);
});
