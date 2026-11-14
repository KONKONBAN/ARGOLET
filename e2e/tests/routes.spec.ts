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
  await page
    .getByText(/^CT-1019/)
    .first()
    .click();
  await expect(page).toHaveURL(/#\/documents\/[^/]+\/review$/);
  await settled(page, /Kiểm tra chứng từ/);

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

  await go(page, 'reconciliation', 'Đối soát đa nguồn');
  await page
    .getByText(/^DS-1030/)
    .first()
    .click();
  await expect(page).toHaveURL(/#\/reconciliation\/[^/]+$/);
  await settled(page, 'Chi tiết đối soát');

  await go(page, 'inbox', 'Việc cần xử lý');
  await page.getByText('Duyệt thanh toán bao bì', { exact: true }).first().click();
  await expect(page).toHaveURL(/#\/approvals\/[^/]+$/);
  await settled(page, 'Phê duyệt hồ sơ');
  await expect(page.getByText('Luồng phê duyệt')).toBeVisible();
  await expectClean(w, info);
});

test('documents are paginated with page numbers; the page survives opening a record', async ({}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await go(page, 'documents', 'Chứng từ');
  // Static mode: this context's own demo data (exactly 128). API mode: one shared server where other
  // tests add documents while this one runs, so the total is matched as "some number".
  const exact = info.project.name === 'static';
  const range = (from: number, to: number | null) =>
    exact ? `${from}–${to ?? 128} trên 128` : new RegExp(`${from}–${to ?? '\\d+'} trên \\d+`);
  const pager = page.locator('.pager-info');
  await expect(pager).toContainText(range(1, 20));
  await expect(page.locator('table tbody tr')).toHaveCount(20);
  const firstOnPage1 = await page.locator('table tbody tr').first().innerText();
  await page.getByRole('button', { name: 'Trang 2' }).click();
  await expect(pager).toContainText(range(21, 40));
  await expect(page).toHaveURL(/page=2/);
  expect(await page.locator('table tbody tr').first().innerText()).not.toBe(firstOnPage1);
  await page.getByRole('button', { name: 'Trang sau' }).click();
  await expect(pager).toContainText(range(41, 60));
  await page.locator('.pager-size select').selectOption('50');
  await expect(pager).toContainText(range(1, 50));
  await page.getByRole('button', { name: 'Trang 3' }).click();
  await expect(pager).toContainText(range(101, null));
  if (exact) await expect(page.locator('table tbody tr')).toHaveCount(28);
  const lastPage = await pager.innerText();
  await page.locator('table tbody tr').first().click();
  await page.goBack();
  // Back on the same page (page and page size kept in the address).
  await expect(pager).toContainText(exact ? lastPage : range(101, null));
  await expect(page).toHaveURL(/page=3/);
  await page.locator('#doc-status').selectOption('review');
  // API mode shares one database with the other tests, which add and confirm documents.
  await expect(page.locator('.pager-info')).toContainText(
    info.project.name === 'static' ? /1–[34] trên [34] chứng từ/ : /1–\d+ trên \d+ chứng từ/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await expectClean(w, info);
});

test('unknown routes fall back to the overview', async () => {
  await page.goto('/#/khong-ton-tai');
  await settled(page, 'Tổng quan kinh doanh');
});
