# Vet Pharmacy Manager — Full Description, Entities, Data Flow & Diagrams

This document gives a complete description of the app from login/signup through the most complex flows, lists all entities with attributes, summarizes data flow, and provides an ERD, a context diagram, and a Level 1 data flow diagram.

---

## 1. App Overview

**Vet Pharmacy Manager** is a Flutter (Dart) mobile application for managing a **veterinary pharmacy**. It is **Arabic-first (RTL)** and **portrait-only**. The app handles:

- **Users & auth** (Supabase Auth + app `users` table for roles)
- **Clients** (with optional **barns/chambers** per client)
- **Products** (inventory, stock, categories, images in Supabase Storage)
- **Invoices** (header + line items, cash/credit, paid/remaining)
- **Payments** (per client/barn, allocated to unpaid invoices)
- **Reports** (sales, profit, active clients, top products, by category)
- **Account statement** (by client or by barn, date range, opening/closing balance)

**Tech stack:** Flutter, Supabase (Auth + PostgreSQL + Storage), SharedPreferences (remember-me, legacy app_users).

---

## 2. Flow from Login to Most Complex Features

### 2.1 Startup & Auth

1. **App start** (`main.dart`): Load `env.json` → initialize Supabase (url, anon key) → `StorageSetup.initializeStorage()` (bucket `product-images`) → initial route `/` → **SplashScreen**.
2. **SplashScreen**: Reads `AuthService.currentUser` (Supabase). If user exists **and** “remember me” is set → navigate to **Dashboard**; else → sign out and navigate to **Login**.
3. **Login**: User enters email/password. `AuthService.signInWithEmail()` → Supabase `signInWithPassword`. On success:
   - Fetch row from **users** by email → `display_name`, `role`, `is_active`.
   - If `is_active == false` → sign out and show error.
   - Else → save current user to SharedPreferences (`current_user_*`) and optionally save email for “remember me” → navigate to **Dashboard**.
4. **Sign up**: Handled via Supabase Auth (`signUp`); app also reads **users** for role/display_name after login.
5. **Logout** (Settings): `AuthService.signOut()` → Supabase signOut + clear SharedPreferences (current_user_*, role, username).

**Roles:** `super_admin`, `admin`, `staff`. Permissions (e.g. view_profits, manage_clients, manage_users, view_reports, edit_inventory, delete_invoice) are checked in `AuthService.hasPermission`. User management (create/update/delete users) uses legacy SharedPreferences `app_users` for local users; **login** uses Supabase Auth + **users** table.

---

### 2.2 Dashboard

- **Data:** `SupabaseService.getDashboardStatistics()` (cached 5 min). Fallback: queries to **invoices** (total_amount, paid_amount, status), **products** (stock, alert_level, expiry_date, purchase_price), **invoice_items** (quantity, unit_price, products.purchase_price), **clients** and **barns** (initial_debt), plus recent invoices with clients/barns.
- **Displayed:** Total sales, total profit, total client debt, product count, low-stock count, expiring count, unpaid invoices count, total inventory value, recent invoices list.
- **Actions:** Quick links to Clients, Inventory, New Invoice, Invoice History, Reports; “Account statement” opens client selection → then **AccountStatementScreen**.

---

### 2.3 Clients

- **List:** `SupabaseService.getClientsPaginated()` / `getClientsWithPagination()` from **clients** (search by name/phone, sort: pinned first then name). Background: `getClientTotalBalance(clientId)` for balance display.
- **CRUD:** Add → `addClient`; Edit → `updateClient`; Favorite → `updateClientFavoriteStatus`; Pin → `updateClientPinnedStatus`; Delete → `deleteClientWithAllData` (cascades: invoice_items → invoices → transactions → clients). Cache cleared after writes.
- **Client detail:** Tabs — **Info** (balance, add payment), **History** (payments), **Barns** (list, add/edit/delete barn). Data: `getClientBarns`, `getBarnTotalBalance`, `getClientInvoices`, `getClientTotalBalance`. Writes: `updateClient`, `addBarn`, `updateBarn`, `deleteRow('barns')`; from Info tab: `insertRow('payments')`, `updateRow('invoices', paid_amount/status)`, `updateClient`.

---

### 2.4 Barns (Chambers)

- **Entity:** Belongs to one **client**. Has own `initial_debt`, `total_invoices`, `total_profit`, `updated_at`.
- **Usage:** Selected when creating an invoice or a payment. Invoices and payments are linked to **barn_id** and **client_id**. Account statement can be by client or by barn.

---

### 2.5 Inventory (Products)

- **List:** `SupabaseService.getProductsWithPagination()` from **products** (search, category filter, low-stock/expiring filters). Images from Storage bucket `product-images`.
- **CRUD:** Add/Edit/Delete in **InventoryManagementScreen** via `_supabase.from('products').insert/update/delete`. Stock adjustments update `current_stock`. Product image upload/delete uses Storage `product-images`.

**Product fields used:** id, name, company, current_stock, purchase_price, selling_price, category, barcode, image_url, alert_level, expiry_date, created_at.

---

### 2.6 Invoices

- **Create (InvoiceCreationScreen):**
  - Select client → load barns → select barn (optional) → add products (from **products**) with quantity → set payment method (كاش / آجل), paid amount, notes.
  - On save:
    1. Insert **invoices** (customer_name, client_id, barn_id?, total_amount, paid_amount, remaining_amount, payment_method, status, profit_amount, notes).
    2. Insert **invoice_items** per line (invoice_id, product_id?, product_name, quantity, unit_price, total_price).
    3. Update **products** (`current_stock` -= quantity).
    4. Update **clients** (total_profit, last_visit).
    5. Update **barns** (total_invoices, total_profit, updated_at).
  - Caches: `clearInvoicesCache()`.
- **History:** `getAllInvoicesWithPagination()` (invoices + clients/barns), with **invoice_items** loaded; from here user can open **PaymentCreationScreen**.

---

### 2.7 Payments

- **Record payment:** From Invoice History or from Client detail (Info tab). User selects client → barn → amount and payment method.
  - Insert **payments** (client_id, barn_id, amount, payment_method, notes, payment_date).
  - Allocate to barn’s unpaid invoices (oldest first): update **invoices** (paid_amount, status = مكتمل/جزئي).
  - Update **clients** (last_visit). `clearPaymentsCache()`.

---

### 2.8 Account Statement

- **Screen:** By client or by barn, with date range.
- **Data:** `getClientInvoicesForPeriod`, `getBarnInvoicesForPeriod`, `getClientPaymentsForPeriod`, `getBarnPaymentsForPeriod`, `getClientBalanceBeforePeriod`, `getClientBalanceAfterPeriod`, `getBarnBalanceBeforePeriod`, `getBarnBalanceAfterPeriod`. Balance formula: initial_debt + sum(invoices) - sum(payments) over the relevant period.
- **Display:** Summary (opening/closing balance), table of invoices and payments in period, product-level timeline/table where applicable. Read-only; no direct writes from this screen.

---

### 2.9 Reports

- **Data:** `SupabaseService.getReportsStatistics(startDate, endDate)` (cached). Aggregates from **invoices**, **invoice_items**, **products**, **clients** (e.g. sales, profit, invoice count, active clients, top products, sales by category).
- **Display:** Period selector and charts/numbers. Read-only.

---

### 2.10 Settings

- Profile (from `AuthService.getCurrentUserInfo()`), theme, business settings, security, data management (sync/export/import via **DataSyncService** / SharedPreferences), about. Logout → sign out and go to Login.

---

## 3. Entities and Attributes

There are no Dart model classes; data is `Map<String, dynamic>` from Supabase or local storage. Inferred entities and attributes:

| Entity | Attributes | Notes |
|--------|------------|--------|
| **users** | id (auth), email, display_name, role, is_active | Supabase table; used after login for role/name/active. |
| **clients** | id, name, phone, location?, initial_debt, last_visit, total_invoices?, total_profit?, status?, barns_count?, favorite, pinned, pinned_at, created_at | Supabase; sort by pinned then name. |
| **barns** | id, client_id, name, initial_debt, total_invoices?, total_profit?, created_at, updated_at? | Supabase; 1 barn → 1 client. |
| **products** | id, name, company, current_stock, purchase_price, selling_price, category, barcode?, image_url?, alert_level?, expiry_date?, created_at | Supabase; images in Storage `product-images`. |
| **invoices** | id, client_id, barn_id?, customer_name, total_amount, paid_amount, remaining_amount?, profit_amount?, payment_method, status, notes?, created_at | Supabase; status e.g. مدفوعة, معلقة, مكتمل, جزئي. |
| **invoice_items** | id, invoice_id, product_id?, product_name, quantity, unit_price, total_price | Supabase; optional product_id for link to products. |
| **payments** | id, client_id, barn_id, amount, payment_method, notes?, payment_date | Supabase. |
| **transactions** | id?, client_id?, … | Supabase; only referenced on delete (cascade when deleting client). Not read in UI. |
| **Local app_users** | username → password, displayName, role, isActive, createdAt, createdBy | SharedPreferences; legacy user management. |
| **Cache / in-memory** | _clientsCache, _balanceCache, _invoicesCache, _paymentsCache, _dashboardCache, _reportsCache | SupabaseService; 5-min expiry where used. |

---

## 4. Relationships (for ERD)

- **users** — 1:1 with Supabase Auth; one app user per email; role in **users**.
- **clients** 1:N **barns** (barns.client_id).
- **clients** 1:N **invoices** (invoices.client_id), 1:N **payments** (payments.client_id).
- **barns** 1:N **invoices** (invoices.barn_id), 1:N **payments** (payments.barn_id).
- **invoices** 1:N **invoice_items** (invoice_items.invoice_id).
- **products** N:1 **invoice_items** (invoice_items.product_id, optional).
- **transactions** — referenced by client (delete cascade only).

---

## 5. Data Flow Summary

- **Source of truth:** Supabase (PostgreSQL) for clients, barns, products, invoices, invoice_items, payments, users; Supabase Auth for session; Supabase Storage for product images.
- **Read path:** Screens call `SupabaseService` (and sometimes `AuthService`). SupabaseService uses in-memory caches (clients, balances, invoices, payments, dashboard, reports) with 5-minute expiry; cache-clear methods after writes.
- **Write path:** Auth via AuthService (Supabase Auth + **users** read). All other writes go through SupabaseService or direct `_supabase.from(...)` in inventory/payment/invoice screens: clients, barns, products, invoices, invoice_items, payments; client/barn aggregates (total_profit, last_visit, total_invoices, etc.) updated on invoice/payment.
- **Local:** SharedPreferences (remember_me, current_user_*, app_users); DataSyncService for export/import; DataManager in-memory fallback for “recent transactions” when no Supabase data.

---

## 6. ERD — Entity Relationship Diagram

Below is the ERD in Mermaid format showing entities and relationships (no attributes in diagram for clarity; attributes are in Section 3).

```mermaid
erDiagram
    clients ||--o{ barns : "has"
    clients ||--o{ invoices : "has"
    clients ||--o{ payments : "has"
    clients ||--o{ transactions : "has"
    barns ||--o{ invoices : "has"
    barns ||--o{ payments : "has"
    invoices ||--o{ invoice_items : "contains"
    products ||--o{ invoice_items : "referenced_by"

    users {
        int id PK
        string email
        string display_name
        string role
        bool is_active
    }

    clients {
        int id PK
        string name
        string phone
        string location
        double initial_debt
        timestamp last_visit
        double total_profit
        bool favorite
        bool pinned
        timestamp pinned_at
        timestamp created_at
    }

    barns {
        int id PK
        int client_id FK
        string name
        double initial_debt
        int total_invoices
        double total_profit
        timestamp created_at
        timestamp updated_at
    }

    products {
        int id PK
        string name
        string company
        int current_stock
        double purchase_price
        double selling_price
        string category
        string barcode
        string image_url
        int alert_level
        date expiry_date
        timestamp created_at
    }

    invoices {
        int id PK
        int client_id FK
        int barn_id FK
        string customer_name
        double total_amount
        double paid_amount
        double remaining_amount
        double profit_amount
        string payment_method
        string status
        string notes
        timestamp created_at
    }

    invoice_items {
        int id PK
        int invoice_id FK
        int product_id FK
        string product_name
        int quantity
        double unit_price
        double total_price
    }

    payments {
        int id PK
        int client_id FK
        int barn_id FK
        double amount
        string payment_method
        string notes
        timestamp payment_date
    }

    transactions {
        int id PK
        int client_id FK
    }
```

---

## 7. Context Diagram (Level 0 DFD)

The system is shown as a single process with external entities and data flows.

```mermaid
flowchart LR
    subgraph External
        User([User])
        SupabaseAuth([Supabase Auth])
        SupabaseDB[(Supabase DB)]
        SupabaseStorage[(Supabase Storage)]
    end

    subgraph System
        App["Vet Pharmacy Manager App"]
    end

    User -->|"email, password, remember_me"| App
    User -->|"client/barn/product/invoice/payment data, filters, dates"| App
    App -->|"credentials"| SupabaseAuth
    SupabaseAuth -->|"session, user id"| App
    App -->|"read/write queries"| SupabaseDB
    SupabaseDB -->|"clients, barns, products, invoices, payments, users"| App
    App -->|"upload/delete/list"| SupabaseStorage
    SupabaseStorage -->|"product images"| App
    App -->|"UI, errors, success"| User
```

---

## 8. Level 1 Data Flow Diagram

Level 1 DFD expands the app into major processes and shows data stores and flows.

```mermaid
flowchart TB
    subgraph External
        User([User])
    end

    subgraph Processes
        P1["1.0\nAuthenticate"]
        P2["2.0\nManage Clients & Barns"]
        P3["3.0\nManage Inventory"]
        P4["4.0\nCreate & Manage Invoices"]
        P5["5.0\nRecord Payments"]
        P6["6.0\nView Reports & Account Statement"]
        P7["7.0\nSettings & User Management"]
    end

    subgraph DataStores
        D1[(Supabase Auth)]
        D2[(users)]
        D3[(clients)]
        D4[(barns)]
        D5[(products)]
        D6[(invoices)]
        D7[(invoice_items)]
        D8[(payments)]
        D9[(transactions)]
        D10[(Supabase Storage)]
        D11[("Local\nSharedPreferences")]
    end

    User -->|credentials, remember_me| P1
    P1 -->|signIn/signUp/signOut| D1
    P1 -->|read role, display_name, is_active| D2
    D1 -->|session| P1
    D2 -->|user info| P1
    P1 -->|save session/remember_me| D11
    P1 -->|redirect to dashboard/login| User

    User -->|client/barn CRUD, search, pin/favorite| P2
    P2 -->|read/write| D3
    P2 -->|read/write| D4
    P2 -->|delete cascade| D6
    P2 -->|delete cascade| D7
    P2 -->|delete| D9
    D3 -->|clients list, balance| P2
    D4 -->|barns list, balance| P2
    P2 -->|client list, detail, balance| User

    User -->|product CRUD, stock adjust, filters| P3
    P3 -->|read/write| D5
    P3 -->|upload/delete/list| D10
    D5 -->|products list, details| P3
    D10 -->|images| P3
    P3 -->|inventory UI| User

    User -->|select client, barn, products, amounts| P4
    P4 -->|read| D3
    P4 -->|read| D4
    P4 -->|read| D5
    P4 -->|insert| D6
    P4 -->|insert| D7
    P4 -->|update stock| D5
    P4 -->|update totals, last_visit| D3
    P4 -->|update totals| D4
    D3 -->|clients, barns| P4
    D4 -->|barns| P4
    D5 -->|products| P4
    P4 -->|invoice created| User

    User -->|client, barn, amount, method| P5
    P5 -->|read| D3
    P5 -->|read| D4
    P5 -->|read unpaid| D6
    P5 -->|insert| D8
    P5 -->|update paid_amount, status| D6
    P5 -->|update last_visit| D3
    D3 -->|clients| P5
    D4 -->|barns| P5
    D6 -->|invoices| P5
    P5 -->|payment confirmed| User

    User -->|date range, client/barn, period| P6
    P6 -->|read| D3
    P6 -->|read| D4
    P6 -->|read| D6
    P6 -->|read| D7
    P6 -->|read| D8
    D3 -->|balances, clients| P6
    D4 -->|barns, balances| P6
    D6 -->|invoices| P6
    D7 -->|items| P6
    D8 -->|payments| P6
    P6 -->|reports, statement| User

    User -->|profile, theme, logout, user CRUD| P7
    P7 -->|read user| D2
    P7 -->|signOut| D1
    P7 -->|read/write app_users| D11
    D2 -->|user info| P7
    D11 -->|prefs| P7
    P7 -->|settings UI| User
```

---

## 9. Quick Reference — Screens and Data

| Screen | Reads | Writes |
|--------|--------|--------|
| Splash | AuthService.currentUser, getRememberMe | — |
| Login | — | signInWithEmail, setRememberMe, saveUsername |
| Dashboard | getDashboardStatistics, getRecentInvoices | — |
| Client management | getClientsPaginated, getClientTotalBalance | addClient, updateClient, favorite/pinned, deleteClientWithAllData |
| Client detail | getClientBarns, getBarnTotalBalance, getClientInvoices, getClientTotalBalance | updateClient, addBarn, updateBarn, deleteBarn, insertRow payments, updateRow invoices |
| Account statement | getClientBarns, getClient/BarnInvoicesForPeriod, getClient/BarnPaymentsForPeriod, getClient/BarnBalanceBefore/AfterPeriod | — |
| Barn detail | getBarnInvoices, getBarnTotalProfit | — |
| Inventory | getProductsWithPagination | products insert/update/delete, Storage |
| Invoice creation | getClients, getClientBarns, products | insertRow invoices, invoice_items; updateRow products, updateClient, updateBarn |
| Invoice history | getAllInvoicesWithPagination, getAllPaymentsWithPagination | — (opens Payment creation) |
| Payment creation | getClients, getClientBarns, getBarnInvoices | insertRow payments, updateRow invoices, updateClient |
| Reports | getReportsStatistics | — |
| Settings | getCurrentUserInfo, theme/prefs | signOut, theme/prefs |
| User management | getAllUsers (prefs) | createUser, updateUser, deleteUser (prefs) |

---

## 10. File Reference

- **Entry / config:** `lib/main.dart`, `lib/core/app_export.dart`, `lib/routes/app_routes.dart`
- **Auth:** `lib/core/auth_service.dart`
- **Data:** `lib/core/supabase_service.dart`, `lib/core/data_manager.dart`, `lib/core/data_sync_service.dart`, `lib/core/storage_setup.dart`
- **Screens:** `lib/presentation/splash_screen/`, `lib/presentation/login_screen/`, `lib/presentation/dashboard_screen/`, `lib/presentation/client_management_screen/`, `lib/presentation/client_detail_screen/`, `lib/presentation/account_statement_screen/`, `lib/presentation/barn_detail_screen/`, `lib/presentation/inventory_management_screen.dart`, `lib/presentation/invoice_creation_screen.dart`, `lib/presentation/invoice_history_screen.dart`, `lib/presentation/payment_creation_screen.dart`, `lib/presentation/reports_screen.dart`, `lib/presentation/settings_screen/`, `lib/presentation/user_management_screen.dart`

---

You can render the Mermaid diagrams in any Markdown viewer that supports Mermaid (e.g. GitHub, GitLab, VS Code with Mermaid extension, or [mermaid.live](https://mermaid.live)).
