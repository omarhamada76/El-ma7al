# Vet Pharmacy Web Dashboard — Full Design (Front-end, Back-end, SQL)

This document is the **complete design** for reimplementing the system as a **web dashboard** from scratch. It includes: two warehouses (اجهور / شبرا), suppliers (companies) with payables and deposits, and a **safe** (صندوق) that receives customer payments and pays suppliers. Every page, every SQL table, and the backend API are specified.

---

## 1. Project Overview

### 1.1 What We’re Building

- **Web dashboard** (no mobile app): responsive, Arabic-first (RTL), used in the browser.
- **Same core:** Clients, barns (عنابر), products, sales invoices, customer payments, account statements, reports.
- **New/updated:**
  - **Two inventories (warehouses):** **اجهور** and **شبرا**. Every product has stock **per warehouse**. When creating a sale invoice, user chooses which warehouse to sell from. When receiving goods from a supplier, user chooses which warehouse the stock goes to.
  - **Suppliers (شركات موردة):** Companies you buy from. For each supplier: **what you have to pay** (balance) and **deposits** (payments you make to them). Receiving products from a supplier increases your debt to them; deposits decrease it.
  - **Safe (صندوق):** One cash box. **In:** money received from customers (when they pay). **Out:** money paid to suppliers (deposits). Balance = sum(in) - sum(out) (plus optional initial balance).

### 1.2 Recommended Tech Stack

| Layer | Technology | Notes |
|-------|------------|--------|
| **Front-end** | React 18+ with TypeScript (or Next.js 14 App Router) | Components, RTL, responsive dashboard |
| **UI / styling** | Tailwind CSS + shadcn/ui (or MUI) | Tables, forms, modals, theme (light/dark) |
| **State / data** | TanStack Query (React Query) + React Context or Zustand | Server state, cache, auth state |
| **Routing** | React Router v6 (or Next.js file-based) | Protected routes, layout routes |
| **Back-end** | Node.js + Express (or Supabase Edge Functions) | REST API, auth middleware |
| **Database** | PostgreSQL (e.g. Supabase, or standalone) | All tables below |
| **Auth** | JWT + refresh tokens, or Supabase Auth | Login, roles (super_admin, admin, staff) |
| **File storage** | Supabase Storage or S3-compatible | Product images |

You can keep **Supabase** (PostgreSQL + Auth + Storage) and add an Express layer only if you need custom logic; otherwise Supabase + PostgREST can serve the API from the same schema.

---

## 2. Business Rules Summary

- **Warehouses:** Exactly two: **اجهور**, **شبرا**. Stock is stored per (product, warehouse). Sales deduct from chosen warehouse; purchases from suppliers add to chosen warehouse.
- **Suppliers:** Each supplier has a **balance** (what you owe). **Purchase from supplier** = add to balance + add stock to a chosen warehouse. **Deposit to supplier** = pay money → decrease balance and decrease safe.
- **Safe:** Single balance. **In:** customer payments (e.g. when payment method = cash). **Out:** supplier deposits. Optional: initial balance and manual adjustments.

---

## 3. Full SQL Schema (PostgreSQL)

Every table, column, type, primary key, foreign key, and suggested indexes.

### 3.1 Core & Auth

```sql
-- Extend Supabase auth.users or use your own users table linked to auth
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id           TEXT UNIQUE NOT NULL,        -- Supabase auth.user.id or your auth provider id
  email             TEXT UNIQUE NOT NULL,
  display_name      TEXT,
  role              TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('super_admin', 'admin', 'staff')),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_auth_id ON users(auth_id);
```

### 3.2 Warehouses (المخازن)

```sql
CREATE TABLE warehouses (
  id          SERIAL PRIMARY KEY,
  name_ar     TEXT NOT NULL UNIQUE,   -- 'اجهور', 'شبرا'
  name_en     TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed
INSERT INTO warehouses (name_ar, name_en) VALUES ('اجهور', 'Aghour'), ('شبرا', 'Shubra');
```

### 3.3 Clients & Barns

```sql
CREATE TABLE clients (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT,
  location      TEXT,
  initial_debt  NUMERIC(15,2) NOT NULL DEFAULT 0,
  last_visit    TIMESTAMPTZ,
  total_profit  NUMERIC(15,2) NOT NULL DEFAULT 0,
  favorite      BOOLEAN NOT NULL DEFAULT false,
  pinned        BOOLEAN NOT NULL DEFAULT false,
  pinned_at     TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_name ON clients(name);
CREATE INDEX idx_clients_phone ON clients(phone);
CREATE INDEX idx_clients_pinned ON clients(pinned, pinned_at);

CREATE TABLE barns (
  id            SERIAL PRIMARY KEY,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  initial_debt  NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_invoices INTEGER NOT NULL DEFAULT 0,
  total_profit  NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_barns_client_id ON barns(client_id);
```

### 3.4 Suppliers (الموردون)

```sql
CREATE TABLE suppliers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_suppliers_name ON suppliers(name);
```

### 3.5 Products (no stock here; stock is per warehouse)

```sql
CREATE TABLE products (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  company         TEXT,                    -- manufacturer / brand
  category        TEXT,
  barcode         TEXT,
  purchase_price  NUMERIC(15,2) NOT NULL DEFAULT 0,
  selling_price   NUMERIC(15,2) NOT NULL DEFAULT 0,
  alert_level     INTEGER NOT NULL DEFAULT 0,   -- min stock alert
  expiry_date     DATE,
  image_url       TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_barcode ON products(barcode);
```

### 3.6 Product stock per warehouse

```sql
CREATE TABLE product_warehouse_stock (
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE INDEX idx_pws_warehouse ON product_warehouse_stock(warehouse_id);
CREATE INDEX idx_pws_product ON product_warehouse_stock(product_id);
```

### 3.7 Supplier purchases (فاتورة شراء من المورد)

When you receive goods from a supplier, you record a purchase: total amount owed and which warehouse the goods go to. Line items update `product_warehouse_stock`.

```sql
CREATE TABLE supplier_purchases (
  id            SERIAL PRIMARY KEY,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  total_amount  NUMERIC(15,2) NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES users(id)
);

CREATE INDEX idx_supplier_purchases_supplier ON supplier_purchases(supplier_id);
CREATE INDEX idx_supplier_purchases_warehouse ON supplier_purchases(warehouse_id);
CREATE INDEX idx_supplier_purchases_created ON supplier_purchases(created_at);

CREATE TABLE supplier_purchase_items (
  id                SERIAL PRIMARY KEY,
  supplier_purchase_id INTEGER NOT NULL REFERENCES supplier_purchases(id) ON DELETE CASCADE,
  product_id        INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price        NUMERIC(15,2) NOT NULL,
  total_price       NUMERIC(15,2) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spi_purchase ON supplier_purchase_items(supplier_purchase_id);
```

### 3.8 Supplier payments (deposits — سداد للمورد)

Each payment to a supplier reduces what you owe and reduces the safe.

```sql
CREATE TABLE supplier_payments (
  id              SERIAL PRIMARY KEY,
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL DEFAULT 'cash',   -- cash, bank, etc.
  notes           TEXT,
  payment_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id)
);

CREATE INDEX idx_supplier_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX idx_supplier_payments_date ON supplier_payments(payment_date);
```

### 3.9 Safe (الصندوق)

One logical safe. Balance is derived from transactions (audit trail).

```sql
CREATE TABLE safe_transactions (
  id              SERIAL PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('initial', 'customer_payment_in', 'supplier_payment_out', 'adjustment_in', 'adjustment_out')),
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  reference_type  TEXT,   -- 'customer_payment', 'supplier_payment', 'invoice', etc.
  reference_id    INTEGER,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id)
);

CREATE INDEX idx_safe_transactions_created ON safe_transactions(created_at);
CREATE INDEX idx_safe_transactions_type ON safe_transactions(type);
```

- **Balance:**  
  `initial` + `customer_payment_in` + `adjustment_in` − `supplier_payment_out` − `adjustment_out`.

Optional: a single row `safe` with `current_balance` updated by triggers for fast reads; otherwise compute from `safe_transactions`.

### 3.10 Sales invoices (فواتير البيع)

Each invoice is tied to one **warehouse** (which stock we sell from).

```sql
CREATE TABLE invoices (
  id              SERIAL PRIMARY KEY,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  barn_id         INTEGER REFERENCES barns(id) ON DELETE SET NULL,
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  customer_name  TEXT NOT NULL,
  total_amount    NUMERIC(15,2) NOT NULL,
  paid_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  profit_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_method  TEXT NOT NULL DEFAULT 'cash',   -- كاش، آجل
  status          TEXT NOT NULL DEFAULT 'معلق',   -- مدفوعة، معلقة، مكتمل، جزئي
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id)
);

CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_barn ON invoices(barn_id);
CREATE INDEX idx_invoices_warehouse ON invoices(warehouse_id);
CREATE INDEX idx_invoices_created ON invoices(created_at);
CREATE INDEX idx_invoices_status ON invoices(status);

CREATE TABLE invoice_items (
  id           SERIAL PRIMARY KEY,
  invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(15,2) NOT NULL,
  total_price  NUMERIC(15,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);
```

### 3.11 Customer payments (مدفوعات العملاء)

```sql
CREATE TABLE payments (
  id              SERIAL PRIMARY KEY,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  barn_id         INTEGER NOT NULL REFERENCES barns(id) ON DELETE RESTRICT,
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL DEFAULT 'cash',
  notes           TEXT,
  payment_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES users(id)
);

CREATE INDEX idx_payments_client ON payments(client_id);
CREATE INDEX idx_payments_barn ON payments(barn_id);
CREATE INDEX idx_payments_date ON payments(payment_date);
```

### 3.12 Optional: transactions (for client history / legacy)

```sql
CREATE TABLE transactions (
  id         SERIAL PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  amount     NUMERIC(15,2) NOT NULL,
  ref_id     INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_client ON transactions(client_id);
```

---

## 4. Database ERD (Relationships)

```mermaid
erDiagram
    users ||--o{ invoices : "created_by"
    users ||--o{ supplier_purchases : "created_by"
    users ||--o{ supplier_payments : "created_by"
    users ||--o{ safe_transactions : "created_by"

    warehouses ||--o{ product_warehouse_stock : "has"
    warehouses ||--o{ supplier_purchases : "receives"
    warehouses ||--o{ invoices : "sold_from"

    clients ||--o{ barns : "has"
    clients ||--o{ invoices : "has"
    clients ||--o{ payments : "has"
    clients ||--o{ transactions : "has"

    barns ||--o{ invoices : "has"
    barns ||--o{ payments : "has"

    suppliers ||--o{ supplier_purchases : "has"
    suppliers ||--o{ supplier_payments : "has"

    products ||--o{ product_warehouse_stock : "stock_at"
    products ||--o{ supplier_purchase_items : "item"
    products ||--o{ invoice_items : "item"

    supplier_purchases ||--o{ supplier_purchase_items : "contains"
    invoices ||--o{ invoice_items : "contains"

    users { UUID id PK, auth_id, email, display_name, role, is_active }
    warehouses { int id PK, name_ar, name_en }
    clients { int id PK, name, phone, initial_debt, last_visit, total_profit, pinned }
    barns { int id PK, client_id FK, name, initial_debt }
    suppliers { int id PK, name, phone, email }
    products { int id PK, name, company, category, purchase_price, selling_price }
    product_warehouse_stock { product_id PK FK, warehouse_id PK FK, quantity }
    supplier_purchases { int id PK, supplier_id FK, warehouse_id FK, total_amount }
    supplier_purchase_items { int id PK, supplier_purchase_id FK, product_id FK, quantity, unit_price }
    supplier_payments { int id PK, supplier_id FK, amount, payment_date }
    safe_transactions { int id PK, type, amount, reference_type, reference_id }
    invoices { int id PK, client_id FK, barn_id FK, warehouse_id FK, total_amount, paid_amount, status }
    invoice_items { int id PK, invoice_id FK, product_id FK, quantity, unit_price }
    payments { int id PK, client_id FK, barn_id FK, amount, payment_date }
```

---

## 5. Backend API (REST)

Base URL example: `/api/v1`. All endpoints (except login) require auth (JWT or session). Pagination: `?page=1&limit=20`. Filtering per resource as needed.

### 5.1 Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Body: `{ "email", "password" }` → JWT + user info (id, email, display_name, role) |
| POST | `/auth/refresh` | Body: `{ "refreshToken" }` → new access token |
| POST | `/auth/logout` | Invalidate refresh token |
| GET | `/auth/me` | Current user (from JWT) |

### 5.2 Users (admin only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | List users (paginated) |
| GET | `/users/:id` | Get one user |
| POST | `/users` | Create user (invite) |
| PATCH | `/users/:id` | Update user (role, is_active, display_name) |
| DELETE | `/users/:id` | Deactivate or delete (policy) |

### 5.3 Warehouses

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/warehouses` | List all (اجهور, شبرا) — usually two fixed rows |

### 5.4 Clients

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/clients` | List, paginated; query: `search`, `pinned` |
| GET | `/clients/:id` | One client with barns |
| GET | `/clients/:id/balance` | Current balance (initial_debt + invoices - payments) |
| POST | `/clients` | Create client |
| PATCH | `/clients/:id` | Update client |
| PATCH | `/clients/:id/pin` | Toggle pinned |
| PATCH | `/clients/:id/favorite` | Toggle favorite |
| DELETE | `/clients/:id` | Delete client (cascade barns, then invoices/items, transactions) |

### 5.5 Barns

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/clients/:clientId/barns` | List barns of client |
| GET | `/barns/:id` | One barn with balance |
| POST | `/clients/:clientId/barns` | Create barn |
| PATCH | `/barns/:id` | Update barn |
| DELETE | `/barns/:id` | Delete barn |

### 5.6 Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/products` | List, paginated; query: `search`, `category`, `warehouse_id` (stock > 0), `low_stock`, `expiring` |
| GET | `/products/:id` | One product with stock per warehouse |
| GET | `/products/:id/stock` | Stock by warehouse (product_warehouse_stock) |
| POST | `/products` | Create product (no stock; add stock via supplier purchase or adjustment) |
| PATCH | `/products/:id` | Update product |
| DELETE | `/products/:id` | Delete product (cascade stock rows) |
| POST | `/products/:id/stock-adjustment` | Body: `{ "warehouse_id", "quantity_delta", "reason" }` — adjust stock (optional: log in a movements table) |

### 5.7 Suppliers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/suppliers` | List, paginated; query: `search` |
| GET | `/suppliers/:id` | One supplier |
| GET | `/suppliers/:id/balance` | Balance = sum(supplier_purchases.total_amount) - sum(supplier_payments.amount) |
| GET | `/suppliers/:id/purchases` | List supplier_purchases (paginated) |
| GET | `/suppliers/:id/payments` | List supplier_payments (paginated) |
| POST | `/suppliers` | Create supplier |
| PATCH | `/suppliers/:id` | Update supplier |
| DELETE | `/suppliers/:id` | Soft delete or restrict if has purchases/payments |

### 5.8 Supplier purchases

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/supplier-purchases` | Body: `{ "supplier_id", "warehouse_id", "total_amount", "notes", "items": [ { "product_id", "quantity", "unit_price", "total_price" } ] }`. Insert supplier_purchases + supplier_purchase_items; for each item increase product_warehouse_stock(product_id, warehouse_id) by quantity. |
| GET | `/supplier-purchases` | List, paginated; query: `supplier_id`, `warehouse_id`, `from`, `to` |
| GET | `/supplier-purchases/:id` | One purchase with items |

### 5.9 Supplier payments (deposits)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/supplier-payments` | Body: `{ "supplier_id", "amount", "payment_method", "notes", "payment_date" }`. Insert supplier_payments; insert safe_transactions(type='supplier_payment_out', amount). |
| GET | `/supplier-payments` | List, paginated; query: `supplier_id`, `from`, `to` |

### 5.10 Safe

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/safe/balance` | Current balance (sum of safe_transactions by type) |
| GET | `/safe/transactions` | List safe_transactions (paginated); query: `from`, `to`, `type` |
| POST | `/safe/initial` | Body: `{ "amount", "notes" }` — type `initial` (one-time setup) |
| POST | `/safe/adjustment` | Body: `{ "type": "adjustment_in" | "adjustment_out", "amount", "notes" }` |

Customer payment in: when recording a **customer payment** with method cash, backend also inserts `safe_transactions(type='customer_payment_in', amount, reference_type='payment', reference_id=payment.id)`.

### 5.11 Invoices (sales)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/invoices` | List, paginated; query: `client_id`, `barn_id`, `warehouse_id`, `status`, `from`, `to` |
| GET | `/invoices/:id` | One invoice with items (and product details) |
| POST | `/invoices` | Body: `{ "client_id", "barn_id", "warehouse_id", "customer_name", "payment_method", "paid_amount", "notes", "items": [ { "product_id", "product_name", "quantity", "unit_price", "total_price" } ] }`. Insert invoice + invoice_items; for each item decrease product_warehouse_stock(product_id, warehouse_id); update client/barn totals; if paid_amount > 0 and payment_method cash, insert payment + allocate to invoices + insert safe_transactions(customer_payment_in). |
| PATCH | `/invoices/:id` | Update (e.g. notes); no change to items/stock in minimal design |
| DELETE | `/invoices/:id` | Delete invoice (cascade items); optionally restore stock (policy) |

### 5.12 Customer payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/payments` | Body: `{ "client_id", "barn_id", "amount", "payment_method", "notes", "payment_date" }`. Insert payments; allocate to barn’s unpaid invoices (oldest first); update invoice paid_amount/status; if payment_method is cash, insert safe_transactions(customer_payment_in). |
| GET | `/payments` | List; query: `client_id`, `barn_id`, `from`, `to` |

### 5.13 Account statement

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/account-statement/client/:clientId` | Query: `from`, `to`. Returns opening balance, invoices in range, payments in range, closing balance. |
| GET | `/account-statement/barn/:barnId` | Same for barn. |

### 5.14 Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/reports/dashboard` | Stats: total sales, profit, client debt, product count, low stock, expiring, unpaid invoices, safe balance, supplier total payable. |
| GET | `/reports/sales` | Query: `from`, `to`, `warehouse_id`. Sales, profit, invoice count. |
| GET | `/reports/top-products` | Query: `from`, `to`, `warehouse_id`, `limit`. |
| GET | `/reports/by-category` | Query: `from`, `to`. Sales by category. |
| GET | `/reports/suppliers-summary` | Per-supplier balance (what you owe). |

---

## 6. Front-end: Every Page and Layout

Single-page app (SPA) or Next.js app with these routes and a **dashboard layout** (sidebar + header).

### 6.1 Layout Structure

- **Auth layout:** No sidebar; only login/signup (if you add it).
- **Dashboard layout:**  
  - **Sidebar (RTL):** Logo, then nav: لوحة التحكم، العملاء، المخزون (اجهور / شبرا أو منتجات مع فلتر مخزن)، الموردون، الصندوق، الفواتير، سجل الفواتير، المدفوعات، كشف الحساب، التقارير، الإعدادات، (إدارة المستخدمين للمشرف).  
  - **Header:** Search (optional), notifications, profile menu (الإعدادات، تسجيل الخروج).  
  - **Main content:** Outlet for current route.

### 6.2 Route → Page Mapping

| Route | Page name (Arabic) | Purpose |
|-------|--------------------|--------|
| `/` | Redirect to `/dashboard` or `/login` | — |
| `/login` | تسجيل الدخول | Email + password, remember me, submit → JWT, redirect to dashboard |
| `/dashboard` | لوحة التحكم | KPI cards (sales, profit, debt, safe balance, supplier payable, low stock, expiring), recent invoices, quick actions (new invoice, clients, inventory, suppliers, safe) |
| `/clients` | العملاء | Table: name, phone, balance, pinned/favorite, actions (view, edit, delete). Filters: search, pinned. Button: add client. |
| `/clients/:id` | تفاصيل العميل | Tabs: معلومات (balance, add payment, barns summary), عنابر (list, add/edit/delete barn), كشف الحساب (link or embedded date range + statement table) |
| `/clients/:id/account-statement` | كشف حساب العميل | Date range picker, table: date, type (invoice/payment), description, debit, credit, balance (running) |
| `/barns/:id` | تفاصيل العنبر | Balance, list of invoices and payments for this barn |
| `/inventory` | المخزون | Tabs or dropdown: اجهور | شبرا (or “all”). Table: product name, category, stock (per warehouse), alert, expiry, actions. Filters: search, category, low stock, expiring. Buttons: add product, receive from supplier (→ supplier purchase flow). |
| `/inventory/products/:id` | تفاصيل المنتج | Edit product; show stock per warehouse; stock adjustment form (warehouse, +/- quantity) |
| `/suppliers` | الموردون | Table: name, phone, balance (what we owe), actions. Button: add supplier. |
| `/suppliers/:id` | تفاصيل المورد | Balance, list of purchases (with warehouse), list of payments (deposits). Buttons: new purchase, new deposit. |
| `/suppliers/:id/purchases/new` | فاتورة شراء | Form: supplier (read-only if from detail), warehouse (اجهور/شبرا), items (product, qty, unit price, total), total amount, notes. Submit → POST supplier-purchases + update stock. |
| `/supplier-payments/new` | سداد لمورد | Form: supplier, amount, payment method, date, notes. Submit → POST supplier-payments + safe out. |
| `/safe` | الصندوق | Current balance (big), list of safe_transactions (date, type, amount, reference, notes). Buttons: initial balance (if empty), adjustment in/out. |
| `/invoices/new` | فاتورة بيع جديدة | Step or form: select client → barn → **warehouse** (اجهور/شبرا), customer name, add items (product from that warehouse with available stock), payment method, paid amount, notes. Submit → POST invoices + deduct stock + optional payment + safe in if cash. |
| `/invoices` | سجل الفواتير | Table: id, date, client, barn, warehouse, total, paid, status, actions (view, delete?). Filters: date range, client, warehouse, status. |
| `/invoices/:id` | تفاصيل الفاتورة | View only: header + line items. Link to client/barn. |
| `/payments/new` | تسجيل دفعة عميل | Form: client, barn, amount, payment method, date, notes. Submit → POST payments + allocate to invoices + safe in if cash. |
| `/payments` | سجل المدفوعات | Table: date, client, barn, amount, method. Filters: date, client. |
| `/reports` | التقارير | Period selector (from–to). Sections: sales, profit, by warehouse, top products, by category, supplier payables summary. Charts (e.g. bar/line) + tables. |
| `/settings` | الإعدادات | Profile (display name, password change), theme (light/dark), business info, about. Logout. |
| `/users` | إدارة المستخدمين | (Admin only.) Table: email, display name, role, active. Add/edit user. |

### 6.3 Key UI Components (reusable)

- **DataTable:** Sortable, paginated, RTL; columns configurable per page.
- **FormModal / Drawer:** Add/Edit client, barn, product, supplier, payment, purchase, adjustment.
- **DateRangePicker:** For reports and account statement.
- **Select (async):** Client, barn, warehouse, supplier, product (with stock filter by warehouse).
- **BalanceCard:** Big number + label (e.g. رصيد الصندوق، إجمالي مديونية الموردين).
- **StatementTable:** Columns: date, type, description, debit, credit, balance.

### 6.4 Data Flow (front-end)

- **Auth:** Login → store tokens (memory + optional httpOnly cookie); axios/fetch interceptor adds `Authorization`; on 401 → refresh or redirect to login.
- **Lists:** TanStack Query: `useQuery(['clients', page, search])`, `useQuery(['products', warehouse_id, category])`, etc.
- **Mutations:** `useMutation` → POST/PATCH/DELETE → invalidate relevant queries (e.g. `invalidateQueries(['invoices'])` after create).
- **Safe balance:** `useQuery(['safe', 'balance'])`; after payment or supplier deposit, invalidate `['safe']`.

---

## 7. Critical Flows (Backend Logic)

### 7.1 Receive products from supplier (شراء من مورد)

1. User selects supplier, **warehouse** (اجهور or شبرا), and line items (product, quantity, unit_price).
2. Backend:  
   - Insert `supplier_purchases` (supplier_id, warehouse_id, total_amount).  
   - For each line insert `supplier_purchase_items` and **add** `product_warehouse_stock(product_id, warehouse_id).quantity` by item.quantity.  
3. Supplier balance (what you owe) = sum(supplier_purchases) - sum(supplier_payments) — no extra table; computed.

### 7.2 Pay supplier (سداد لمورد — deposit)

1. User selects supplier, amount, payment method, date.  
2. Backend:  
   - Insert `supplier_payments`.  
   - Insert `safe_transactions(type='supplier_payment_out', amount, reference_type='supplier_payment', reference_id=id)`.  
3. Safe balance decreases; supplier balance (owed) decreases.

### 7.3 Customer pays (دفعة عميل)

1. User selects client, barn, amount, payment method (e.g. cash).  
2. Backend:  
   - Insert `payments`.  
   - Allocate to barn’s unpaid invoices (oldest first): update `invoices.paid_amount` and `status`.  
   - If payment_method is cash: insert `safe_transactions(type='customer_payment_in', amount, reference_type='payment', reference_id=id)`.  
3. Safe balance increases (for cash).

### 7.4 Create sale invoice (فاتورة بيع)

1. User selects client, barn, **warehouse** (اجهور or شبرا), items (from that warehouse’s stock), payment method, paid amount.  
2. Backend:  
   - Insert `invoices` (with warehouse_id).  
   - Insert `invoice_items`; for each item **subtract** from `product_warehouse_stock(product_id, warehouse_id)`.  
   - Update client/barn (total_profit, last_visit, total_invoices).  
   - If paid_amount > 0: create payment record and allocate; if cash, add `safe_transactions(customer_payment_in)`.

---

## 8. Summary Checklist

- **SQL:** 15+ tables: users, warehouses, clients, barns, suppliers, products, product_warehouse_stock, supplier_purchases, supplier_purchase_items, supplier_payments, safe_transactions, invoices, invoice_items, payments, (transactions).  
- **Backend:** REST API as in Section 5; auth, CRUD per resource, supplier purchase (stock in by warehouse), supplier payment (safe out), customer payment (allocation + safe in if cash), invoice (stock out by warehouse).  
- **Front-end:** Dashboard layout with sidebar; pages for login, dashboard, clients, barns, inventory (per warehouse), suppliers, supplier purchase/deposit, safe, invoices, payments, account statement, reports, settings, users.  
- **Two warehouses:** اجهور and شبرا; stock per (product, warehouse); sales and purchases both tied to warehouse.  
- **Suppliers:** Balance = purchases - deposits; deposits reduce safe.  
- **Safe:** One balance from safe_transactions; in from customer cash payments, out from supplier payments and adjustments.

This design is enough to implement the web dashboard from scratch (front-end and back-end) and to create the database (e.g. run the SQL in Supabase or any PostgreSQL host).

---

## 9. Seed Data & Migration Order

### 9.1 Create tables in this order (to satisfy FKs)

1. `users`
2. `warehouses` → seed اجهور, شبرا
3. `clients`
4. `barns`
5. `suppliers`
6. `products`
7. `product_warehouse_stock`
8. `supplier_purchases`
9. `supplier_purchase_items`
10. `supplier_payments`
11. `safe_transactions`
12. `invoices`
13. `invoice_items`
14. `payments`
15. `transactions` (optional)

### 9.2 Seed warehouses

```sql
INSERT INTO warehouses (name_ar, name_en) VALUES
  ('اجهور', 'Aghour'),
  ('شبرا', 'Shubra');
```

### 9.3 Optional: first safe balance

After first deploy, use “الصندوق” page → “رصيد افتتاحي” to add one `safe_transactions(type='initial', amount, notes)`.

---

## 10. Suggested Implementation Order

1. **DB:** Create schema + seed warehouses.  
2. **Auth:** Login, JWT, `/auth/me`, protect routes.  
3. **Core CRUD:** Users, clients, barns, products, warehouses (read-only).  
4. **Stock:** product_warehouse_stock; product list with stock by warehouse; stock adjustment or first receive via supplier purchase.  
5. **Suppliers:** CRUD, balance (computed), supplier_purchases + items (add stock to warehouse), supplier_payments (and safe out).  
6. **Safe:** balance API, safe_transactions list, initial + adjustment.  
7. **Invoices:** Create invoice (with warehouse), invoice_items, deduct stock; link payment method and paid amount to safe in.  
8. **Payments:** Record customer payment, allocation to invoices, safe in if cash.  
9. **Account statement:** Client/barn, date range.  
10. **Reports:** Dashboard stats, sales, top products, suppliers summary.  
11. **Front-end:** Layout and pages in the order above; then polish (RTL, validation, loading states).

---

## 11. Flutter App Features & Functions — Full Parity

This section lists **every feature and function** from the Flutter app so the web dashboard can replicate them. For each: **user action**, **UI (forms, validation)**, **API/backend**, and **validation rules**.

---

### 11.1 Authentication

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **Login** | Enter email + password, optionally check "remember me", tap تسجيل الدخول | Form: email (text), password (obscured, toggle visibility), checkbox "تذكرني", link "نسيت كلمة المرور؟", button disabled until both fields non-empty | POST `/auth/login` body `{ email, password }`. Response: JWT + user (id, email, display_name, role). If "remember me", persist email (e.g. localStorage). Fetch user role from `users` by email; if `is_active` false → sign out and show error. | Email: required, valid format (`^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$`). Password: required, min 6 chars. |
| **Remember me** | Check/uncheck on login | Checkbox "تذكرني" | Save email in localStorage/cookie when checked; pre-fill email on next visit. | — |
| **Forgot password** | Tap "نسيت كلمة المرور؟" | Link (Flutter shows SnackBar "سيتم إضافة هذه الميزة قريباً") | Optional: POST `/auth/forgot-password` or Supabase reset. | — |
| **Logout** | Tap logout in settings or header | Menu item "تسجيل الخروج" | POST `/auth/logout` or clear tokens; clear stored user/role. Redirect to `/login`. | — |
| **Session** | — | — | On 401, try refresh token; else redirect to login. Supabase or JWT refresh. | — |

---

### 11.2 Clients — List & Actions

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **List clients** | Open clients page, scroll, pull-to-refresh | Table or cards: name, phone, balance, pinned/favorite indicators. Pagination (e.g. 10 per page), infinite scroll or "Load more". Tabs: "العملاء" (active), "المفضلة", "الأرشيف". | GET `/clients?page=&limit=&search=&pinned=` (or filter by status/favorite in front-end). GET `/clients/:id/balance` in background for each row. | Sort: pinned first (by pinned_at), then by name or debt (debt_desc / debt_asc). |
| **Search clients** | Type in search bar | Search input; search by name, phone, location. Arabic normalization (أ/إ/آ → ا, ة→ه, etc.). | GET `/clients?search=...` or filter client-side if list already loaded. | — |
| **Filter & sort** | Open filter modal, choose status and sort, tap تطبيق | Modal: Status chips "جميع العملاء", "نشط", "مؤرشف". Sort dropdown: "ترتيب أبجدي", "الأكبر مديونية", "الأقل مديونية". Buttons: إعادة تعيين, تطبيق. | Filter/sort applied client-side to current list or refetch with query params. | — |
| **Add client** | Tap "إضافة عميل" (FAB or button) | Modal/drawer form: **اسم العميل** (required), **رقم الهاتف** (optional), **المديونية المبدئية** (optional). Buttons: إلغاء, حفظ. | POST `/clients` body `{ name, phone?, location?, initial_debt?, favorite: false, pinned: false }`. Default location "غير محدد". | Name: required, min 2 chars. Phone: if provided, Egyptian format `(01|\+201)[0-9]{9}`. Initial debt: number, >= 0. |
| **Edit client** | From list: swipe left → "تعديل العميل"; or open client detail → toggle edit → edit name/phone → save | List: swipe or context menu "تعديل". Detail: Info tab, edit mode: fields name, phone, button "حفظ التغييرات". | PATCH `/clients/:id` body `{ name?, phone?, ... }`. | Same as add for name/phone. |
| **Delete client** | Swipe or context menu → "حذف العميل" → confirm | Confirmation dialog: "هل أنت متأكد من حذف العميل …؟ تحذير: سيتم حذف جميع البيانات المرتبطة (فواتير، مدفوعات، عنابر)." Buttons: إلغاء, حذف. | DELETE `/clients/:id`. Backend: delete invoice_items for client's invoices, then invoices, then transactions, then barns, then client. | — |
| **Duplicate client** | Long-press client → "تكرار العميل" | Context menu item. | POST `/clients` with same data as existing client but no `id`, name += " - نسخة". | — |
| **Pin / Unpin** | Long-press → "تثبيت العميل" / "إلغاء التثبيت" | Context menu. | PATCH `/clients/:id/pin` body `{ pinned: true|false }`. Backend set `pinned_at` when pinning. | — |
| **Favorite / Unfavorite** | Long-press → "إضافة للمفضلة" / "إزالة من المفضلة" | Context menu. | PATCH `/clients/:id/favorite` body `{ favorite: true|false }`. | — |
| **Archive / Unarchive** | Swipe left → "أرشفة العميل" / "إلغاء الأرشفة" | Bottom sheet option. | PATCH `/clients/:id` body `{ status: 'archived'|'active' }`. | Tab "الأرشيف" shows status=archived. |
| **Export client info** | Long-press → "تصدير المعلومات" | Context menu (Flutter shows SnackBar). | Optional: GET `/clients/:id/export` or generate PDF/Excel. | — |
| **Call client** | Swipe right → "اتصال" or tap call on detail | Opens `tel:phone`. | Front-end only: `window.location` or `tel:` link. | — |
| **Message client** | Swipe right → "رسالة" or tap message on detail | Opens `sms:phone`. | Front-end only: `sms:` link. | — |
| **View barns** | Swipe right → "عرض الحظائر" | Navigate to client detail → Barns tab. | — | — |
| **Refresh list** | Pull-to-refresh or tap refresh in app bar | Refresh icon. | Reload GET `/clients` from page 0, clear cache. | — |

---

### 11.3 Client Detail

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **View client** | Tap client in list | Header card: name, phone, call/message buttons. Tabs: المعلومات, العنابر, السجل. | GET `/clients/:id`, GET `/clients/:id/barns`, GET `/clients/:id/balance`. | — |
| **Info tab** | View balance, total profit; add payment; edit info | Display: إجمالي ربحي من العميل (total_profit), إجمالي حساب العميل (balance) with button "سداد". Edit mode: name, phone, "حفظ التغييرات". | GET `/clients/:id/balance`. PATCH `/clients/:id` on save. Add payment: see 11.4. | — |
| **Add payment (from client)** | In Info tab tap "سداد" | Dialog: dropdown "العنبر" (required), text "المبلغ" (number), suffix "جنيه". Buttons: إلغاء, تأكيد السداد. If no barns: show "لا توجد عنابر متاحة". | POST `/payments` body `{ client_id, barn_id, amount, payment_method: 'cash', notes }`. Backend: allocate to barn's unpaid invoices (oldest first), update invoice paid_amount/status, update client last_visit. If cash: add safe_transaction in. | Amount > 0, barn selected. |
| **Barns tab** | View barns, add barn, open barn, delete barn | List of cards: barn name, "إجمالي حساب العنبر" (balance). Button "إضافة عنبر جديد". Tap barn → barn detail. Long-press → delete confirmation. | GET `/clients/:clientId/barns` (with balance per barn). POST `/clients/:clientId/barns`, DELETE `/barns/:id`. | — |
| **History tab** | View invoices / payments history | List of client invoices (or mixed history). Tap invoice for action. | GET `/clients/:id/invoices` or from invoices with client_id. | — |
| **Open account statement** | Tap app bar icon "كشف الحساب" | Navigate to account statement with client (and optional barn), date range. | GET `/account-statement/client/:clientId?from=&to=`. | — |
| **Toggle edit mode** | Tap edit icon in app bar | Icon toggles edit/close; when edit, switch to Info tab, fields editable. | — | — |
| **Refresh** | Pull-to-refresh | Reload barns + invoices + balance. | GET barns, GET invoices, GET balance. | — |
| **Save client data** | In edit mode tap "حفظ التغييرات" | Callback updates local state; call PATCH. | PATCH `/clients/:id` body `{ name, phone }`. | — |

---

### 11.4 Barns

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **Add barn** | In client detail Barns tab → "إضافة عنبر جديد" | Dialog: **اسم العنبر** (required), **المديونية المبدئية** (optional, ج.م). Buttons: إلغاء, حفظ. | POST `/clients/:clientId/barns` body `{ name, initial_debt? }`. | Name required. Initial debt: number >= 0. |
| **Edit barn** | (From barn detail or inline edit if provided) | If supported: form name, initial_debt. | PATCH `/barns/:id` body `{ name?, initial_debt? }`. | — |
| **Delete barn** | Long-press barn card → confirm | Dialog: "هل أنت متأكد من حذف العنبر …؟ تحذير: سيتم حذف جميع الفواتير المرتبطة بهذا العنبر." | DELETE `/barns/:id`. Backend: optionally block if invoices exist or cascade (design choice). Flutter deletes barn only (invoices may remain with barn_id null). | — |
| **View barn detail** | Tap barn card | Screen: barn name, balance, list of invoices for barn, total profit. | GET `/barns/:id`, GET barn invoices, GET `/barns/:id` balance. | — |

---

### 11.5 Products / Inventory

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **List products** | Open inventory, choose tab and category | Tabs: الكل, "منخفض المخزون", "قارب على الانتهاء". Dropdown category: الكل + (مضادات حيوية, فيتامينات, …). Search bar. Pagination / load more (e.g. 20 per page). Cards or table: image, name, company, category, stock, purchase/selling price, profit. | GET `/products?page=&limit=&search=&category=&warehouse_id=&low_stock=&expiring=`. For web: include stock per warehouse or filter by warehouse. | — |
| **Add product** | Tap "إضافة منتج" | Form: **اسم المنتج**, **الشركة المصنعة**, **الكمية الحالية**, **سعر الشراء**, **سعر البيع**, **الفئة** (dropdown), **الباركود** (optional), **صورة المنتج** (optional upload). Buttons: إلغاء, إضافة. | POST `/products` body `{ name, company?, current_stock?, purchase_price, selling_price, category, barcode?, image_url? }`. In web with warehouses: product has no global stock; add product then use "receive from supplier" or "stock adjustment" to set stock per warehouse. Optionally allow initial_stock per warehouse on create. | Name required. Prices >= 0. Stock >= 0. Category from fixed list. |
| **Edit product** | Long-press or menu → "تعديل المنتج" | Same fields as add; image: show current or new file, option to remove. Button "حفظ". | PATCH `/products/:id` body same fields. Upload image to storage, set image_url. | Same validation. |
| **Delete product** | Long-press → "حذف المنتج" or swipe → delete | Confirmation: "هل أنت متأكد من حذف المنتج …؟ تحذير: لا يمكن التراجع." | DELETE `/products/:id`. Backend: delete from storage if image_url set, then delete product (and product_warehouse_stock by FK). | — |
| **Edit stock** | Menu → "تعديل المخزون" | Dialog: product name, field "الكمية الجديدة". | In web: POST `/products/:id/stock-adjustment` body `{ warehouse_id, quantity_delta, reason? }` or PUT per-warehouse stock. Flutter: PATCH product current_stock. | New quantity >= 0; for web validate per warehouse. |
| **Record sale (quick)** | Menu → "تسجيل بيع" | Dialog: quantity sold, selling price. | Flutter: deduct product current_stock. In web: prefer creating an invoice (with one item) or a dedicated "quick sale" that deducts from a chosen warehouse. | Quantity <= available stock. |
| **Product history** | Menu → "سجل المنتج" | Placeholder "سيتم إضافة سجل المنتج هنا". | Optional: GET `/products/:id/movements` (stock in/out log). | — |
| **Duplicate product** | Menu → "نسخ المنتج" | Flutter placeholder. | POST `/products` with same data, name += " - نسخة", no id. | — |
| **Create category** | In category dropdown/dialog → "إنشاء فئة جديدة" | Dialog: new category name. | Add to allowed categories (config or DB table) and use in product. | — |
| **Upload / replace image** | In add/edit product, pick image | Image picker; preview; on save upload to storage, set image_url. | Upload to Supabase Storage or S3; store URL in product. | — |
| **Delete product image** | In edit, remove image | Clear image_url and delete file from storage. | PATCH product image_url=null; delete object from storage. | — |
| **Filter: low stock** | Tab "منخفض المخزون" | Show products where current_stock <= alert_level (or per-warehouse). | GET `/products?low_stock=1` or filter by alert_level. | — |
| **Filter: expiring** | Tab "قارب على الانتهاء" | Show products with expiry_date within next 30 days. | GET `/products?expiring=1` or filter by expiry_date. | — |

---

### 11.6 Invoices (Sales)

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **Create invoice** | Tap "فاتورة جديدة" or from dashboard | Step 1: Select client → load barns → select barn (optional). Step 2: Select **warehouse** (اجهور/شبرا). Step 3: Customer name, add products (search, pick from warehouse stock), quantity per product; total/remaining. Step 4: Payment method (كاش / آجل), paid amount, notes. Buttons: إلغاء, حفظ. | POST `/invoices` body `{ client_id, barn_id?, warehouse_id, customer_name, payment_method, paid_amount, notes, items: [ { product_id, product_name, quantity, unit_price, total_price } ] }`. Backend: insert invoice + invoice_items; deduct product_warehouse_stock(product_id, warehouse_id) by quantity; update client (total_profit, last_visit), barn (total_invoices, total_profit); if paid_amount > 0 create payment and allocate; if cash add safe_transaction. | Items: quantity <= available stock in that warehouse. Paid amount >= 0. At least one item. |
| **List invoices** | Open "سجل الفواتير" | Table: id, date, client, barn, warehouse, total, paid, status. Pagination, filters (date range, client, warehouse, status). | GET `/invoices?page=&limit=&client_id=&warehouse_id=&status=&from=&to=`. | — |
| **View invoice** | Tap invoice row | Detail: header (client, barn, warehouse, date, total, paid, status), line items (product, qty, unit price, total). | GET `/invoices/:id` with items. | — |
| **Delete invoice** | From list or detail (if role allows) | Confirmation dialog. | DELETE `/invoices/:id`. Backend: restore stock for each item (add back to product_warehouse_stock), then delete invoice_items, then invoice. Optionally reverse client/barn totals. | — |

---

### 11.7 Customer Payments

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **Record payment** | From invoice history "تسجيل دفعة" or client detail "سداد" | Form: select client → select barn, amount, payment method (كاش/آجل etc.), date, notes. Buttons: إلغاء, تأكيد. | POST `/payments` body `{ client_id, barn_id, amount, payment_method, notes?, payment_date }`. Backend: allocate to barn's unpaid invoices (oldest first), update invoice paid_amount and status (مكتمل/جزئي); update client last_visit; if payment_method cash insert safe_transaction(customer_payment_in). | Amount > 0. Barn required. |
| **List payments** | Open "سجل المدفوعات" | Table: date, client, barn, amount, method. Filters: date, client. | GET `/payments?client_id=&from=&to=`. | — |

---

### 11.8 Account Statement

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **By client** | Select client (e.g. from dashboard or client list), open account statement | Date range picker (from, to). Summary: opening balance, closing balance. Table: date, type (invoice/payment), description, debit, credit, running balance. Optional: product-level breakdown (excel-like table as in Flutter). | GET `/account-statement/client/:clientId?from=&to=`. Backend: balance before period = initial_debt + sum(invoices before) - sum(payments before); same for after; list invoices and payments in range. | — |
| **By barn** | Select barn (e.g. from client detail) | Same UI, scoped to barn. | GET `/account-statement/barn/:barnId?from=&to=`. | — |

---

### 11.9 Reports

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **Period** | Select date range (from, to) | Date pickers or preset (today, week, month). | All report endpoints accept `from`, `to`. | — |
| **Dashboard stats** | Open dashboard | Cards: إجمالي المبيعات, إجمالي الأرباح, إجمالي مديونية العملاء, عدد المنتجات, منتجات منخفضة المخزون, منتجات قاربت على الانتهاء, فواتير غير مسددة, رصيد الصندوق, إجمالي مديونية الموردين. Recent invoices list. | GET `/reports/dashboard` or aggregate from invoices, products, clients, safe, suppliers. | — |
| **Sales / profit** | Reports page | Numbers and/or chart for sales and profit in period. | GET `/reports/sales?from=&to=&warehouse_id=`. | — |
| **Top products** | Reports page | Table or chart: product, quantity sold or revenue. | GET `/reports/top-products?from=&to=&limit=&warehouse_id=`. | — |
| **By category** | Reports page | Sales (or count) per category. | GET `/reports/by-category?from=&to=`. | — |
| **Suppliers summary** | Reports page | Per supplier: balance (what you owe). | GET `/reports/suppliers-summary`. | — |

---

### 11.10 Safe (الصندوق)

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **View balance** | Open safe page | Big number "رصيد الصندوق", list of transactions (date, type, amount, reference, notes). | GET `/safe/balance`, GET `/safe/transactions?from=&to=`. | — |
| **Initial balance** | First-time setup | Form: amount, notes. | POST `/safe/initial` body `{ amount, notes }`. Insert safe_transaction(type='initial'). | One-time or as needed. |
| **Adjustment** | "تعديل رصيد" or "إيداع/سحب يدوي" | Form: type (إيداع/سحب), amount, notes. | POST `/safe/adjustment` body `{ type: 'adjustment_in'|'adjustment_out', amount, notes }`. | Amount > 0. |
| **In/Out from payments** | — | Shown in transactions: customer_payment_in, supplier_payment_out. | Created by backend when recording customer payment (cash) or supplier payment. | — |

---

### 11.11 Suppliers (Web-only; parity with design)

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **List suppliers** | Open suppliers page | Table: name, phone, balance (what we owe). Search. | GET `/suppliers?search=`. Balance = sum(purchases)-sum(payments). | — |
| **Add supplier** | "إضافة مورد" | Form: name, phone, email, address, notes. | POST `/suppliers`. | Name required. |
| **Edit supplier** | From list or detail | Same fields. | PATCH `/suppliers/:id`. | — |
| **Supplier detail** | Tap supplier | Balance, list of purchases (with warehouse), list of payments (deposits). Buttons: new purchase, new deposit. | GET `/suppliers/:id`, GET `/suppliers/:id/balance`, GET purchases, GET payments. | — |
| **Receive from supplier (purchase)** | "فاتورة شراء" | Form: supplier (read-only if from detail), warehouse (اجهور/شبرا), line items (product, quantity, unit price, total), total amount, notes. | POST `/supplier-purchases` with items; backend adds to product_warehouse_stock and increases supplier balance. | Total = sum of line totals. |
| **Pay supplier (deposit)** | "سداد لمورد" | Form: supplier, amount, payment method, date, notes. | POST `/supplier-payments`; backend inserts safe_transaction(supplier_payment_out). | Amount > 0. |

---

### 11.12 Settings

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **Profile** | Open settings → Profile | Display: email, display name. Edit display name; change password (optional). | GET `/auth/me`, PATCH `/users/me` or profile endpoint, POST `/auth/change-password`. | — |
| **Theme** | Toggle light/dark | Theme selector (light/dark/system). | Persist in localStorage or user prefs. | — |
| **Business settings** | Section in settings | Business name, address, phone, etc. | GET/PATCH `/settings/business` or similar. | — |
| **Security** | Section | Change password, 2FA placeholder, etc. | — | — |
| **Data management** | Section | Export data, import data, sync (Flutter used SharedPreferences). | Optional: GET `/export`, POST `/import`. | — |
| **About** | Section | App name, version, links. | — | — |
| **Logout** | Tap logout | Clears session, redirect to login. | POST `/auth/logout` or clear tokens. | — |

---

### 11.13 User Management (Admin)

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **List users** | Open "إدارة المستخدمين" (admin only) | Table: email, display name, role, active. | GET `/users`. | — |
| **Add user** | "إضافة مستخدم" | Form: email, password, display name, role (super_admin, admin, staff). | POST `/users` or invite; create in auth + users table. | Email unique, password min 6. |
| **Edit user** | From list | Role, is_active, display name. | PATCH `/users/:id`. | — |
| **Delete / deactivate** | From list | Confirmation. | DELETE or PATCH is_active=false. | Cannot deactivate self. |

---

### 11.14 Dashboard

| Feature | User action | UI | API / Backend | Validation & notes |
|--------|-------------|-----|----------------|---------------------|
| **KPI cards** | View dashboard | Total sales, profit, client debt, product count, low stock, expiring, unpaid invoices, safe balance, supplier payables. | GET `/reports/dashboard`. | — |
| **Recent invoices** | View dashboard | List of last 3–5 invoices (client, barn, total, date). Tap → invoice detail. | From dashboard stats or GET `/invoices?limit=5`. | — |
| **Quick actions** | Tap buttons | Clients, المخزون (inventory), فاتورة جديدة, سجل الفواتير, التقارير. | Navigation only. | — |
| **Account statement from dashboard** | Tap "كشف الحساب" | Open client selection dialog → select client → open account statement with client. | Same as account statement. | — |

---

### 11.15 Validation Summary (reusable rules)

- **Client name:** Required, min 2 characters.  
- **Client phone:** Optional; if present: Egyptian format `(01|\+201)[0-9]{9}`.  
- **Initial debt (client/barn):** Optional, number >= 0.  
- **Barn name:** Required.  
- **Product name:** Required.  
- **Product prices & stock:** >= 0.  
- **Payment amount:** > 0.  
- **Invoice:** At least one line item; quantity <= available stock in selected warehouse.  
- **Email:** Valid format; unique for users.  
- **Password:** Min 6 characters (login/signup).  
- **Arabic search:** Normalize (أ/إ/آ→ا, ة→ه, ي→ى, remove diacritics) for client name/location search.

Use these rules in both front-end (immediate feedback) and back-end (API validation).
