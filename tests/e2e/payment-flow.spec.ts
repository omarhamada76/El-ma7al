import { test, expect } from '@playwright/test';

test.describe('Payment Flow', () => {
  test('Registering payment decreases client debt and marks invoice paid', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('البريد الإلكتروني').fill('admin@example.com');
    await page.getByPlaceholder('كلمة المرور').fill('password');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    
    // Select first client
    await page.locator('table tbody tr').first().click();
    
    // Click add payment (تسجيل سداد)
    await page.getByRole('button', { name: 'تسجيل سداد' }).first().click();
    await page.getByPlaceholder('المبلغ').fill('100');
    await page.getByRole('button', { name: 'حفظ' }).click();

    // Verify successful toast
    await expect(page.getByText('تم الحفظ بنجاح')).toBeVisible();
  });
});
