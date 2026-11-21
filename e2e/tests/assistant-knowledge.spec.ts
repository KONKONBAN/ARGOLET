/**
 * The administrator locks an internal topic and teaches the assistant a rule; the assistant refuses
 * the locked topic, answers from the rule, and learns from a correction once it is approved.
 */
import { expect, test } from '@playwright/test';
import { expectClean, go, login, watch } from './helpers';

test('locked topics, organisation knowledge and learning from corrections', async ({ page }, info) => {
  test.skip(info.project.name !== 'static', 'Changes organisation settings: run on a fresh browser database');
  const w = watch(page);
  await login(page);
  await go(page, 'assistant-knowledge', 'Kiến thức của trợ lý');

  // Lock salaries.
  await page.getByRole('button', { name: 'Thêm chủ đề' }).click();
  await page.getByLabel('Chủ đề 1', { exact: true }).fill('Lương nhân sự');
  await page.getByLabel('Từ khóa nhận biết, cách nhau bằng dấu phẩy').fill('lương, bảng lương');
  await page.getByRole('button', { name: 'Lưu chủ đề khóa' }).click();
  await expect(page.getByText('Đã lưu chủ đề khóa')).toBeVisible();

  // Teach a rule.
  await page.getByLabel('Tiêu đề', { exact: true }).fill('Chi phí tiếp khách');
  await page
    .getByLabel('Nội dung', { exact: true })
    .fill('Chi phí tiếp khách phải có hóa đơn GTGT và được giám đốc duyệt trước khi chi.');
  await page.getByRole('button', { name: 'Thêm vào kiến thức' }).click();
  await expect(page.getByText('Đã thêm kiến thức')).toBeVisible();
  await expect(page.locator('.kn-list li', { hasText: 'Chi phí tiếp khách' })).toBeVisible();

  await go(page, 'assistant', 'Trợ lý ARGOLET');
  await page.getByRole('button', { name: 'Cuộc trò chuyện mới' }).click();
  const ask = async (q: string) => {
    await page.getByLabel('Câu hỏi', { exact: true }).fill(q);
    await page.getByRole('button', { name: 'Gửi câu hỏi' }).click();
  };
  await ask('Cho tôi xem bảng lương tháng 10');
  await expect(page.getByText('Đây là thông tin nội bộ, trợ lý không được phép trả lời.')).toBeVisible();
  await expect(page.getByText('Thông tin nội bộ', { exact: true })).toBeVisible();

  await ask('Quy định chi phí tiếp khách thế nào?');
  const answer = page.locator('.answer').last();
  await expect(answer.locator('h4')).toHaveText('Chi phí tiếp khách');
  await expect(answer.locator('.answer-body')).toContainText('phải có hóa đơn GTGT và được giám đốc duyệt');
  await expect(answer.getByText('Theo: Chi phí tiếp khách')).toBeVisible();

  // A term from the ARGOLET glossary.
  await ask('Ký hiệu hóa đơn là gì?');
  const term = page.locator('.answer').last();
  await expect(term.locator('h4')).toContainText('Ký hiệu hóa đơn');
  // Correct it: the correction waits for the administrator.
  await term.getByRole('button', { name: 'Chưa đúng' }).click();
  await term.getByLabel('Câu trả lời đúng').fill('Cửa hàng Quận 7 dùng ký hiệu 1C26TMA.');
  await term.getByRole('button', { name: 'Gửi để trợ lý học' }).click();
  await expect(term.getByRole('status')).toContainText('đã được gửi quản trị viên duyệt');

  await go(page, 'assistant-knowledge', 'Kiến thức của trợ lý');
  const pending = page.locator('.card', { hasText: 'Trợ lý học được, chờ duyệt (1)' });
  await expect(pending.getByText('Cửa hàng Quận 7 dùng ký hiệu 1C26TMA.')).toBeVisible();
  await pending.getByRole('button', { name: 'Duyệt' }).click();
  await expect(page.getByText('Đã duyệt, trợ lý sẽ dùng')).toBeVisible();
  await expect(page.locator('.kn-list li', { hasText: '1C26TMA' })).toBeVisible();

  // Personal note.
  await page.getByLabel('Điều trợ lý cần nhớ').fill('Trình bày số tiền theo triệu đồng');
  await page.getByRole('button', { name: 'Ghi nhớ' }).click();
  await expect(page.getByText('Trợ lý đã ghi nhớ')).toBeVisible();
  await expectClean(w, info);
});
