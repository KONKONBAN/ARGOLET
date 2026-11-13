import { expect, test } from '@playwright/test';
import { DEMO, expectClean, fillLogin, login, settled, typeOtp, watch } from './helpers';

test.describe('authentication & workspace onboarding', () => {
  test('wrong password keeps the user on the login page with an error', async ({ page }, info) => {
    const w = watch(page);
    await fillLogin(page, 'ketoan@minhan.example', 'khong-dung-mat-khau');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    await expectClean(w, info);
  });

  test('the demo account is filled in: one click on "Đăng nhập" enters', async ({ page }, info) => {
    const w = watch(page);
    await page.goto('/#/login');
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(DEMO.contact);
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue(DEMO.password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Chọn không gian làm việc' })).toBeVisible();
    await expectClean(w, info);
  });

  test('empty fields explain what is missing instead of a dead button', async ({ page }) => {
    await page.goto('/#/login');
    await page.getByLabel('Email', { exact: true }).fill('');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('');
    const submit = page.getByRole('button', { name: 'Đăng nhập', exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText('Vui lòng nhập email hoặc số điện thoại')).toBeVisible();
    await expect(page.getByText('Vui lòng nhập mật khẩu')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    await page.getByRole('button', { name: 'Điền lại tài khoản trải nghiệm' }).click();
    await submit.click();
    await expect(page.getByRole('heading', { name: 'Chọn không gian làm việc' })).toBeVisible();
  });

  test('protected screens redirect to login when signed out', async ({ page }) => {
    await page.goto('/#/close');
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('session survives a reload and ends on sign-out', async ({ page }, info) => {
    const w = watch(page);
    await login(page);
    await page.reload();
    await settled(page, 'Tổng quan kinh doanh');
    await page.locator('button.side-user[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: /Đăng xuất/ }).click();
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    await page.goto('/#/overview');
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    await expectClean(w, info);
  });

  test('register → verify → create organisation → reset password → sign in again', async ({ page }, info) => {
    const w = watch(page);
    const email = `chu.cua.hang.${Date.now()}@example.vn`;
    const password = 'MatKhauManh#2026';
    await page.goto('/#/register');
    await page.getByLabel('Họ và tên').fill('Trần Thu Hà');
    await page.getByLabel('Email hoặc số điện thoại').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page.getByRole('heading', { name: 'Xác minh tài khoản' })).toBeVisible();
    const code =
      (
        await page
          .getByText(/mã xác minh:/)
          .locator('b')
          .textContent()
      )?.trim() ?? '';
    expect(code).toMatch(/^\d{6}$/);
    await typeOtp(page, code);
    await page
      .getByRole('button', { name: /Xác minh|Xác nhận/ })
      .first()
      .click();

    await expect(page.getByRole('heading', { name: 'Chọn không gian làm việc' })).toBeVisible();
    await page.getByRole('button', { name: /Tạo tổ chức mới/ }).click();
    await expect(page.getByRole('heading', { name: 'Tạo tổ chức' })).toBeVisible();
    await page.getByLabel('Tên tổ chức').fill('Tiệm bánh Thu Hà');
    await page.getByLabel('Loại hình').selectOption('Hộ kinh doanh');
    await page.getByRole('button', { name: /Tạo tổ chức & tiếp tục/ }).click();
    await expect(page.getByRole('heading', { name: 'Kết nối dữ liệu đầu tiên' })).toBeVisible();
    await page.getByRole('button', { name: 'Thiết lập sau' }).click();
    await settled(page, 'Tổng quan kinh doanh');
    await expect(page.getByText('Tiệm bánh Thu Hà').first()).toBeVisible();

    // sign out, then recover the password with the emailed (dev) code
    await page.locator('button.side-user[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: /Đăng xuất/ }).click();
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
    await page
      .getByRole('link', { name: /Quên mật khẩu/ })
      .or(page.getByRole('button', { name: /Quên mật khẩu/ }))
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Khôi phục mật khẩu' })).toBeVisible();
    await page.getByLabel('Email tài khoản').fill(email);
    await page
      .getByRole('button', { name: /Gửi mã|Tiếp tục|Gửi/ })
      .first()
      .click();
    const resetCode =
      (
        await page
          .getByText(/mã đặt lại:/)
          .locator('b')
          .textContent()
      )?.trim() ?? '';
    expect(resetCode).toMatch(/^\d{6}$/);
    await typeOtp(page, resetCode);
    const newPassword = 'MatKhauMoi#2027';
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Đặt mật khẩu mới' }).click();
    await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();

    await fillLogin(page, email, password);
    await expect(page.getByRole('alert')).toBeVisible();
    await fillLogin(page, email, newPassword);
    await expect(page.getByRole('heading', { name: /Tổng quan|Chọn không gian làm việc/ })).toBeVisible();
    await expectClean(w, info);
  });
});
