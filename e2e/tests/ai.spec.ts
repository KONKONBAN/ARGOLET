import { expect, test } from '@playwright/test';
import { expectClean, go, login, watch } from './helpers';

/**
 * Administration: Claude and ChatGPT are connected with the organisation's own API key. The key is
 * checked before anything is saved (a wrong one is refused with a clear reason) and never shown.
 */
test('the administrator connects Claude or ChatGPT with the organisation key', async ({ page }, info) => {
  const w = watch(page);
  await login(page);
  await go(page, 'settings', /Cài đặt/);
  await page
    .locator('.card')
    .filter({ hasText: 'Trợ lý AI (Claude / ChatGPT)' })
    .getByRole('button', { name: 'Quản lý' })
    .click();
  const panel = page.getByRole('dialog', { name: 'Trợ lý AI (Claude / ChatGPT)' });
  const claude = panel.getByRole('region', { name: 'Claude (Anthropic)' });
  const chatgpt = panel.getByRole('region', { name: 'ChatGPT (OpenAI)' });
  await expect(claude).toContainText('Chưa kết nối');
  await expect(chatgpt).toContainText('Chưa kết nối');

  // A key in the wrong format never leaves the page.
  await claude.getByLabel('Khóa API của tổ chức').fill('abc123');
  await claude.getByRole('button', { name: 'Kiểm tra và kết nối' }).click();
  await expect(claude.getByRole('alert')).toContainText('bắt đầu bằng sk-ant-');
  await chatgpt.getByLabel('Khóa API của tổ chức').fill('pk-not-an-openai-key-000000000');
  await chatgpt.getByRole('button', { name: 'Kiểm tra và kết nối' }).click();
  await expect(chatgpt.getByRole('alert')).toContainText('bắt đầu bằng sk-');
  await expect(claude.getByLabel('Khóa API của tổ chức')).toHaveAttribute('type', 'password');
  await expectClean(w, info);
});
