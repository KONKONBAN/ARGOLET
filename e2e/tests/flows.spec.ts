import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectClean, go, login, settled, watch } from './helpers';

/**
 * Business flows from the FigJam operating diagram, each in a fresh browser context.
 * Static mode: every context starts from its own copy of the demo data.
 * API mode: contexts share one server database, so assertions check outcomes only.
 */
test.describe('core business flows', () => {
  test('approve a payment request from the inbox', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await go(page, 'inbox', 'Việc cần xử lý');
    const row = page.getByText('Duyệt chi mua nguyên liệu', { exact: true }).first();
    await row.click();
    await expect(page).toHaveURL(/#\/approvals\/[^/]+$/);
    await expect(page.getByText('Luồng phê duyệt')).toBeVisible();
    await page.getByRole('button', { name: 'Phê duyệt hồ sơ' }).click();
    await expect(page.getByText('Đã phê duyệt hồ sơ')).toBeVisible();
    await expect(page).toHaveURL(/#\/inbox$/);
    await settled(page, 'Việc cần xử lý');
    // Gone from the pending work, listed under decided approvals with its outcome.
    const pending = page.locator('.card').first();
    await expect(pending.getByText('Duyệt chi mua nguyên liệu', { exact: true })).toHaveCount(0);
    const decided = page
      .locator('.card')
      .filter({ has: page.getByRole('heading', { name: 'Đã xử lý gần đây' }) });
    await expect(decided.getByRole('row').filter({ hasText: 'Duyệt chi mua nguyên liệu' })).toContainText(
      'Đã phê duyệt',
    );
    await expectClean(w, info);
  });

  test('review and confirm a document, which anchors evidence', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await go(page, 'documents', 'Chứng từ');
    await page
      .getByText(/^CT-1028/)
      .first()
      .click();
    await expect(page).toHaveURL(/#\/documents\/[^/]+\/review$/);
    await settled(page, /Kiểm tra chứng từ/);
    const confirm = page.getByRole('button', { name: /Xác nhận chứng từ|Xác nhận & lưu/ });
    await confirm.click();
    // Warnings (e.g. date needs checking) require an explicit second confirmation.
    if (
      !(await page.waitForURL(/#\/evidence\//, { timeout: 4000 }).then(
        () => true,
        () => false,
      ))
    ) {
      await confirm.click();
      await page.waitForURL(/#\/evidence\//);
    }
    await settled(page, 'Bằng chứng & lịch sử');
    await expect(page.getByText(/Đã xác nhận CT-1028/)).toBeVisible();
    await expect(page.getByText(/EV-\d{8}-\d{3}/).first()).toBeVisible();
    await expectClean(w, info);
  });

  test('a suspicious e-invoice is flagged and booked only after acknowledging the checks', async ({
    page,
  }, info) => {
    const w = watch(page);
    await login(page);
    // Unsigned and issued to another company's tax code; the arithmetic is right.
    const no = String(Date.now()).slice(-7);
    const xml = info.outputPath(`hd-${no}.xml`);
    await writeFile(
      xml,
      `<?xml version="1.0" encoding="UTF-8"?><HDon><DLHDon><TTChung><KHMSHDon>1</KHMSHDon><KHHDon>C26TNV</KHHDon><SHDon>${no}</SHDon><NLap>2026-10-30</NLap><HTTToan>CK</HTTToan></TTChung>
<NDHDon><NBan><Ten>Nguyên liệu Việt</Ten><MST>0312345673</MST></NBan><NMua><Ten>Công ty khác</Ten><MST>0100109106</MST></NMua>
<DSHHDVu><HHDVu><THHDVu>Cà phê hạt</THHDVu><ThTien>2000000</ThTien><TSuat>10%</TSuat></HHDVu></DSHHDVu>
<TToan><THTTLTSuat><LTSuat><TSuat>10%</TSuat><ThTien>2000000</ThTien><TThue>200000</TThue></LTSuat></THTTLTSuat>
<TgTCThue>2000000</TgTCThue><TgTThue>200000</TgTThue><TgTTTBSo>2200000</TgTTTBSo></TToan></NDHDon></DLHDon>
<MCCQT>00ABCDEF0123456789</MCCQT></HDon>`,
    );
    await go(page, 'capture', 'Tiếp nhận chứng từ');
    await page.locator('input[type=file][multiple]').setInputFiles(xml);
    await page.getByRole('button', { name: /Tiếp nhận 1 tệp/ }).click();
    await expect(page.getByText(/Đã tiếp nhận lô/)).toBeVisible();
    await page.getByRole('button', { name: 'Kiểm tra' }).first().click();
    await settled(page, 'Kiểm tra chứng từ');
    const panel = page.getByRole('region', { name: 'Kiểm tra chứng từ giả' });
    await expect(panel).toContainText('Rủi ro cao');
    await expect(panel.locator('li.fail[data-check="SIGNATURE"]')).toContainText('Chữ ký số của người bán');
    await expect(panel.locator('li.fail[data-check="ADDRESSEE"]')).toContainText('0100109106');
    await expect(panel.locator('li.pass[data-check="TAX_CODE"]')).toBeVisible();
    await expect(panel.locator('li.pass[data-check="ARITHMETIC"]')).toBeVisible();
    await expect(panel.getByRole('link', { name: /cổng hóa đơn điện tử/ })).toHaveAttribute(
      'href',
      'https://hoadondientu.gdt.gov.vn/',
    );
    const confirm = page.getByRole('button', { name: 'Xác nhận chứng từ' });
    await confirm.click();
    await expect(page.getByText(/Chứng từ có dấu hiệu bất thường: .*chữ ký số/)).toBeVisible();
    await page.getByRole('checkbox', { name: /Tôi đã kiểm tra và xác nhận cảnh báo/ }).check();
    await confirm.click();
    await expect(page).toHaveURL(/#\/evidence\/[^/]+$/);
    await expectClean(w, info);
  });

  test('integrity check: original passes, tampered file is detected', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await go(page, 'evidence', /Bằng chứng/);
    await page
      .locator('table tbody tr, .list-item.clickable, [role="row"]')
      .filter({ hasText: 'CT-1027' })
      .first()
      .click();
    await expect(page).toHaveURL(/#\/evidence\/[^/]+$/);
    await settled(page, 'Bằng chứng & lịch sử');
    await page.getByRole('button', { name: /Kiểm chứng hồ sơ/ }).click();
    await expect(page).toHaveURL(/#\/verification\/[^/]+$/);
    await settled(page, 'Kiểm tra toàn vẹn');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Tải bản gốc mẫu XML/ }).click();
    const file = await (await download).path();
    const original = await readFile(file, 'utf8');
    expect(original).toContain('<');

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Chọn tệp & kiểm chứng/ }).click();
    await (await chooser).setFiles(file);
    await expect(page.getByText('Toàn vẹn đã xác minh').first()).toBeVisible();

    const tampered = info.outputPath('tampered.xml');
    await writeFile(tampered, original.replace(/3680000|3\.680\.000/, '3980000'));
    const chooser2 = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Chọn tệp & kiểm chứng/ }).click();
    await (await chooser2).setFiles(tampered);
    await expect(page.getByText(/Phát hiện sai khác/).first()).toBeVisible();
    await expectClean(w, info);
  });

  test('confirm a reconciliation group with M:N allocation', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await go(page, 'reconciliation', 'Đối soát đa nguồn');
    await page
      .getByText(/^DS-1032/)
      .first()
      .click();
    await expect(page).toHaveURL(/#\/reconciliation\/[^/]+$/);
    await settled(page, 'Chi tiết đối soát');
    const confirm = page.getByRole('button', { name: /^Xác nhận/ }).first();
    if (await confirm.isEnabled()) {
      await confirm.click();
      await expect(page.getByText(/Đã xác nhận kết quả đối soát|Đã gửi nhóm/).first()).toBeVisible();
    }
    await expect(page.getByText(/DS-1032, (Đã xác nhận|Khớp, chờ duyệt)/)).toBeVisible();
    await expectClean(w, info);
  });

  test('submit the daily shift close (G1)', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await go(page, 'daily-close', /Chốt ca/);
    const submit = page.getByRole('button', { name: 'Gửi chốt ca' });
    if (await submit.count()) {
      await submit.click();
      await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận gửi' }).click();
      await expect(page.getByText(/Đã gửi chốt ca, không có chênh lệch|Đã gửi chốt ca kèm/)).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Gửi chốt ca' })).toHaveCount(0);
    await expectClean(w, info);
  });

  test('create a purchase order that routes into approval (G1)', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await go(page, 'purchasing', /Mua hàng/);
    await page.getByRole('button', { name: 'Tạo đơn mua' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Nhà cung cấp').fill('Cà phê Cầu Đất');
    await dlg.getByLabel('Giá trị (đ)').fill('3200000');
    await dlg.getByLabel('Hạn thanh toán').fill('2026-11-20');
    await dlg.getByLabel('Mục đích').fill('Nhập cà phê hạt tháng 11');
    await dlg
      .getByRole('button', { name: /Tạo|Gửi/ })
      .last()
      .click();
    await expect(page).toHaveURL(/#\/approvals\//);
    await settled(page, 'Phê duyệt hồ sơ');
    await expect(page.getByText('3.200.000 đ').first()).toBeVisible();
    await expectClean(w, info);
  });

  test('recalculate the project appraisal (G3)', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await go(page, 'finance', /Phân tích tài chính|Thẩm định/);
    await expect(page.getByText('137,24 triệu').first()).toBeVisible();
    await page.getByLabel('Dòng tiền thuần / năm (triệu đ)').fill('320');
    await page.getByRole('button', { name: 'Tính lại kịch bản' }).click();
    await expect(page.getByText(/Đã tính lại, mã lần tính/)).toBeVisible();
    await expect(page.getByText('213,05 triệu').first()).toBeVisible();
    await expectClean(w, info);
  });

  test('reject a document with a reason; it stays visible as rejected', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await go(page, 'documents/doc_1012/review', 'Kiểm tra chứng từ');
    await page.getByRole('button', { name: 'Từ chối chứng từ' }).click();
    const d = page.getByRole('dialog', { name: 'Từ chối CT-1012' });
    await d.getByRole('button', { name: 'Ảnh mờ, không đọc được' }).click();
    await expect(d.getByLabel('Lý do từ chối')).toHaveValue('Ảnh mờ, không đọc được');
    await d.getByRole('button', { name: 'Từ chối', exact: true }).click();
    await expect(page.getByText('Đã từ chối CT-1012')).toBeVisible();
    await go(page, 'documents/doc_1012/review', 'Kiểm tra chứng từ');
    await expect(page.getByText('Chứng từ đã bị từ chối')).toBeVisible();
    await expect(page.getByText('Ảnh mờ, không đọc được').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xác nhận chứng từ' })).toBeDisabled();
    await expectClean(w, info);
  });

  test('invite a member with a scoped role', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await go(page, 'members', /Thành viên/);
    await page.getByRole('button', { name: 'Mời thành viên' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Email').fill(`moi.${Date.now()}@minhan.example`);
    await dlg.getByRole('button', { name: 'Gửi lời mời' }).click();
    await expect(page.getByText('Đã tạo lời mời')).toBeVisible();
    await expectClean(w, info);
  });

  test('ask the assistant about unmatched items', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await go(page, 'assistant', /Trợ lý/);
    const box = page.getByRole('textbox').last();
    await box.fill('Khoản nào chưa khớp?');
    await box.press('Enter');
    await expect(page.getByText(/nhóm chưa xác nhận/).first()).toBeVisible({ timeout: 30_000 });
    await expectClean(w, info);
  });

  test('global search finds a document', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    const search = page.getByRole('searchbox').or(page.getByPlaceholder(/Tìm/)).first();
    await search.fill('CT-1026');
    await expect(page.getByText(/CT-1026/).first()).toBeVisible();
    await expectClean(w, info);
  });
});
