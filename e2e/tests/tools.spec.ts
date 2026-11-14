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
  await page.getByLabel('Lãi suất (%/năm)').fill('10');
  await page.getByLabel('Số kỳ trả nợ').fill('6');
  await expect(page.getByText('6.862.456 đ')).toBeVisible();
  await expect(page.getByLabel('Số tiền vay')).toHaveValue('40.000.000');
  await expect(page.locator('.tool-table tbody tr')).toHaveCount(6);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Xuất Excel' }).click(),
  ]);
  expect(file.suggestedFilename()).toBe('lich-tra-no-vay.xlsx');

  // Đòn bẩy: DOL 2, DTL 2,63; ROE theo MM = ROE theo DuPont = 30,4%.
  await page.getByRole('tab', { name: 'Đòn bẩy & chỉ số' }).click();
  await page.getByLabel('Doanh thu thuần').fill('1000000000');
  await page.getByLabel('Biến phí', { exact: true }).fill('600000000');
  await page.getByLabel('Định phí', { exact: true }).fill('200000000');
  await page.getByLabel('Chi phí lãi vay').fill('48000000');
  await page.getByLabel('Tổng tài sản').fill('1000000000');
  await page.getByLabel('Vốn chủ sở hữu').fill('400000000');
  await expect(page.getByText('2,00 lần').first()).toBeVisible();
  await expect(page.getByText('2,63 lần')).toBeVisible();
  // ROE 30,40%; vay nợ làm ROE tăng thêm 30,40% − 16,00% = 14,40% (Modigliani–Miller mở rộng).
  await expect(page.getByText('30,40%', { exact: true })).toBeVisible();
  await expect(page.getByText(/làm ROE tăng thêm 14,40%/)).toBeVisible();

  // Lãi kép: 100 trđ, 10%/năm, 5 năm, ghép lãi năm → 161.051.000 đ; lãi đơn 150.000.000 đ.
  await page.getByRole('tab', { name: 'Lãi đơn & lãi kép' }).click();
  await page.getByLabel('Số tiền gốc').fill('100000000');
  await page.getByLabel('Lãi suất (%/năm)').fill('10');
  await page.getByLabel('Thời gian (năm)').fill('5');
  await expect(page.getByText('161.051.000 đ')).toBeVisible();
  await expect(page.getByText('150.000.000 đ')).toBeVisible();

  // Chiết khấu thương phiếu (chương 3, ví dụ 5): AGIO 9.947.945 đ.
  await page.getByRole('tab', { name: 'Chiết khấu thương phiếu' }).click();
  await page.getByLabel('Mệnh giá thương phiếu').fill('300000000');
  await page.getByLabel('Lãi suất chiết khấu (%/năm)').fill('9,6');
  await page.getByLabel('Ngày chiết khấu').fill('2026-08-02');
  await page.getByLabel('Ngày đáo hạn').fill('2026-11-15');
  await page.getByLabel('Hoa hồng ký hậu (%/năm)').fill('1');
  await page.getByLabel('Hoa hồng chung (%)').fill('0,1');
  await page.getByLabel('Phí khác').fill('500000');
  await expect(page.getByText(/105 ngày/).first()).toBeVisible();
  await expect(page.getByText('9.947.945 đ').first()).toBeVisible();
  await expect(page.getByText('290.052.055 đ')).toBeVisible();

  // Kỳ khoản trả dần 100 trđ trong 12 kỳ, 1%/kỳ: PMT = 8.884.879 đ (Excel PMT).
  await page.getByRole('tab', { name: 'Chuỗi tiền tệ' }).click();
  await page.getByLabel('Lãi suất mỗi kỳ (%)').fill('1');
  await page.getByLabel('Số kỳ').fill('12');
  await page.getByLabel('Hoặc: số tiền hiện tại cần trả dần').fill('100000000');
  await expect(page.getByText('8.884.879 đ', { exact: true })).toBeVisible();

  // WACC: E 3 tỷ, D 1,5 tỷ, rₑ 15%, r_d 12%, t 20% → 2/3 × 15% + 1/3 × 9,6% = 13,20%.
  await page.getByRole('tab', { name: 'Chi phí vốn WACC' }).click();
  await page.getByLabel('Vốn chủ sở hữu', { exact: true }).fill('3000000000');
  await page.getByLabel('Nợ vay').fill('1500000000');
  await page.getByLabel('Chi phí vốn chủ sở hữu (%)').fill('15');
  await page.getByLabel('Lãi suất vay (%)').fill('12');
  await expect(page.getByText('13,20%').first()).toBeVisible();

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
