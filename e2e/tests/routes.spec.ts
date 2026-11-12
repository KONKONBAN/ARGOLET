import { expect, test, type Page } from '@playwright/test';
import { expectClean, go, login, noHorizontalOverflow, settled, watch } from './helpers';

/** Every screen of the web app, at desktop (Figma 1440) and phone (Figma 390) widths. */
const ROUTES: [string, string | RegExp][] = [
  ['overview', 'Tổng quan kinh doanh'],
  ['inbox', 'Việc cần xử lý'],
  ['notifications', 'Thông báo'],
  ['documents', 'Chứng từ'],
  ['capture', 'Tiếp nhận chứng từ'],
  ['ingestion', /Nhập dữ liệu/],
  ['reconciliation', 'Đối soát đa nguồn'],
  ['close', /Chốt kỳ/],
  ['decision-pack', /Decision Pack|hồ sơ quyết định/i],
  ['evidence', /Bằng chứng/],
  ['assistant', /Trợ lý/],
  ['daily-close', /Chốt ca/],
  ['inventory', /Kho/],
  ['purchasing', /Mua hàng/],
  ['books', /Sổ sách/],
  ['clients', /khách hàng/i],
  ['sales', /Bán hàng/],
  ['projects', /Dự án/],
  ['finance', /Phân tích tài chính|Thẩm định/],
  ['scenarios', /kịch bản/i],
  ['assets', /Tài sản/],
  ['logistics', /logistics/i],
  ['logistics-finance', /logistics/i],
  ['group', /tập đoàn/i],
  ['intercompany', /nội bộ/i],
  ['members', /Thành viên/],
  ['settings', /Cài đặt/],
  ['security', /Bảo mật/],
  ['modules', /Phân hệ|Mô-đun/i],
];

test.describe.configure({ mode: 'serial' });

let page: Page;
let w: ReturnType<typeof watch>;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  w = watch(page);
  await login(page);
});
test.afterAll(async () => {
  await page.close();
});

for (const [route, title] of ROUTES) {
  test(`/${route} renders on desktop and phone`, async ({}, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await go(page, route, title);
    await expect(page.locator('.alert.danger')).toHaveCount(0);
    await noHorizontalOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await settled(page, title);
    await noHorizontalOverflow(page);
    await expectClean(w, info);
  });
}

test('drill-down screens open from their lists', async ({}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await go(page, 'documents', 'Chứng từ');
  // CT-1019 is never modified by other tests (API mode shares one database across tests).
  await page.getByText(/^CT-1019/).first().click();
  await expect(page).toHaveURL(/#\/documents\/[^/]+\/review$/);
  await settled(page, /Kiểm tra chứng từ/);

  await go(page, 'evidence', /Bằng chứng/);
  await page.locator('table tbody tr, .list-item.clickable, [role="row"]').filter({ hasText: 'CT-1027' }).first().click();
  await expect(page).toHaveURL(/#\/evidence\/[^/]+$/);
  await settled(page, 'Bằng chứng & lịch sử');
  await page.getByRole('button', { name: /Kiểm chứng hồ sơ/ }).click();
  await expect(page).toHaveURL(/#\/verification\/[^/]+$/);
  await settled(page, 'Kiểm tra toàn vẹn');

  await go(page, 'reconciliation', 'Đối soát đa nguồn');
  await page.getByText(/^DS-1030/).first().click();
  await expect(page).toHaveURL(/#\/reconciliation\/[^/]+$/);
  await settled(page, 'Chi tiết đối soát');

  await go(page, 'inbox', 'Việc cần xử lý');
  await page.getByText('Duyệt thanh toán bao bì', { exact: true }).first().click();
  await expect(page).toHaveURL(/#\/approvals\/[^/]+$/);
  await settled(page, 'Phê duyệt hồ sơ');
  await expect(page.getByText('Luồng phê duyệt')).toBeVisible();
  await expectClean(w, info);
});

test('unknown routes fall back to the overview', async () => {
  await page.goto('/#/khong-ton-tai');
  await settled(page, 'Tổng quan kinh doanh');
});
