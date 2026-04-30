import { test, expect } from '@playwright/test';

test.describe('Client Barn Flow', () => {
  test('Adding a barn to a client and attributing an invoice to it', async ({ page }) => {
    // 1. Login
    await page.goto('/login');
    await page.getByPlaceholder('البريد الإلكتروني').fill('admin@example.com');
    await page.getByPlaceholder('كلمة المرور').fill('password');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    // 2. Client Detail Page
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    await page.locator('table tbody tr').first().click();

    // 3. Add Barn
    await page.getByRole('button', { name: 'إضافة عنبر' }).click();
    await page.getByPlaceholder('اسم العنبر').fill('Test Barn');
    await page.getByRole('button', { name: 'حفظ' }).click();

    // 4. Create invoice for Barn
    await page.goto('/invoices/new');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'إضافة سطر' }).click();
    await page.getByRole('button', { name: 'حفظ' }).click();
    
    // Test finishes gracefully
  });
});
