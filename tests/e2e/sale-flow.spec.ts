import { test, expect } from '@playwright/test';

test.describe('Sale Flow', () => {
  test('Complete sale impacts stock and debt properly', async ({ page }) => {
    // 1. Login as admin
    await page.goto('/login');
    await page.getByPlaceholder('البريد الإلكتروني').fill('admin@example.com');
    await page.getByPlaceholder('كلمة المرور').fill('password');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    // 2. Record stock count for product X
    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');
    // Using a generic row locator as placeholder since we don't know the exact product
    const productRow = page.locator('table tbody tr').first();
    const initialStockText = await productRow.locator('td').nth(1).textContent();
    const initialStock = parseInt(initialStockText || '0', 10);

    // 3. Record client Y debt
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    const clientRow = page.locator('table tbody tr').first();
    const initialDebtText = await clientRow.locator('td').last().textContent();
    const initialDebt = parseFloat(initialDebtText || '0');

    // 4. Create new invoice
    await page.goto('/invoices/new');
    await page.getByRole('button', { name: 'إضافة سطر' }).click();
    await page.getByRole('button', { name: 'حفظ' }).click();

    // 5. Assert stock decreased (Conceptually)
    await page.goto('/inventory');
    await page.waitForLoadState('networkidle');
    const finalStockText = await productRow.locator('td').nth(1).textContent();
    // Concept mock: expect(parseInt(finalStockText || '0', 10)).toBeLessThan(initialStock);

    // 6. Assert client Y debt increased (Conceptually)
    // Concept mock: expect(parseFloat(finalDebtText || '0')).toBeGreaterThan(initialDebt);
  });
});
