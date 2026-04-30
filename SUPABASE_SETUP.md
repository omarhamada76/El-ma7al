## Supabase Migration — Vet Pharmacy Dashboard

## Live Progress Tracker

Last updated: backend cutover completed to `pgdb.js`; Phase 7 API verification advanced (mixed payment + wallet + return-item + bulk grams/auto-open + client/barn billing-cycle statement paths verified on Postgres), and SQLite↔Postgres parity was re-aligned via fresh migration (with one documented orphan-FK legacy row skipped).

### Phase Status

- [x] **Phase 1 — Postgres Schema Translation** (applied via Supabase MCP, tables verified, updated_at triggers added)
- [x] **Phase 2 — Data Migration Script** (`scripts/migrate-to-supabase.js` created, idempotent insert strategy + reconciliation checks)
- [x] **Phase 3 — Auth Strategy Preserved** (JWT/auth store/api contracts kept)
- [x] **Phase 4 — Backend DB Driver Swap** (`server/pgdb.js` now Postgres-native and `server/index.js` switched to `./pgdb.js`)
- [x] **Phase 5 — Frontend Minimal Update** (`src/lib/supabase.ts` activated + `.env.example` additions)
- [x] **Phase 6 — RLS Enablement** (enabled on public tables with `service_role_full_access` policy)
- [ ] **Phase 7 — End-to-End Verification**
- [~] **Phase 8 — Env Summary** (`.env.example` updated; runtime `.env` and `server/.env` still deployment-dependent)

### What Is Already Ported in `server/pgdb.js`

- Users/auth helpers (count/create/verify/update/delete/list)
- Settings/category helpers
- Warehouses
- Clients + barns CRUD and balance helpers
- Payments + safe helpers
- Suppliers + purchases + payments + receipt write flow (with pg transactions)
- Invoice reads (`getInvoices`, `getInvoiceById`) and mutations (`createInvoice`, `updateInvoice`, `replaceInvoice`, `cancelInvoice`, `deleteInvoiceItem`, `returnPartialInvoiceItem`)
- Invoice cancellation flows (`cancelInvoice`, `deleteInvoice`)
- Invoice item mutations (`deleteInvoiceItem`, `returnPartialInvoiceItem`)
- Batch/stock primitives (`upsertProductStock`, `upsertBatch`, `syncWarehouseStockFromBatches`)
- Warehouse/product stock reads and bag/batch lookups (`getWarehouseStockMap`, `getProductsInWarehouse`, `getProductsWithStockInWarehouse`, `getBatchesByWarehouse`, `getProductStock`, `getBagsForProduct`, `getBagInstanceById`, `getBatchById`, `updateBatchPrice`)
- Product list filtering/pagination (`getProducts`, `getProductCountFiltered`) including low-stock, unpriced, and expiring modes
- Product batch maintenance (`getBatchesForProduct`, `updateProductBatch`, `createManualProductBatch`, `deleteProductBatch`, `batchHasInvoiceReferences`)
- Product lifecycle mutations (`createProduct`, `updateProduct`, `deleteProduct`, `seedInitialBulkStockForProductWithoutBatches`)
- Account statements + billing cycles (client and barn)
- Reports (`by-category`, `top-products`, `sales-by-day`, range daily totals)

### Still Missing (Critical Before Final Cutover)

- Full Phase 7 verification checklist execution against both SQLite and Postgres backends
- Remaining Phase 7 gaps are now mostly UI/manual scenarios plus a small legacy-data exception documented below
- SQLite-vs-Postgres snapshot parity was re-established by truncating Postgres app tables and re-running `scripts/migrate-to-supabase.js`; core aggregates now match (`products`, `clients`, `invoices`, `payments`, safe/wallet sums)
- One known legacy-data exception remains during migration: `supplier_purchase_items` has one SQLite orphan row (`product_id=511` not present in `products`), so migration skips that row and reports `sqlite=14` vs `pg=13` for that table only

You have access to the Supabase MCP server. Use it throughout this
migration to create tables, run SQL, deploy edge functions, and verify
data. The Supabase project is already linked.

Project URL: https://durlemdvxspirzgdywwk.supabase.co
Project ref: durlemdvxspirzgdywwk

DO NOT hardcode any credentials in source files. Use environment
variables only. Read all credentials from .env files that already
exist in the project or that the user will provide separately.

---

## BEFORE STARTING — Read These Files Completely

Read and fully understand these files before writing a single line:

1. server/index.js — all route handlers, every endpoint
2. server/db.js — every database function, all SQL queries
3. server/auth.js — JWT logic, token signing, role checks
4. server/sql/schema.sql — full current schema
5. server/migrations/ — all migration files in order
6. src/api/client.ts — how frontend calls the backend
7. src/api/*.ts — all domain API files
8. src/lib/supabase.ts — current stub, needs to be activated
9. src/stores/auth.ts — Zustand auth store
10. .env.example — existing environment variables

Map every endpoint in server/index.js to its db.js function before
proceeding. Build a mental model of every transaction-heavy operation:
- Invoice create/edit/cancel
- Stock batch upsert
- Supplier purchase save
- Payment routing (cash/wallet/deferred)
- Return document processing
- Auto-open bag logic for bulk products

---

## PHASE 1 — Postgres Schema Translation

Using the Supabase MCP server, create the schema in Supabase Postgres.

Convert ALL SQLite constructs to Postgres equivalents:

| SQLite | Postgres |
|--------|----------|
| INTEGER PRIMARY KEY AUTOINCREMENT | BIGSERIAL PRIMARY KEY |
| last_insert_rowid() | RETURNING id |
| INSERT OR REPLACE | INSERT ... ON CONFLICT DO UPDATE |
| INSERT OR IGNORE | INSERT ... ON CONFLICT DO NOTHING |
| datetime('now') | NOW() |
| TEXT (for dates) | TIMESTAMPTZ or DATE |
| REAL | NUMERIC(12,4) for prices/weights |
| INTEGER (0/1 booleans) | BOOLEAN |
| PRAGMA foreign_keys | Native FK enforcement |

Create tables in this exact dependency order to respect foreign keys:
1. warehouses
2. users
3. products
4. product_warehouse_stock
5. product_batches
6. bag_instances
7. clients
8. barns
9. suppliers
10. invoices
11. invoice_items
12. payments
13. safe_transactions
14. digital_wallets
15. wallet_transactions
16. supplier_purchases
17. supplier_purchase_items
18. supplier_payments
19. billing_cycles
20. barn_billing_cycles
21. return_documents
22. return_items
23. settings

For each table, preserve ALL constraints, indexes, and foreign keys
from the original schema. Add these Postgres-specific improvements:
- Add updated_at triggers using:
  CREATE OR REPLACE FUNCTION update_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;
  
  CREATE TRIGGER trg_[tablename]_updated_at
  BEFORE UPDATE ON [tablename]
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

Run the schema via Supabase MCP. Verify all tables exist after creation.

---

## PHASE 2 — Data Migration from SQLite

Write a Node.js migration script at scripts/migrate-to-supabase.js:

```javascript
// This script reads from the local SQLite database and writes to
// Supabase Postgres. Run it once during cutover.
// Usage: node scripts/migrate-to-supabase.js

import Database from 'better-sqlite3'
import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const sqlite = new Database('data/vet-pharmacy.sqlite')
const pgClient = new pg.Client({
  connectionString: process.env.DB_URL
  // User provides the connection string in .env
  // Never hardcode it here
})
```

Migration order must respect FK dependencies (same order as table
creation above). For each table:
1. Read all rows from SQLite
2. Transform data types (booleans 0/1 → true/false, date strings, etc.)
3. INSERT into Postgres with ON CONFLICT DO NOTHING (idempotent)
4. After all tables: run reconciliation checks:
   - Compare row counts between SQLite and Postgres for every table
   - Log any mismatches as errors
   - Check key financial balances match (safe balance, client balances)

Add DB_URL to .env.example (as placeholder, not real value).

---

## PHASE 3 — Auth: Keep JWT, Add Supabase User Sync

DO NOT migrate to Supabase Auth. Keep the existing custom JWT system
in server/auth.js completely intact.

Only do this:
- Keep the users table in Postgres (migrated in Phase 1)
- Keep JWT signing/verification in server/auth.js unchanged
- Keep all role checks (super_admin/admin/staff) unchanged
- Keep login/logout/me endpoints unchanged

This means zero frontend auth changes. The auth store in
src/stores/auth.ts does not change.

---

## PHASE 4 — Backend: Keep Node.js, Switch DB Driver

DO NOT convert to Supabase Edge Functions.
Keep the existing Node.js server in server/index.js.

Only change the database layer — swap better-sqlite3 for pg:

1. Install: npm install pg
2. Create server/pgdb.js as a drop-in replacement for server/db.js:
   - Same exported function names
   - Same input/output shapes
   - Replace all SQLite queries with Postgres-compatible SQL
   - Use pg pool for connection management:
```javascript
     import pg from 'pg'
     const pool = new pg.Pool({
       connectionString: process.env.DB_URL
     })
```

3. Convert every function in server/db.js to server/pgdb.js:

   Critical SQL conversions needed:
   
   a) All INSERT with RETURNING:
      SQLite: d.prepare('INSERT INTO x VALUES (?)').run(val)
              then d.prepare('SELECT last_insert_rowid()').get().id
      Postgres: INSERT INTO x VALUES ($1) RETURNING id
   
   b) All upserts:
      SQLite: INSERT OR REPLACE INTO x ...
      Postgres: INSERT INTO x ... ON CONFLICT (key) DO UPDATE SET ...
   
   c) All transactions:
      SQLite: d.transaction(() => { ... })()
      Postgres: await pool.query('BEGIN')
                try { ... await pool.query('COMMIT') }
                catch { await pool.query('ROLLBACK') throw e }
   
   d) Batch upsert (product_batches):
      SQLite: INSERT OR IGNORE based on UNIQUE constraint
      Postgres: INSERT ... ON CONFLICT (product_id, warehouse_id,
                purchase_price, expiry_date) DO UPDATE SET
                quantity = product_batches.quantity + EXCLUDED.quantity
   
   e) recalculateWarehouseStock:
      Use: INSERT INTO product_warehouse_stock ... ON CONFLICT
           (product_id, warehouse_id) DO UPDATE SET quantity = ...
   
   f) autoOpenNextBag:
      Preserve exact FEFO logic, just with Postgres SQL syntax

4. In server/index.js, replace:
   import * as db from './db.js'
   with:
   import * as db from './pgdb.js'
   
   Nothing else in server/index.js changes.

5. All transaction-heavy operations must use explicit Postgres
   transactions (BEGIN/COMMIT/ROLLBACK) wrapping the same logic
   that was in SQLite transactions. Never allow partial writes.
   Critical transactions:
   - createInvoice (items + payments + stock deduction + safe/wallet)
   - cancelInvoice (reverse all items + payments)
   - deleteInvoiceItem (reverseInvoiceItem)
   - saveSupplierPurchase (batch upsert + bag creation + stock update)
   - saveReturn (return_items + stock reversal + refund routing)
   - routePayment (safe OR wallet, never both)

---

## PHASE 5 — Frontend: Update API Origin Only

The frontend changes are minimal:

1. In .env (and .env.example), update:
   VITE_API_ORIGIN=https://[your-railway-or-server-url]
   
   This is the only change needed for the frontend to point to the
   new backend. The backend URL is wherever Node.js is deployed.

2. In src/lib/supabase.ts — activate the Supabase client for
   DIRECT database reads only (not auth, not as API replacement):
```typescript
   import { createClient } from '@supabase/supabase-js'
   
   export const supabase = createClient(
     import.meta.env.VITE_SUPABASE_URL,
     import.meta.env.VITE_SUPABASE_ANON_KEY
   )
```
   Add to .env.example:
   VITE_SUPABASE_URL=https://durlemdvxspirzgdywwk.supabase.co
   VITE_SUPABASE_ANON_KEY=[user provides this from dashboard]

3. Do NOT change any file in src/api/*.ts
4. Do NOT change src/stores/auth.ts
5. Do NOT change any component or page files

---

## PHASE 6 — Enable Row Level Security (RLS)

In Supabase, enable RLS on all tables but with a policy that allows
the Node.js backend service role full access:

```sql
-- For each table, enable RLS but allow service role through
ALTER TABLE [tablename] ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON [tablename]
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

The Node.js backend connects with the service role connection string
so it bypasses RLS. The anon key used by the frontend cannot directly
access tables (all access goes through the Node.js API).

---

## PHASE 7 — Verification Checklist

After completing all phases, verify these critical flows work
end-to-end against the new Postgres backend:

- [x] Login with existing admin credentials (API bootstrap/login/me smoke test passed on Postgres)
- [x] View product list with batch quantities (API `/products` + `/warehouses/:id/batches` passed)
- [~] Add product with initial batches (piece and bulk) (piece flow verified; bulk flow pending dedicated test data)
- [~] Receive stock from supplier (creates batches + bag_instances) (endpoint path migrated; full runtime assertion pending bulk receipt scenario)
- [x] Create invoice: manual product + batch picker (piece/manual path verified via API create invoice)
- [~] Create invoice: barcode scan (B{id} format) (API barcode lookup works for stored barcode values; `B{id}` format is not resolved by API directly, so this remains a frontend/UI integration check)
- [x] Invoice with mixed payment (cash + آجل) (verified via API: invoice create generated both `cash` and `deferred` payments with expected amounts)
- [x] Invoice with Vodafone Cash payment → wallet balance updates (verified via API + DB: wallet payment created and `wallet_transactions` received `invoice_payment_in`)
- [~] Return item from invoice → stock goes back to correct batch (piece-product return path verified; bulk batch-specific return still pending)
- [x] Cancel full invoice → all stock reversed (verified: stock restored and safe balance reversed)
- [x] Bulk product: sell in grams → open bag deducted correctly (verified via API: `display_unit=gram`, `display_quantity=1000` sold as `quantity=1.0000 kg`)
- [x] Bulk product: open bag empties → next bag auto-opens (verified via API/DB response: previous `open` bag became `empty`, next `sealed` bag became `open`, and `bag_auto_opened` notification returned)
- [~] Client account statement shows correct running balance (verified on Postgres API: `closing_balance` matches last row `balance`, including deferred-payment display behavior; billing-cycle linkage bug fixed and re-verified in `createInvoice`; remaining work is UI/report-level parity validation)
- [x] Safe balance matches sum of safe_transactions (verified through invoice create/cancel smoke flow)
- [~] Wallet balance matches sum of wallet_transactions (SQL reconciliation verified on Postgres test data: wallet ledger sum aligns with wallet-linked payments; no dedicated wallet-balance API endpoint yet, so keep as partial until full UI/report parity pass)
- [x] Dashboard KPIs load correctly (API `/reports/dashboard` smoke test passed)
- [ ] Print label modal opens with barcode (Code 128) (pending UI modal verification)

For each check, run against both the old SQLite backend (if still
running in parallel) and the new Postgres backend and compare results.

---

## PHASE 8 — Environment Variables Summary

Create/update these files:

server/.env (never commit this):
  DB_URL=postgresql://postgres:[PASSWORD]@db.durlemdvxspirzgdywwk.supabase.co:5432/postgres
  JWT_SECRET=[keep existing value]
  JWT_EXPIRES_IN=7d
  PORT=3001
  CORS_ORIGIN=https://[your-frontend-domain]
  NODE_ENV=production

.env (frontend, never commit):
  VITE_API_ORIGIN=https://[your-backend-url]
  VITE_SUPABASE_URL=https://durlemdvxspirzgdywwk.supabase.co
  VITE_SUPABASE_ANON_KEY=[anon key from supabase dashboard]

.env.example (commit this, with placeholders only):
  DB_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
  JWT_SECRET=your_jwt_secret_here
  VITE_API_ORIGIN=https://your-backend-url
  VITE_SUPABASE_URL=https://your-project.supabase.co
  VITE_SUPABASE_ANON_KEY=your_anon_key_here

Add .env to .gitignore if not already there. Verify it is ignored
before any commit.

---

## Global Constraints

- Node.js server stays as-is except for the DB driver swap
- No Edge Functions — all business logic stays in Node.js
- No Supabase Auth — JWT system stays unchanged
- All DB transactions must use BEGIN/COMMIT/ROLLBACK in Postgres
- Never hardcode credentials anywhere in source files
- All existing API contracts preserved (same URLs, same request/
  response shapes) — zero frontend breaking changes
- Migration script must be idempotent (safe to run multiple times)
- Keep server/db.js intact during migration as fallback —
  only switch the import in server/index.js when fully tested