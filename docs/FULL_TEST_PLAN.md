# Full System Test Plan

## Scope

This plan covers:

1. Authentication and authorization.
2. Master data (clients, barns, products, suppliers, users).
3. Inventory and batch/bag stock integrity.
4. Sales invoice lifecycle (create, edit window, return, cancel).
5. Payment routing (cash/wallet/deferred) and safe impact.
6. Supplier purchase/payment flows and balances.
7. Billing cycles and account statements.
8. Reporting endpoints and finance-only visibility.
9. Barcode/scan parsing edge cases.
10. Regression guard for Arabic/RTL critical paths.

## Automated layers

1. Unit (`npm run test:unit`)
   - Business rules and parser correctness.
2. E2E (`npm run test:e2e`)
   - Main user journeys in browser.
3. Full (`npm run test:all`)
   - Run both layers.

## Test matrix

1. Auth + RBAC
   - Bootstrap/login/me/logout.
   - Staff denied finance views and finance APIs.
   - Admin/super_admin access finance views/APIs.

2. Clients + Barns
   - CRUD client and barn.
   - Client and barn balances update after invoices/payments.

3. Inventory
   - Product CRUD and category filters.
   - Stock deduction logic by batch order rules.
   - Expiry and low-stock alerts.

4. Invoices
   - Create invoice with valid lines only.
   - Stock decreases and client/barn debt updates.
   - Partial return and item delete reversals.
   - Edit-window policy enforcement.

5. Payments + Safe
   - Cash payment increases safe.
   - Wallet payment routes to wallet transactions.
   - Deferred payment does not route as cash-in.

6. Suppliers
   - Supplier purchase increases payable and stock.
   - Supplier payment decreases payable and safe.

7. Billing cycles + Statements
   - Start/end cycle.
   - Carry-over closing balance.
   - Date-filtered statements consistent with opening/closing totals.

8. Barcode + Scan
   - Batch token parsing (`B{id}`), bag token parsing (`G{id}`).
   - Composite barcode parsing and noisy-token normalization.
   - Expiry-within-days helper behavior.

## Manual QA checkpoints (release gate)

1. Verify key pages render correctly in Arabic RTL on desktop and mobile widths.
2. Verify staff user cannot see hidden financial columns/widgets.
3. Verify invoice print/PDF output with mixed line items.
4. Verify safe and reports values against a known staging snapshot.
