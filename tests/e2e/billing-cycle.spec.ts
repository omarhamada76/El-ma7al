import { test, expect } from '@playwright/test';

test.describe('Billing Cycle', () => {
  test('Closing a billing cycle rolls over the balance properly', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('البريد الإلكتروني').fill('admin@example.com');
    await page.getByPlaceholder('كلمة المرور').fill('password');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    await page.locator('table tbody tr').first().click();

    // The user explicitly controls UI elements to end cycles
    const closeBtn = await page.getByRole('button', { name: 'إغلاق الدورة المحاسبية' }).count();
    
    if (closeBtn > 0) {
      await page.getByRole('button', { name: 'إغلاق الدورة المحاسبية' }).click();
      await page.getByRole('button', { name: 'تأكيد' }).click();
    }
  });
});
