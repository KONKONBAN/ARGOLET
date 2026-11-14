import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { expectClean, watch } from '../helpers';

/**
 * A real company on an empty server (no demo data, real calendar), through the web UI:
 * structure → intake of real source files → review → reconciliation → shift close → stock &
 * recipe → purchase approval by a second person → sales → project → appraisal → assets →
 * logistics → subsidiary & intercompany → period close with step-up → evidence check.
 */
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures');

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const dlg = (p: Page) => p.getByRole('dialog');
const toast = (p: Page, re: RegExp) =>
  expect(p.locator('.toast').filter({ hasText: re }).first()).toBeVisible();
async function settle(p: Page, title?: string | RegExp) {
  if (title) await expect(p.locator('h1').first()).toHaveText(title);
  await expect(p.locator('[aria-busy="true"]')).toHaveCount(0);
}
async function go(p: Page, route: string, title: string | RegExp) {
  await p.goto(`/#/${route}`);
  await settle(p, title);
}
async function otp(p: Page, code: string) {
  await p.getByRole('group', { name: 'Mã xác minh' }).locator('input').first().click();
  await p.keyboard.type(code);
}
async function signUp(p: Page, name: string, email: string, password: string) {
  await p.goto('/#/register');
  await p.getByLabel('Họ và tên').fill(name);
  await p.getByLabel('Email hoặc số điện thoại').fill(email);
  await p.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await p.getByRole('checkbox').check();
  await p.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(p.getByRole('heading', { name: 'Xác minh tài khoản' })).toBeVisible();
  const code = (
    (await p
      .getByText(/mã xác minh:/)
      .locator('b')
      .textContent()) ?? ''
  ).trim();
  await otp(p, code);
  await p
    .getByRole('button', { name: /Xác minh|Xác nhận/ })
    .first()
    .click();
}

test('a new company runs the whole product from an empty server', async ({ browser }, info) => {
  const stamp = Date.now();
  const ownerEmail = `chu.tiem.${stamp}@thuha.vn`;
  const approverEmail = `duyet.${stamp}@thuha.vn`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const w = watch(page);

  await test.step('register the owner and create the organisation', async () => {
    await signUp(page, 'Trần Thu Hà', ownerEmail, 'TiemBanhThuHa#2026');
    await page.getByRole('button', { name: /Tạo tổ chức mới/ }).click();
    await page.getByLabel('Tên tổ chức').fill('Tiệm bánh Thu Hà');
    await page.getByLabel('Loại hình').selectOption('Hộ kinh doanh');
    await page.getByRole('button', { name: /Tạo tổ chức & tiếp tục/ }).click();
    await page.getByRole('button', { name: 'Vào không gian làm việc' }).click();
    await settle(page, 'Tổng quan kinh doanh');
  });

  await test.step('add a store', async () => {
    await go(page, 'settings', /Cài đặt/);
    await page
      .getByRole('button', { name: /Quản lý/ })
      .first()
      .click();
    await dlg(page).getByLabel('Tên đơn vị').fill('Cửa hàng Nguyễn Trãi');
    await dlg(page).getByRole('button', { name: 'Thêm', exact: true }).click();
    await toast(page, /Đã thêm Cửa hàng Nguyễn Trãi/);
    await page.keyboard.press('Escape');
  });

  await test.step('upload POS export, bank statement, e-invoice and a photo', async () => {
    await go(page, 'capture', 'Tiếp nhận chứng từ');
    await page
      .locator('input[type=file][multiple]')
      .setInputFiles(
        [
          'don-hang-grabfood-t11.csv',
          'sao-ke-vcb-t11.csv',
          'hoa-don-bot-mi-0000215.xml',
          'phieu-giao-hang-sua.jpg',
        ].map((f) => path.join(fixtures, f)),
      );
    await page.getByRole('button', { name: /Tiếp nhận 4 tệp/ }).click();
    await toast(page, /Đã tiếp nhận lô/);
    await go(page, 'documents', 'Chứng từ');
    await expect(page.locator('.pager-info')).toContainText('1–4 trên 4 chứng từ');
  });

  const confirmDoc = async (label: RegExp, fill?: () => Promise<void>) => {
    await go(page, 'documents', 'Chứng từ');
    await page.locator('table tbody tr').filter({ hasText: label }).first().click();
    await settle(page, /Kiểm tra chứng từ/);
    if (fill) await fill();
    const ack = page.getByText(/Tôi đã kiểm tra và xác nhận cảnh báo/);
    if (await ack.count()) await ack.click();
    await page.getByRole('button', { name: /Xác nhận chứng từ/ }).click();
    await page.waitForURL(/#\/evidence\//);
  };
  await test.step('review and confirm every document (incl. a VAT invoice)', async () => {
    await confirmDoc(/Báo cáo nền tảng/);
    await confirmDoc(/Sao kê ngân hàng/);
    await confirmDoc(/Bột mì Sao Vàng/);
    await confirmDoc(/Hóa đơn mua hàng|Tệp cần kiểm tra/, async () => {
      await page.getByLabel('Nhà cung cấp').fill('Sữa tươi Mộc Châu');
      await page.getByLabel('Số chứng từ').fill('PGH-7781');
      await page.getByLabel('Ngày chứng từ').fill('10/11/2026');
      await page.getByLabel('Tổng thanh toán').fill('640000');
    });
  });

  await test.step('reconcile platform payouts against bank credits', async () => {
    await go(page, 'reconciliation', 'Đối soát đa nguồn');
    await page.getByRole('button', { name: 'Chạy đối soát' }).click();
    await toast(page, /đề xuất 3 nhóm mới/);
    for (let i = 0; i < 3; i++) {
      await go(page, 'reconciliation?filter=review', 'Đối soát đa nguồn');
      await page
        .locator('table tbody tr')
        .filter({ hasText: /Cần xác nhận/ })
        .first()
        .click();
      await settle(page, 'Chi tiết đối soát');
      await page
        .getByRole('button', { name: /^Xác nhận/ })
        .first()
        .click();
      await toast(page, /Đã xác nhận kết quả đối soát/);
    }
  });

  await test.step('open and close a shift with a counted difference', async () => {
    await go(page, 'daily-close', /Chốt ca/);
    await page.getByRole('button', { name: 'Mở ca mới' }).click();
    await dlg(page).getByLabel('Tiền mặt theo hệ thống').fill('1500000');
    await dlg(page).getByRole('button', { name: 'Mở ca' }).click();
    await toast(page, /Đã mở ca sáng/);
    await page.getByRole('button', { name: 'Gửi chốt ca' }).click();
    await dlg(page)
      .getByLabel(/Tiền mặt · hệ thống/)
      .fill('1450000');
    await dlg(page)
      .getByLabel(/Ghi chú/)
      .fill('Trả lại tiền thừa cho khách');
    await dlg(page).getByRole('button', { name: 'Xác nhận gửi' }).click();
    await toast(page, /kèm giải thích chênh lệch/);
  });

  await test.step('stock items and recipe costing', async () => {
    await go(page, 'inventory', /Kho/);
    for (const [name, qty, cost, min] of [
      ['Bột mì', '50', '20000', '10'],
      ['Bơ', '5', '180000', '5'],
    ] as const) {
      await page.getByRole('button', { name: 'Thêm nguyên liệu' }).first().click();
      await dlg(page).getByLabel('Tên nguyên liệu').fill(name);
      await dlg(page).getByLabel('Tồn hiện có').fill(qty);
      await dlg(page)
        .getByLabel(/Đơn giá vốn/)
        .fill(cost);
      await dlg(page).getByLabel('Mức cảnh báo sắp hết').fill(min);
      await dlg(page).getByRole('button', { name: 'Thêm vào kho' }).click();
      await toast(page, new RegExp(`Đã thêm ${name}`));
    }
    await page.getByRole('button', { name: 'Tạo công thức' }).click();
    await dlg(page).getByLabel('Tên món / sản phẩm').fill('Bánh mì bơ');
    await dlg(page).getByLabel('Giá bán').fill('25000');
    await dlg(page).getByLabel('Tỷ lệ hao hụt (%)').fill('5');
    await dlg(page).getByLabel('Định lượng').first().fill('0.1');
    await dlg(page).getByRole('button', { name: 'Thêm nguyên liệu' }).click();
    await dlg(page).getByLabel('Nguyên liệu 2', { exact: true }).selectOption({ label: 'Bơ (kg)' });
    await dlg(page).getByLabel('Định lượng').nth(1).fill('0.02');
    await dlg(page).getByRole('button', { name: 'Lưu công thức' }).click();
    await toast(page, /Đã lưu công thức/);
    await expect(page.getByText('5.880 đ').first()).toBeVisible();
  });

  let inviteCode = '';
  await test.step('purchase order: the maker cannot approve, an invited approver does', async () => {
    await go(page, 'purchasing', /Mua hàng/);
    await page.getByRole('button', { name: 'Tạo đơn mua' }).click();
    await dlg(page).getByLabel('Nhà cung cấp').fill('Bột mì Sao Vàng');
    await dlg(page).getByLabel('Giá trị (đ)').fill('2750000');
    await dlg(page).getByLabel('Hạn thanh toán').fill('2026-11-20');
    await dlg(page).getByLabel('Mục đích').fill('Nhập bột mì');
    await dlg(page)
      .getByRole('button', { name: /Tạo|Gửi/ })
      .last()
      .click();
    await page.waitForURL(/#\/approvals\//);
    await settle(page, 'Phê duyệt hồ sơ');
    await expect(page.getByRole('button', { name: 'Phê duyệt hồ sơ' })).toHaveCount(0);

    await go(page, 'members', /Thành viên/);
    await page.getByRole('button', { name: 'Mời thành viên' }).click();
    await dlg(page).getByLabel('Email').fill(approverEmail);
    await dlg(page).locator('select').first().selectOption({ label: 'Người duyệt' });
    const limit = dlg(page).getByLabel(/Hạn mức/);
    if (await limit.count()) await limit.fill('10000000');
    await dlg(page).getByRole('button', { name: 'Gửi lời mời' }).click();
    await toast(page, /Đã tạo lời mời/);
    await go(page, 'members', /Thành viên/);
    inviteCode = (
      (await page
        .getByText(/INV-[A-Za-z0-9]+/)
        .first()
        .textContent()) ?? ''
    ).match(/INV-[A-Za-z0-9]+/)![0];

    const approver = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const wa = watch(approver);
    await signUp(approver, 'Lê Văn Duyệt', approverEmail, 'NguoiDuyet#2026x');
    await approver.waitForTimeout(1000);
    if (!/invite/.test(approver.url())) {
      await approver.getByRole('button', { name: /Tôi có mã mời/ }).click();
      await approver.getByLabel('Mã mời').fill(inviteCode);
      await approver
        .getByRole('button', { name: /Tiếp tục|Xem lời mời|Kiểm tra/ })
        .first()
        .click();
    }
    await approver
      .getByRole('button', { name: /Chấp nhận|Tham gia/ })
      .first()
      .click();
    await approver.waitForTimeout(1000);
    if (/workspaces/.test(approver.url()))
      await approver.getByText('Tiệm bánh Thu Hà', { exact: true }).click();
    await go(approver, 'inbox', 'Việc cần xử lý');
    await approver
      .getByText(/Đề nghị chi nhập bột mì/)
      .first()
      .click();
    await settle(approver, 'Phê duyệt hồ sơ');
    await approver.getByRole('button', { name: 'Phê duyệt hồ sơ' }).click();
    await toast(approver, /Đã phê duyệt hồ sơ/);
    await expectClean(wa, info);
    await approver.close();
  });

  await test.step('sales, project, appraisal, assets', async () => {
    await go(page, 'sales', /Bán hàng/);
    await page.getByRole('button', { name: 'Tạo cơ hội' }).first().click();
    await dlg(page).getByLabel('Khách hàng').fill('Quán cà phê Gió');
    await dlg(page).getByLabel('Giá trị dự kiến').fill('12000000');
    await dlg(page).getByRole('button', { name: 'Tạo cơ hội' }).click();
    await toast(page, /Đã tạo cơ hội/);
    await page.locator('table tbody tr').filter({ hasText: 'Quán cà phê Gió' }).first().click();
    await dlg(page).getByLabel('Bước hiện tại').selectOption({ label: 'Hợp đồng' });
    await dlg(page).getByRole('button', { name: 'Lưu' }).click();
    await toast(page, /Đã cập nhật bước/);

    await go(page, 'projects', /Dự án/);
    await page.getByRole('button', { name: 'Tạo dự án' }).first().click();
    await dlg(page).getByLabel('Tên dự án').fill('Mở cửa hàng thứ hai');
    await dlg(page).getByLabel('Chủ nhiệm').fill('Trần Thu Hà');
    await dlg(page).getByLabel('Ngân sách được duyệt').fill('300000000');
    await dlg(page).getByRole('button', { name: 'Tạo dự án' }).click();
    await toast(page, /Đã tạo dự án DA-001/);
    await page.getByRole('button', { name: 'Thêm công việc' }).click();
    await dlg(page).getByLabel('Tên công việc').fill('Thuê mặt bằng');
    await dlg(page).getByLabel('Phụ trách').fill('Thu Hà');
    await dlg(page).getByRole('button', { name: 'Thêm' }).click();
    await toast(page, /Đã thêm công việc 1.1/);
    await page.locator('table tbody tr').filter({ hasText: 'Thuê mặt bằng' }).click();
    await dlg(page).getByLabel('Tiến độ (%)').fill('100');
    await dlg(page).getByRole('button', { name: 'Lưu tiến độ' }).click();
    await toast(page, /Đã cập nhật tiến độ/);

    await go(page, 'finance', 'Phân tích tài chính');
    await page.getByRole('button', { name: 'Tạo dự án thẩm định' }).click();
    await dlg(page).getByLabel('Tên dự án').fill('Cửa hàng thứ hai');
    await dlg(page).getByLabel('Đầu tư ban đầu · triệu đ').fill('300');
    await dlg(page).getByLabel('Dòng tiền thuần / năm · triệu đ').fill('90');
    await dlg(page).getByLabel('Suất chiết khấu · % / năm').fill('12');
    await dlg(page).getByLabel('Trả nợ / năm · triệu đ').fill('60');
    await dlg(page).getByRole('button', { name: 'Tạo và tính' }).click();
    await toast(page, /Đã tạo dự án TD-001/);
    await expect(page.getByText('1,50 lần').first()).toBeVisible();

    await go(page, 'assets', /Tài sản/);
    await page.getByRole('button', { name: 'Thêm tài sản / chỉ số' }).click();
    await dlg(page).getByLabel('Tên tài sản').fill('Lò nướng đối lưu');
    await dlg(page).getByLabel('Hạn bảo trì kế tiếp').fill('2026-11-15');
    await dlg(page).getByRole('button', { name: 'Thêm' }).click();
    await toast(page, /Đã thêm Lò nướng/);
  });

  await test.step('logistics, subsidiary and intercompany matching', async () => {
    await go(page, 'logistics', 'Hồ sơ logistics');
    await page.getByRole('button', { name: 'Tạo lô hàng' }).first().click();
    await dlg(page).getByLabel('Tuyến').fill('Cát Lái → Kho Thủ Đức');
    await dlg(page).getByLabel('Container / phương tiện').fill('1×20DC');
    await dlg(page).getByLabel('Bắt đầu tính miễn phí').fill('2026-11-05');
    await dlg(page).getByLabel('Số ngày miễn phí').fill('3');
    await dlg(page)
      .getByLabel(/Phí lưu bãi/)
      .fill('400000');
    await dlg(page).getByLabel('Doanh thu lô hàng').fill('20000000');
    await dlg(page).getByLabel('Số tiền').first().fill('9000000');
    await dlg(page).getByLabel('Mặt hàng 1').fill('Bột mì');
    await dlg(page).getByRole('button', { name: 'Tạo lô hàng' }).click();
    await toast(page, /Đã tạo lô hàng LH-001/);
    await page.getByRole('button', { name: 'Xem tài chính lô hàng' }).click();
    await settle(page, 'Tài chính logistics');
    await page.getByRole('button', { name: 'Xác nhận phân bổ' }).click();
    await toast(page, /Đã xác nhận phân bổ/);

    await go(page, 'settings', /Cài đặt/);
    await page
      .getByRole('button', { name: /Quản lý/ })
      .first()
      .click();
    await dlg(page).getByLabel('Thêm đơn vị').selectOption('LEGAL_ENTITY');
    await dlg(page).getByLabel('Tên đơn vị').fill('Công ty TNHH Bánh Thu Hà');
    await dlg(page).getByRole('button', { name: 'Thêm', exact: true }).click();
    await toast(page, /Đã thêm Công ty TNHH Bánh Thu Hà/);
    await page.keyboard.press('Escape');
    await go(page, 'intercompany', 'Đối soát nội bộ');
    await page.getByRole('button', { name: 'Thêm cặp đối soát' }).first().click();
    await dlg(page).getByLabel('Mã tham chiếu chung').fill('IC-2611-01');
    await dlg(page).getByLabel('Số phải thu').fill('5000000');
    await dlg(page).getByLabel('Số phải trả').fill('4800000');
    await dlg(page).getByRole('button', { name: 'Đối chiếu' }).click();
    await expect(page.getByText(/Lệch 200.000 đ/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Điều chỉnh số liệu' }).click();
    await dlg(page)
      .getByLabel(/Phải trả/)
      .fill('5000000');
    await dlg(page).getByRole('button', { name: 'Đối chiếu lại' }).click();
    await toast(page, /Hai phía đã khớp/);
  });

  await test.step('close November with step-up; the books move to December', async () => {
    await go(page, 'close', /Chốt kỳ/);
    await page.getByRole('button', { name: 'Chốt kỳ & lưu phiên bản' }).click();
    await dlg(page).getByRole('button', { name: 'Xác nhận chốt' }).click();
    const su = page.getByRole('dialog', { name: 'Xác thực bổ sung' });
    const code = (
      (await su
        .getByText(/mã xác thực:/)
        .locator('b')
        .textContent()) ?? ''
    ).trim();
    await su.getByRole('group', { name: 'Mã xác minh' }).locator('input').first().click();
    await page.keyboard.type(code);
    await su.getByRole('button', { name: /Xác nhận/ }).click();
    await toast(page, /Đã chốt kỳ/);
    await page.reload();
    await settle(page);
    await expect(page.getByText(/Tháng 12\/2026/).first()).toBeVisible();
  });

  await test.step('evidence: the uploaded original verifies byte for byte', async () => {
    await go(page, 'evidence', /Bằng chứng/);
    await page
      .locator('table tbody tr')
      .filter({ hasText: /Bột mì Sao Vàng/ })
      .first()
      .click();
    await settle(page, 'Bằng chứng & lịch sử');
    await page.getByRole('button', { name: /Kiểm chứng hồ sơ/ }).click();
    await settle(page, 'Kiểm tra toàn vẹn');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Chọn tệp & kiểm chứng/ }).click();
    await (await chooser).setFiles(path.join(fixtures, 'hoa-don-bot-mi-0000215.xml'));
    await toast(page, /Toàn vẹn đã xác minh/);
  });

  await test.step('evidence: the closed November is verified against its anchored proof', async () => {
    await go(page, 'evidence', /Bằng chứng/);
    await page.locator('.snap-item').filter({ hasText: '2026-11' }).first().click();
    const d = page.getByRole('dialog', { name: /Bộ chốt kỳ 2026-11/ });
    await expect(d.getByText(/Biên nhận sổ cái/)).toBeVisible();
    await d.getByRole('button', { name: 'Kiểm chứng toàn vẹn' }).click();
    await expect(d.getByText(/Toàn vẹn: dữ liệu chốt kỳ khớp với bằng chứng đã neo/)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  await test.step('the finance page keeps a reproducible history of calculations', async () => {
    await go(page, 'finance', /Phân tích tài chính|Thẩm định/);
    await expect(page.getByRole('heading', { name: 'Lịch sử tính toán' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Thẩm định dự án', exact: true }).first()).toBeVisible();
  });

  await expectClean(w, info);
});
