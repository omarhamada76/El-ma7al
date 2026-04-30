import { test, expect } from '@playwright/test';

test.describe('Staff UI Restrictions', () => {
  test('Staff users cannot see cost price or profit modules', async ({ page }) => {
    // 1. Login as staff
    await page.goto('/login');
    await page.getByPlaceholder('البريد الإلكتروني').fill('staff@example.com');
    await page.getByPlaceholder('كلمة المرور').fill('password');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    await page.waitForLoadState('networkidle');

    // 2. Assert Settings and Reports are not visible (or at least throw 403 on navigation)
    const settingsLink = await page.getByText('الإعدادات').count();
    expect(settingsLink).toBe(0);

    const reportsLink = await page.getByText('التقارير').count();
    expect(reportsLink).toBe(0);

    // 3. Go to inventory and assert cost price column is missing
    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');
    const costPriceCol = await page.getByText('سعر الشراء').count();
    expect(costPriceCol).toBe(0);
  });
});
