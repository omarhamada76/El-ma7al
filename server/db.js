/**
 * SQLite persistence for Vet Pharmacy Dashboard backend.
 * Database file: data/vet-pharmacy.sqlite (created on first run).
 */
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync, existsSync, readFileSync, readdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'data')
export const dbPath = join(dataDir, 'vet-pharmacy.sqlite')

let db

/** Max length for `products.image_url` (e.g. data URLs) — rejects oversized JSON bodies. */
const MAX_PRODUCT_IMAGE_URL_LEN = 800_000
function assertProductImageUrlField(v) {
  if (v == null || v === '') return
  if (typeof v !== 'string') throw new Error('صورة المنتج غير صالحة')
  if (v.length > MAX_PRODUCT_IMAGE_URL_LEN) {
    throw new Error('صورة المنتج كبيرة جداً — قلّل الحجم وحاول مجدداً')
  }
}

function getDb() {
  if (db) return db
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  ensureInvoiceDiscountColumn(db)
  ensureInvoiceEditAuditColumns(db)
  syncTotalsFromInvoices(db)
  seedIfEmpty()
  return db
}

const migrationsDir = join(__dirname, 'migrations')

function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)
  if (!existsSync(migrationsDir)) return
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const insert = database.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)'
  )
  const done = database.prepare('SELECT 1 FROM schema_migrations WHERE name = ?')
  for (const name of files) {
    if (done.get(name)) continue
    const sql = readFileSync(join(migrationsDir, name), 'utf8')
    const run = database.transaction(() => {
      database.exec(sql)
      insert.run(name, new Date().toISOString())
    })
    run()
  }
}

function ensureInvoiceDiscountColumn(database) {
  try {
    const cols = database.prepare('PRAGMA table_info(invoices)').all()
    if (!cols.some((c) => c.name === 'discount_amount')) {
      database.exec('ALTER TABLE invoices ADD COLUMN discount_amount REAL DEFAULT 0')
    }
  } catch (_) { /* ignore */ }
}

function ensureInvoiceEditAuditColumns(database) {
  try {
    const cols = database.prepare('PRAGMA table_info(invoices)').all()
    const names = new Set(cols.map((c) => c.name))
    if (!names.has('last_edited_by')) {
      database.exec('ALTER TABLE invoices ADD COLUMN last_edited_by INTEGER REFERENCES users(id)')
    }
    if (!names.has('last_edited_at')) {
      database.exec('ALTER TABLE invoices ADD COLUMN last_edited_at TEXT')
    }
    if (!names.has('edit_override_reason')) {
      database.exec('ALTER TABLE invoices ADD COLUMN edit_override_reason TEXT')
    }
  } catch (_) { /* ignore */ }
}

function syncTotalsFromInvoices(database) {
  try {
    database.exec(`
      UPDATE clients SET total_profit = (SELECT COALESCE(SUM(profit_amount),0) FROM invoices WHERE invoices.client_id = clients.id
        AND (COALESCE(invoices.invoice_lifecycle, 'active') != 'cancelled'))
    `)
    database.exec(`
      UPDATE barns SET
        total_invoices = (SELECT COUNT(*) FROM invoices WHERE invoices.barn_id = barns.id
          AND (COALESCE(invoices.invoice_lifecycle, 'active') != 'cancelled')),
        total_profit = (SELECT COALESCE(SUM(profit_amount),0) FROM invoices WHERE invoices.barn_id = barns.id
          AND (COALESCE(invoices.invoice_lifecycle, 'active') != 'cancelled'))
    `)
  } catch (_) { /* ignore */ }
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as n FROM warehouses').get()
  if (count.n > 0) return
  db.prepare(`
    INSERT INTO warehouses (id, name_ar, name_en, is_active) VALUES
    (1, 'اجهور', 'Aghour', 1),
    (2, 'شبرا', 'Shubra', 1)
  `).run()
}

function now() {
  return new Date().toISOString()
}

/** Expression: payment amount that counts toward AR (excludes آجل / deferred placeholders). */
function sqlPaymentAmountTowardArExpr(tableAlias) {
  const p = tableAlias ? `${tableAlias}.` : ''
  return `CASE WHEN COALESCE(${p}payment_method,'') IN ('deferred','آجل','credit') THEN 0 ELSE ${p}amount END`
}

function paymentAmountTowardArJs(p) {
  const m = String(p?.payment_method ?? '')
  return m !== 'deferred' && m !== 'آجل' && m !== 'credit'
}

/**
 * Route money for a customer payment row (آجل/deferred and historical backfill = no routing).
 * cash → safe; vodafone_cash / instapay → wallet_transactions.
 */
export function routePayment(paymentRow, db) {
  const d = db || getDb()
  const t = now()
  const method = paymentRow.payment_method
  const amount = Number(paymentRow.amount) || 0
  const id = paymentRow.id
  if (method === 'deferred' || method === 'historical_invoice_paid') return
  if (method === 'cash') {
    d.prepare(
      `
      INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
      VALUES ('customer_payment_in', ?, 'payment', ?, NULL, ?, NULL)
    `
    ).run(amount, id, t)
  } else if (method === 'vodafone_cash' || method === 'instapay') {
    d.prepare(
      `
      INSERT INTO wallet_transactions (type, amount, wallet_id, reference_type, reference_id, notes, created_at, created_by)
      VALUES ('invoice_payment_in', ?, ?, 'payment', ?, NULL, ?, NULL)
    `
    ).run(amount, paymentRow.wallet_id ?? null, id, t)
  }
}

function reverseRoutedPayment(d, paymentRow, t) {
  const method = paymentRow.payment_method
  if (method === 'deferred' || method === 'historical_invoice_paid') return
  if (method === 'cash') {
    d.prepare(`DELETE FROM safe_transactions WHERE reference_type = 'payment' AND reference_id = ?`).run(paymentRow.id)
  } else if (method === 'vodafone_cash' || method === 'instapay') {
    d.prepare(`DELETE FROM wallet_transactions WHERE reference_type = 'payment' AND reference_id = ?`).run(paymentRow.id)
  }
}

function deletePaymentsForInvoice(d, invoiceId, t) {
  const rows = d.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(invoiceId)
  for (const p of rows) {
    reverseRoutedPayment(d, p, t)
  }
  d.prepare('DELETE FROM payments WHERE invoice_id = ?').run(invoiceId)
}

function getOpenClientBillingCycleId(d, clientId) {
  const r = d
    .prepare(
      'SELECT id FROM client_billing_cycles WHERE client_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
    )
    .get(clientId)
  return r ? r.id : null
}

function insertPaymentWithRouting(d, payload) {
  const t = payload.created_at || now()
  const paymentDate = payload.payment_date || t.slice(0, 10)
  let barnBillingCycleId = payload.barn_billing_cycle_id ?? null
  if (barnBillingCycleId == null && payload.barn_id) {
    const ob = d
      .prepare(
        'SELECT id FROM barn_billing_cycles WHERE barn_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
      )
      .get(payload.barn_id)
    barnBillingCycleId = ob ? ob.id : null
  }
  let billingCycleId = payload.billing_cycle_id ?? null
  if (billingCycleId == null && payload.client_id) {
    billingCycleId = getOpenClientBillingCycleId(d, payload.client_id)
  }
  d.prepare(
    `
    INSERT INTO payments (client_id, barn_id, amount, payment_method, notes, payment_date, created_at, created_by, billing_cycle_id, barn_billing_cycle_id, invoice_id, wallet_id, settled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
  `
  ).run(
    payload.client_id,
    payload.barn_id ?? null,
    payload.amount ?? 0,
    payload.payment_method || 'cash',
    payload.notes ?? null,
    paymentDate,
    t,
    billingCycleId,
    barnBillingCycleId,
    payload.invoice_id ?? null,
    payload.wallet_id ?? null,
    payload.settled_at ?? null
  )
  const newId = d.prepare('SELECT last_insert_rowid() as id').get().id
  const row = d.prepare('SELECT * FROM payments WHERE id = ?').get(newId)
  routePayment(row, d)
  return row
}

/**
 * Keeps payment rows in sync with invoice totals. mode 'user' enforces آجل checkbox; 'recalc' auto-آجل when remaining > 0.
 */
function syncPaymentsForInvoice(d, invoiceId, invRow, opts, t) {
  const total = Math.max(0, Number(invRow.total_amount) || 0)
  let paid = Math.max(0, Number(invRow.paid_amount) || 0)
  if (paid > total) paid = total
  const remaining = Math.max(0, total - paid)
  const mode = opts?.mode || 'user'
  let registerDeferred = opts?.register_deferred === true
  if (remaining > 0 && paid === 0) registerDeferred = true
  if (mode === 'recalc') {
    registerDeferred = remaining > 0
  } else if (remaining > 0 && !registerDeferred) {
    throw new Error(
      'المبلغ المدفوع أقل من إجمالي الفاتورة.\nيرجى إدخال المبلغ المتبقي أو تسجيله كآجل'
    )
  }
  deletePaymentsForInvoice(d, invoiceId, t)
  const clientId = invRow.client_id
  const barnId = invRow.barn_id
  const billingCycleId = invRow.billing_cycle_id ?? null
  const barnBillingCycleId = invRow.barn_billing_cycle_id ?? null
  const immediateMethod = opts?.immediate_payment_method || 'cash'
  const walletId = opts?.wallet_id ?? null
  if (paid > 0) {
    insertPaymentWithRouting(d, {
      client_id: clientId,
      barn_id: barnId,
      amount: paid,
      payment_method: immediateMethod,
      notes: `دفعة فاتورة #${invoiceId}`,
      payment_date: (invRow.created_at || t).slice(0, 10),
      created_at: t,
      billing_cycle_id: billingCycleId,
      barn_billing_cycle_id: barnBillingCycleId,
      invoice_id: invoiceId,
      wallet_id: walletId,
    })
  }
  if (remaining > 0 && registerDeferred) {
    insertPaymentWithRouting(d, {
      client_id: clientId,
      barn_id: barnId,
      amount: remaining,
      payment_method: 'deferred',
      notes: `آجل فاتورة #${invoiceId}`,
      payment_date: (invRow.created_at || t).slice(0, 10),
      created_at: t,
      billing_cycle_id: billingCycleId,
      barn_billing_cycle_id: barnBillingCycleId,
      invoice_id: invoiceId,
      wallet_id: null,
    })
  }
}

function rowToClient(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    location: r.location,
    initial_debt: r.initial_debt ?? 0,
    last_visit: r.last_visit,
    total_profit: r.total_profit ?? 0,
    favorite: !!r.favorite,
    pinned: !!r.pinned,
    pinned_at: r.pinned_at,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function rowToBarn(r) {
  if (!r) return null
  return {
    id: r.id,
    client_id: r.client_id,
    name: r.name,
    initial_debt: r.initial_debt ?? 0,
    total_invoices: r.total_invoices ?? 0,
    total_profit: r.total_profit ?? 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function rowToProduct(r) {
  if (!r) return null
  const out = {
    id: r.id,
    name: r.name,
    company: r.company,
    category: r.category,
    barcode: r.barcode,
    unit_type: r.unit_type ?? 'piece',
    bag_weight_kg: r.bag_weight_kg ?? null,
    purchase_price: r.purchase_price ?? 0,
    selling_price: r.selling_price ?? 0,
    alert_level: r.alert_level ?? 0,
    alert_level_kg: r.alert_level_kg ?? null,
    expiry_date: r.expiry_date,
    image_url: r.image_url,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
  // Batch price ranges — only present when joined via getProducts
  if (r.purchase_price_min !== undefined) out.purchase_price_min = r.purchase_price_min
  if (r.purchase_price_max !== undefined) out.purchase_price_max = r.purchase_price_max
  if (r.selling_price_min !== undefined) out.selling_price_min = r.selling_price_min
  if (r.selling_price_max !== undefined) out.selling_price_max = r.selling_price_max
  if (r.batch_total_quantity !== undefined) out.batch_total_quantity = r.batch_total_quantity
  if (r.bulk_bag_count !== undefined) out.bulk_bag_count = r.bulk_bag_count
  if (r.bulk_open_bag_low !== undefined) out.bulk_open_bag_low = !!r.bulk_open_bag_low
  if (r.warehouse_stock !== undefined) out.warehouse_stock = r.warehouse_stock
  return out
}

function rowToSupplier(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    address: r.address,
    notes: r.notes,
    is_active: !!r.is_active,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

// ----- Clients -----
// ----- Users (auth) -----
export function countUsers() {
  try {
    const d = getDb()
    return d.prepare('SELECT COUNT(*) as n FROM users').get()?.n ?? 0
  } catch {
    return 0
  }
}

export function getUserByEmail(email) {
  const d = getDb()
  return d.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.trim())
}

export function getUserById(id) {
  const d = getDb()
  return d.prepare('SELECT * FROM users WHERE id = ?').get(id)
}

function rowToPublicUser(r) {
  if (!r) return null
  return {
    id: String(r.id),
    email: r.email,
    display_name: r.display_name,
    role: r.role,
    is_active: !!r.is_active,
  }
}

export function getUserPublic(id) {
  return rowToPublicUser(getUserById(id))
}

export function verifyUserPassword(email, plainPassword) {
  const row = getUserByEmail(email)
  if (!row || !row.is_active) return null
  if (!bcrypt.compareSync(plainPassword, row.password_hash)) return null
  return rowToPublicUser(row)
}

export function createUser({ email, password, display_name, role }) {
  const d = getDb()
  const password_hash = bcrypt.hashSync(password, 12)
  const t = now()
  const r = d
    .prepare(
      `
    INSERT INTO users (email, password_hash, display_name, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `
    )
    .run(email.trim().toLowerCase(), password_hash, display_name || '', role || 'staff', t, t)
  return getUserPublic(Number(r.lastInsertRowid))
}

export function listUsersPublic() {
  const d = getDb()
  const rows = d.prepare('SELECT id, email, display_name, role, is_active FROM users ORDER BY id').all()
  return rows.map((r) => rowToPublicUser(r))
}

const VALID_ROLES = new Set(['super_admin', 'admin', 'staff'])

export function updateUser(id, data) {
  const d = getDb()
  const row = getUserById(id)
  if (!row) return null
  const updates = []
  const params = []
  if (data.display_name !== undefined) {
    updates.push('display_name = ?')
    params.push(data.display_name ?? '')
  }
  if (data.role !== undefined) {
    if (!VALID_ROLES.has(data.role)) throw new Error('دور غير صالح')
    if (row.role === 'super_admin' && data.role !== 'super_admin') {
      const n = countActiveSuperAdmins()
      if (n <= 1 && row.is_active) {
        throw new Error('لا يمكن إزالة آخر مدير نظام نشط')
      }
    }
    updates.push('role = ?')
    params.push(data.role)
  }
  if (data.is_active !== undefined) {
    if (row.role === 'super_admin' && !data.is_active) {
      const n = countActiveSuperAdmins()
      if (n <= 1) throw new Error('لا يمكن تعطيل آخر مدير نظام نشط')
    }
    updates.push('is_active = ?')
    params.push(data.is_active ? 1 : 0)
  }
  if (data.password !== undefined && String(data.password).length > 0) {
    if (String(data.password).length < 6) throw new Error('كلمة المرور 6 أحرف على الأقل')
    updates.push('password_hash = ?')
    params.push(bcrypt.hashSync(String(data.password), 12))
  }
  if (updates.length === 0) return getUserPublic(id)
  updates.push('updated_at = ?')
  params.push(now())
  params.push(id)
  d.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return getUserPublic(id)
}

export function deleteUser(id) {
  const d = getDb()
  const row = getUserById(id)
  if (!row) return false
  const superCount =
    d.prepare(`SELECT COUNT(*) as n FROM users WHERE role = 'super_admin' AND is_active = 1`).get()?.n ?? 0
  if (row.role === 'super_admin' && superCount <= 1) {
    throw new Error('لا يمكن حذف آخر مدير نظام نشط في النظام')
  }
  d.prepare('DELETE FROM users WHERE id = ?').run(id)
  return true
}

export function countActiveSuperAdmins() {
  const d = getDb()
  return d.prepare(`SELECT COUNT(*) as n FROM users WHERE role = 'super_admin' AND is_active = 1`).get()?.n ?? 0
}

export function getClients(search, pinned, limit = 50, sort) {
  const d = getDb()
  let sql = 'SELECT * FROM clients WHERE 1=1'
  const params = []
  if (search) {
    sql += ' AND (LOWER(name) LIKE ? OR LOWER(COALESCE(phone,"")) LIKE ?)'
    const s = `%${search.toLowerCase()}%`
    params.push(s, s)
  }
  if (pinned === true || pinned === 'true') sql += ' AND pinned = 1'
  if (sort === 'debt_desc') {
    sql += ` ORDER BY (
      COALESCE(clients.initial_debt,0)
      + COALESCE((SELECT SUM(i.total_amount) FROM invoices i WHERE i.client_id = clients.id AND (COALESCE(i.invoice_lifecycle, 'active') != 'cancelled')), 0)
      - COALESCE((SELECT SUM(${sqlPaymentAmountTowardArExpr('p')}) FROM payments p WHERE p.client_id = clients.id), 0)
    ) DESC, clients.id DESC`
  } else {
    sql += ' ORDER BY id DESC'
  }
  sql += ' LIMIT ?'
  params.push(Math.min(limit, 500))
  const rows = d.prepare(sql).all(...params)
  const clients = rows.map(rowToClient)
  if (clients.length === 0) return clients
  const ids = clients.map((c) => c.id)
  const placeholders = ids.map(() => '?').join(',')
  const invRows = d.prepare(`SELECT client_id, COALESCE(SUM(total_amount),0) as s FROM invoices WHERE client_id IN (${placeholders}) AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled') GROUP BY client_id`).all(...ids)
  const payRows = d
    .prepare(
      `SELECT client_id, COALESCE(SUM(${sqlPaymentAmountTowardArExpr('')}),0) as s FROM payments WHERE client_id IN (${placeholders}) GROUP BY client_id`
    )
    .all(...ids)
  const invByClient = Object.fromEntries(invRows.map((r) => [r.client_id, r.s]))
  const payByClient = Object.fromEntries(payRows.map((r) => [r.client_id, r.s]))
  return clients.map((c) => ({
    ...c,
    balance: (c.initial_debt ?? 0) + (invByClient[c.id] ?? 0) - (payByClient[c.id] ?? 0),
  }))
}

export function getClientById(id) {
  const r = getDb().prepare('SELECT * FROM clients WHERE id = ?').get(id)
  return rowToClient(r)
}

export function createClient(data) {
  const d = getDb()
  const t = now()
  const stmt = d.prepare(`
    INSERT INTO clients (name, phone, location, initial_debt, last_visit, total_profit, favorite, pinned, pinned_at, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, 0, 0, 0, NULL, ?, ?, ?)
  `)
  stmt.run(
    data.name || '',
    data.phone ?? null,
    data.location ?? null,
    data.initial_debt ?? 0,
    data.notes ?? null,
    t,
    t
  )
  const id = d.prepare('SELECT last_insert_rowid() as id').get().id
  return getClientById(id)
}

export function updateClient(id, data) {
  const d = getDb()
  const allowed = ['name', 'phone', 'location', 'initial_debt', 'notes']
  const updates = []
  const params = []
  for (const k of allowed) {
    if (data[k] !== undefined) {
      updates.push(`${k} = ?`)
      params.push(data[k])
    }
  }
  if (updates.length === 0) return getClientById(id)
  params.push(now(), id)
  d.prepare(`UPDATE clients SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...params)
  return getClientById(id)
}

export function deleteClient(id) {
  const d = getDb()
  const clientId = id
  // Delete client's سجل الفواتير (invoices + items) and سجل السداد (payments), then barns, then client
  const invoices = d.prepare('SELECT id FROM invoices WHERE client_id = ?').all(clientId)
  for (const inv of invoices) {
    d.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(inv.id)
  }
  d.prepare('DELETE FROM invoices WHERE client_id = ?').run(clientId)
  d.prepare('DELETE FROM payments WHERE client_id = ?').run(clientId)
  d.prepare('DELETE FROM barns WHERE client_id = ?').run(clientId)
  d.prepare('DELETE FROM clients WHERE id = ?').run(clientId)
}

export function toggleClientPin(id) {
  const c = getClientById(id)
  if (!c) return null
  const pinned = !c.pinned
  const t = now()
  getDb().prepare('UPDATE clients SET pinned = ?, pinned_at = ?, updated_at = ? WHERE id = ?').run(pinned ? 1 : 0, pinned ? t : null, t, id)
  return getClientById(id)
}

export function toggleClientFavorite(id) {
  const c = getClientById(id)
  if (!c) return null
  const t = now()
  getDb().prepare('UPDATE clients SET favorite = ?, updated_at = ? WHERE id = ?').run(c.favorite ? 0 : 1, t, id)
  return getClientById(id)
}

// ----- Client balance -----
export function getClientBalance(clientId) {
  const c = getClientById(clientId)
  if (!c) return null
  const d = getDb()
  const invTotal = d.prepare(`SELECT COALESCE(SUM(total_amount),0) as s FROM invoices WHERE client_id = ? AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')`).get(clientId)?.s ?? 0
  const paid =
    d
      .prepare(
        `SELECT COALESCE(SUM(${sqlPaymentAmountTowardArExpr('')}),0) as s FROM payments WHERE client_id = ?`
      )
      .get(clientId)?.s ?? 0
  return (c.initial_debt ?? 0) + invTotal - paid
}

// ----- Barns -----
export function getBarnsByClientId(clientId) {
  const rows = getDb().prepare('SELECT * FROM barns WHERE client_id = ? ORDER BY id').all(clientId)
  return rows.map(rowToBarn)
}

export function getBarnById(id) {
  return rowToBarn(getDb().prepare('SELECT * FROM barns WHERE id = ?').get(id))
}

export function createBarn(clientId, data) {
  const d = getDb()
  const t = now()
  d.prepare(`
    INSERT INTO barns (client_id, name, initial_debt, total_invoices, total_profit, created_at, updated_at)
    VALUES (?, ?, ?, 0, 0, ?, ?)
  `).run(clientId, data.name || '', data.initial_debt ?? 0, t, t)
  const id = d.prepare('SELECT last_insert_rowid() as id').get().id
  return getBarnById(id)
}

export function updateBarn(id, data) {
  const d = getDb()
  const allowed = ['name', 'initial_debt']
  const updates = []
  const params = []
  for (const k of allowed) {
    if (data[k] !== undefined) {
      updates.push(`${k} = ?`)
      params.push(data[k])
    }
  }
  if (updates.length === 0) return getBarnById(id)
  params.push(now(), id)
  d.prepare(`UPDATE barns SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...params)
  return getBarnById(id)
}

export function deleteBarn(id) {
  getDb().prepare('DELETE FROM barns WHERE id = ?').run(id)
}

/** Unpaid balance for one barn: initial_debt + invoices − payments (same shape as client balance). */
export function getBarnBalance(barnId) {
  const b = getBarnById(barnId)
  if (!b) return null
  const d = getDb()
  const invTotal = d.prepare(`SELECT COALESCE(SUM(total_amount),0) as s FROM invoices WHERE barn_id = ? AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')`).get(barnId)?.s ?? 0
  const paid =
    d
      .prepare(
        `SELECT COALESCE(SUM(${sqlPaymentAmountTowardArExpr('')}),0) as s FROM payments WHERE barn_id = ?`
      )
      .get(barnId)?.s ?? 0
  return (b.initial_debt ?? 0) + invTotal - paid
}

// ----- Warehouses -----
export function getWarehouses() {
  const rows = getDb().prepare('SELECT * FROM warehouses WHERE is_active = 1').all()
  return rows.map(r => ({ id: r.id, name_ar: r.name_ar, name_en: r.name_en, is_active: !!r.is_active }))
}

/**
 * product_id -> quantity for a given warehouse.
 * Primary source: product_warehouse_stock (same totals as syncWarehouseStockFromBatches / getProductStock).
 * Fallback: sum batches when no pws row exists (legacy drift).
 */
export function getWarehouseStockMap(warehouseId) {
  const d = getDb()
  const map = {}
  const pwsRows = d.prepare(`
    SELECT product_id, quantity
    FROM product_warehouse_stock
    WHERE warehouse_id = ?
  `).all(warehouseId)
  for (const r of pwsRows) {
    map[r.product_id] = r.quantity ?? 0
  }

  const batchFallback = d.prepare(`
    SELECT pb.product_id,
      COALESCE(SUM(CASE WHEN COALESCE(pb.unit_type, 'piece') = 'bulk' THEN pb.kg_remaining ELSE pb.quantity END), 0) AS q
    FROM product_batches pb
    LEFT JOIN product_warehouse_stock pws
      ON pws.product_id = pb.product_id AND pws.warehouse_id = pb.warehouse_id
    WHERE pb.warehouse_id = ? AND pws.product_id IS NULL
    GROUP BY pb.product_id
  `).all(warehouseId)
  for (const r of batchFallback) {
    const pid = r.product_id
    const q = r.q ?? 0
    if (map[pid] === undefined) map[pid] = q
  }
  return map
}

/** Products that have stock > 0 in the given warehouse (for backward compatibility). */
export function getProductsWithStockInWarehouse(warehouseId) {
  const d = getDb()
  const rows = d.prepare(`
    SELECT pws.product_id, pws.quantity, p.name, p.company, p.category, p.barcode, p.unit_type, p.bag_weight_kg, p.purchase_price, p.selling_price, p.alert_level, p.alert_level_kg, p.expiry_date, p.image_url, p.notes, p.created_at, p.updated_at
    FROM product_warehouse_stock pws
    JOIN products p ON p.id = pws.product_id
    WHERE pws.warehouse_id = ? AND pws.quantity > 0
  `).all(warehouseId)
  return rows.map(r => ({
    product: rowToProduct({
      id: r.product_id,
      name: r.name,
      company: r.company,
      category: r.category,
      barcode: r.barcode,
      unit_type: r.unit_type,
      bag_weight_kg: r.bag_weight_kg,
      purchase_price: r.purchase_price,
      selling_price: r.selling_price,
      alert_level: r.alert_level,
      alert_level_kg: r.alert_level_kg,
      expiry_date: r.expiry_date,
      image_url: r.image_url,
      notes: r.notes,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }),
    stock: r.quantity ?? 0,
  }))
}

/** All products with their stock in the given warehouse (stock 0 if none). For new invoice: load from full inventory. */
export function getProductsInWarehouse(warehouseId) {
  const d = getDb()
  const rows = d.prepare(`
    SELECT p.id AS product_id, COALESCE(pws.quantity, 0) AS quantity,
      p.name, p.company, p.category, p.barcode, p.purchase_price, p.selling_price, p.alert_level, p.expiry_date, p.image_url, p.notes, p.created_at, p.updated_at
    FROM products p
    LEFT JOIN product_warehouse_stock pws ON pws.product_id = p.id AND pws.warehouse_id = ?
    ORDER BY p.name
  `).all(warehouseId)
  return rows.map(r => ({
    product: rowToProduct({
      id: r.product_id,
      name: r.name,
      company: r.company,
      category: r.category,
      barcode: r.barcode,
      purchase_price: r.purchase_price,
      selling_price: r.selling_price,
      alert_level: r.alert_level,
      expiry_date: r.expiry_date,
      image_url: r.image_url,
      notes: r.notes,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }),
    stock: r.quantity ?? 0,
  }))
}

export function updateBatchPrice(batchId, sellingPrice) {
  const d = getDb()
  d.prepare('UPDATE product_batches SET selling_price = ?, updated_at = ? WHERE id = ?').run(sellingPrice, now(), batchId)
  return d.prepare('SELECT * FROM product_batches WHERE id = ?').get(batchId)
}

export function getBatchesByWarehouse(warehouseId) {
  return getDb().prepare(
    'SELECT * FROM product_batches WHERE warehouse_id = ? AND quantity > 0 ORDER BY product_id, expiry_date ASC'
  ).all(warehouseId)
}

// ----- Categories -----
/** Category names for filter dropdown: from categories table + distinct category on products. */
export function getCategoryOptions() {
  const d = getDb()
  const fromTable = d.prepare("SELECT DISTINCT name_ar FROM categories WHERE name_ar IS NOT NULL AND name_ar != ''").all().map(r => r.name_ar)
  const fromProducts = d.prepare("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''").all().map(r => r.category)
  const set = new Set([...fromTable, ...fromProducts])
  return [...set].sort((a, b) => (a || '').localeCompare(b || ''))
}

export function createCategory(name_ar) {
  const d = getDb()
  const n = (name_ar || '').trim() || 'فئة'
  d.prepare('INSERT INTO categories (name_ar) VALUES (?)').run(n)
  const id = d.prepare('SELECT last_insert_rowid() as id').get().id
  return { id, name_ar: n }
}

// ----- Products -----
export function getProductCount() {
  return getDb().prepare('SELECT COUNT(*) as n FROM products').get().n
}

/** Remove duplicate products (same name), keeping the one with smallest id. Returns number deleted. */
export function removeDuplicateProducts() {
  const d = getDb()
  const before = d.prepare('SELECT COUNT(*) as n FROM products').get().n
  const toDelete = d.prepare(`
    SELECT p.id FROM products p
    WHERE EXISTS (
      SELECT 1 FROM products p2 WHERE p2.name = p.name AND p2.id < p.id
    )
  `).all()
  const ids = toDelete.map((r) => r.id)
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    d.prepare(`DELETE FROM product_warehouse_stock WHERE product_id IN (${placeholders})`).run(...ids)
    d.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).run(...ids)
  }
  const after = d.prepare('SELECT COUNT(*) as n FROM products').get().n
  return before - after
}

export function getCategoryCount() {
  return getDb().prepare('SELECT COUNT(*) as n FROM categories').get().n
}

/** Returns all product names (for seed script to avoid duplicates). */
export function getAllProductNames() {
  return getDb().prepare('SELECT name FROM products').all().map((r) => r.name)
}

// ----- App Settings -----
export function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key)
  return row ? row.value : null
}

export function setSetting(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, String(value))
}

export function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM app_settings').all()
  const obj = {}
  for (const r of rows) obj[r.key] = r.value
  return obj
}

export function parseInvoiceEditWindowDays() {
  const raw = getSetting('invoice_edit_window_days')
  const v = parseInt(raw ?? '7', 10)
  if (!Number.isFinite(v) || v < 1) return 7
  return Math.min(365, v)
}

/** Age in fractional days since invoice creation vs configured window. */
export function getInvoiceEditWindowStatus(invoiceId) {
  const d = getDb()
  const windowDays = parseInvoiceEditWindowDays()
  const inv = d.prepare('SELECT created_at FROM invoices WHERE id = ?').get(invoiceId)
  if (!inv) return null
  const createdAt = new Date(inv.created_at).getTime()
  const ageDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24)
  return {
    windowDays,
    ageDays: Math.round(ageDays * 100) / 100,
    withinWindow: ageDays <= windowDays,
  }
}

/**
 * @param {number} invoiceId
 * @param {string} role
 * @throws {Error & { code?: string, edit_window_days?: number, invoice_age_days?: number }}
 */
export function assertInvoiceReplaceAllowed(invoiceId, role) {
  const st = getInvoiceEditWindowStatus(invoiceId)
  if (!st) {
    const e = new Error('الفاتورة غير موجودة')
    e.code = 'NOT_FOUND'
    throw e
  }
  if (st.withinWindow) return st
  if (role === 'super_admin') return st
  const e = new Error('انتهت مدة تعديل هذه الفاتورة')
  e.code = 'INVOICE_EDIT_WINDOW_EXPIRED'
  e.edit_window_days = st.windowDays
  e.invoice_age_days = st.ageDays
  throw e
}

export function recordInvoiceEditOverride(invoiceId, userId, reason) {
  const d = getDb()
  const uid = userId != null && Number.isFinite(Number(userId)) ? Number(userId) : null
  d.prepare(
    `UPDATE invoices SET last_edited_by = ?, last_edited_at = ?, edit_override_reason = ? WHERE id = ?`
  ).run(uid, now(), reason != null && String(reason).trim() !== '' ? String(reason) : null, invoiceId)
}

/**
 * Low stock: same rule as dashboard stats — alert_level > 0 and quantity at or below alert.
 * With warehouse_id: quantity in that warehouse; otherwise total across warehouses.
 */
/** Batches with remaining stock whose expiry is within the next 90 days (not expired). Optional warehouse scope. */
function sqlNearExpiryBatchExists(warehouseId = null) {
  const wh =
    warehouseId != null && Number.isInteger(warehouseId)
      ? 'AND pb.warehouse_id = ?'
      : ''
  return `
    EXISTS (
      SELECT 1 FROM product_batches pb
      WHERE pb.product_id = p.id
        AND pb.expiry_date IS NOT NULL
        AND pb.expiry_date != '9999-12-31'
        AND date(pb.expiry_date) >= date('now')
        AND date(pb.expiry_date) <= date('now', '+90 days')
        AND (
          (COALESCE(pb.unit_type, 'piece') = 'bulk' AND COALESCE(pb.kg_remaining, 0) > 0)
          OR (COALESCE(pb.unit_type, 'piece') != 'bulk' AND COALESCE(pb.quantity, 0) > 0)
        )
        ${wh}
    )
  `
}

function sqlExpiredBatchExists(warehouseId = null) {
  const wh =
    warehouseId != null && Number.isInteger(warehouseId)
      ? 'AND pb.warehouse_id = ?'
      : ''
  return `
    EXISTS (
      SELECT 1 FROM product_batches pb
      WHERE pb.product_id = p.id
        AND pb.expiry_date IS NOT NULL
        AND pb.expiry_date != '9999-12-31'
        AND date(pb.expiry_date) < date('now')
        AND (
          (COALESCE(pb.unit_type, 'piece') = 'bulk' AND COALESCE(pb.kg_remaining, 0) > 0)
          OR (COALESCE(pb.unit_type, 'piece') != 'bulk' AND COALESCE(pb.quantity, 0) > 0)
        )
        ${wh}
    )
  `
}

export function getProductCountFiltered(search, category, warehouseId = null, lowStock = false, unpriced = false, expiring = false, showArchived = false, expired = false) {
  const d = getDb()
  const params = []
  let sql
  const useAlias = lowStock || unpriced || expiring || expired
  if (lowStock) {
    if (warehouseId != null && Number.isInteger(warehouseId)) {
      sql = `
        SELECT COUNT(*) as n FROM products p
        INNER JOIN product_warehouse_stock pws ON p.id = pws.product_id AND pws.warehouse_id = ?
        WHERE (
          (COALESCE(p.unit_type, 'piece') != 'bulk' AND p.alert_level > 0 AND pws.quantity <= p.alert_level)
          OR (p.unit_type = 'bulk' AND COALESCE(p.alert_level_kg, 0) > 0 AND pws.quantity <= p.alert_level_kg)
        )`
      params.push(warehouseId)
    } else {
      sql = `
        SELECT COUNT(*) as n FROM products p
        LEFT JOIN (
          SELECT product_id, SUM(quantity) AS q FROM product_warehouse_stock GROUP BY product_id
        ) s ON s.product_id = p.id
        WHERE (
          (COALESCE(p.unit_type, 'piece') != 'bulk' AND p.alert_level > 0 AND COALESCE(s.q, 0) <= p.alert_level)
          OR (p.unit_type = 'bulk' AND COALESCE(p.alert_level_kg, 0) > 0 AND COALESCE(s.q, 0) <= p.alert_level_kg)
        )`
    }
  } else if (unpriced) {
    sql = 'SELECT COUNT(*) as n FROM products p WHERE (p.selling_price IS NULL OR p.selling_price <= 0)'
  } else if (expiring) {
    const batchExists = sqlNearExpiryBatchExists(warehouseId)
    sql = `SELECT COUNT(*) as n FROM products p WHERE (
      (p.expiry_date IS NOT NULL
        AND date(p.expiry_date) >= date('now')
        AND date(p.expiry_date) <= date('now', '+90 days'))
      OR ${batchExists}
    )`
    if (warehouseId != null && Number.isInteger(warehouseId)) params.push(warehouseId)
  } else if (expired) {
    const batchExists = sqlExpiredBatchExists(warehouseId)
    sql = `SELECT COUNT(*) as n FROM products p WHERE (
      (p.expiry_date IS NOT NULL
        AND date(p.expiry_date) < date('now'))
      OR ${batchExists}
    )`
    if (warehouseId != null && Number.isInteger(warehouseId)) params.push(warehouseId)
  } else {
    sql = 'SELECT COUNT(*) as n FROM products WHERE 1=1'
  }
  if (search) {
    sql += useAlias ? ' AND LOWER(p.name) LIKE ?' : ' AND LOWER(name) LIKE ?'
    params.push(`%${search.toLowerCase()}%`)
  }
  if (category) {
    sql += useAlias ? ' AND p.category = ?' : ' AND category = ?'
    params.push(category)
  }

  // Handle archived products if column exists
  if (!showArchived) {
    try {
      const cols = d.prepare('PRAGMA table_info(products)').all()
      if (cols.some(c => c.name === 'is_active')) {
        sql += useAlias ? ' AND p.is_active = 1' : ' AND is_active = 1'
      }
    } catch (_) {}
  }

  return d.prepare(sql).get(...params)?.n ?? 0
}

export function getProducts(search, category, limit = 100, offset = 0, warehouseId = null, lowStock = false, unpriced = false, expiring = false, showArchived = false, expired = false) {
  const d = getDb()
  const params = []
  let sql
  const batchAgg = `
    LEFT JOIN (
      SELECT product_id,
        MIN(purchase_price) AS purchase_price_min,
        MAX(purchase_price) AS purchase_price_max,
        MIN(CASE WHEN quantity > 0 AND selling_price > 0 THEN selling_price WHEN kg_remaining > 0 AND selling_price > 0 THEN selling_price END) AS selling_price_min,
        MAX(CASE WHEN quantity > 0 AND selling_price > 0 THEN selling_price WHEN kg_remaining > 0 AND selling_price > 0 THEN selling_price END) AS selling_price_max,
        COALESCE(SUM(CASE WHEN unit_type = 'bulk' THEN kg_remaining ELSE quantity END), 0) AS batch_total_quantity
      FROM product_batches
      GROUP BY product_id
    ) ba ON ba.product_id = p.id
    LEFT JOIN (
      SELECT bi.product_id,
        COUNT(*) AS bulk_bag_count,
        MAX(CASE WHEN bi.status = 'open' AND bi.kg_total > 0.001 AND (bi.kg_remaining * 1.0 / bi.kg_total) < 0.2 THEN 1 ELSE 0 END) AS bulk_open_bag_low
      FROM bag_instances bi
      WHERE bi.status != 'empty'
      GROUP BY bi.product_id
    ) bgi ON bgi.product_id = p.id`
  const useAlias = lowStock || unpriced || expiring || expired
  if (lowStock) {
    if (warehouseId != null && Number.isInteger(warehouseId)) {
      sql = `
        SELECT p.*, ba.purchase_price_min, ba.purchase_price_max, ba.selling_price_min, ba.selling_price_max, ba.batch_total_quantity,
          bgi.bulk_bag_count, bgi.bulk_open_bag_low
        FROM products p
        ${batchAgg}
        INNER JOIN product_warehouse_stock pws ON p.id = pws.product_id AND pws.warehouse_id = ?
        WHERE (
          (COALESCE(p.unit_type, 'piece') != 'bulk' AND p.alert_level > 0 AND pws.quantity <= p.alert_level)
          OR (p.unit_type = 'bulk' AND COALESCE(p.alert_level_kg, 0) > 0 AND pws.quantity <= p.alert_level_kg)
        )`
      params.push(warehouseId)
    } else {
      sql = `
        SELECT p.*, ba.purchase_price_min, ba.purchase_price_max, ba.selling_price_min, ba.selling_price_max, ba.batch_total_quantity,
          bgi.bulk_bag_count, bgi.bulk_open_bag_low
        FROM products p
        ${batchAgg}
        LEFT JOIN (
          SELECT product_id, SUM(quantity) AS q FROM product_warehouse_stock GROUP BY product_id
        ) s ON s.product_id = p.id
        WHERE (
          (COALESCE(p.unit_type, 'piece') != 'bulk' AND p.alert_level > 0 AND COALESCE(s.q, 0) <= p.alert_level)
          OR (p.unit_type = 'bulk' AND COALESCE(p.alert_level_kg, 0) > 0 AND COALESCE(s.q, 0) <= p.alert_level_kg)
        )`
    }
  } else if (unpriced) {
    sql = `SELECT p.*, ba.purchase_price_min, ba.purchase_price_max, ba.selling_price_min, ba.selling_price_max, ba.batch_total_quantity,
        bgi.bulk_bag_count, bgi.bulk_open_bag_low
      FROM products p
      ${batchAgg}
      WHERE (p.selling_price IS NULL OR p.selling_price <= 0)`
  } else if (expiring) {
    const batchExists = sqlNearExpiryBatchExists(warehouseId)
    sql = `SELECT p.*, ba.purchase_price_min, ba.purchase_price_max, ba.selling_price_min, ba.selling_price_max, ba.batch_total_quantity,
        bgi.bulk_bag_count, bgi.bulk_open_bag_low
      FROM products p
      ${batchAgg}
      WHERE (
        (p.expiry_date IS NOT NULL
          AND date(p.expiry_date) >= date('now')
          AND date(p.expiry_date) <= date('now', '+90 days'))
        OR ${batchExists}
      )`
    if (warehouseId != null && Number.isInteger(warehouseId)) params.push(warehouseId)
  } else if (expired) {
    const batchExists = sqlExpiredBatchExists(warehouseId)
    sql = `SELECT p.*, ba.purchase_price_min, ba.purchase_price_max, ba.selling_price_min, ba.selling_price_max, ba.batch_total_quantity,
        bgi.bulk_bag_count, bgi.bulk_open_bag_low
      FROM products p
      ${batchAgg}
      WHERE (
        (p.expiry_date IS NOT NULL
          AND date(p.expiry_date) < date('now'))
        OR ${batchExists}
      )`
    if (warehouseId != null && Number.isInteger(warehouseId)) params.push(warehouseId)
  } else {
    sql = `SELECT p.*, ba.purchase_price_min, ba.purchase_price_max, ba.selling_price_min, ba.selling_price_max, ba.batch_total_quantity,
        bgi.bulk_bag_count, bgi.bulk_open_bag_low
      FROM products p
      ${batchAgg}
      WHERE 1=1`
  }
  if (search) {
    sql += ' AND LOWER(p.name) LIKE ?'
    params.push(`%${search.toLowerCase()}%`)
  }
  if (category) {
    sql += ' AND p.category = ?'
    params.push(category)
  }

  // Handle archived products if column exists
  if (!showArchived) {
    try {
      const cols = d.prepare('PRAGMA table_info(products)').all()
      if (cols.some(c => c.name === 'is_active')) {
        sql += ' AND p.is_active = 1'
      }
    } catch (_) {}
  }

  sql += ' ORDER BY p.id DESC LIMIT ? OFFSET ?'
  params.push(Math.min(limit, 500), Math.max(0, offset))
  return d.prepare(sql).all(...params).map(rowToProduct)
}

export function getProductById(id) {
  return rowToProduct(getDb().prepare('SELECT * FROM products WHERE id = ?').get(id))
}

/** Manufacturer / packaging barcode only (`products.barcode`). POS uses B/G batch labels separately. */
export function getProductByBarcode(barcode) {
  const d = getDb()
  const raw = String(barcode ?? '').trim()
  const row = d.prepare('SELECT * FROM products WHERE barcode = ?').get(raw)
  if (row) return rowToProduct(row)
  return null
}

/**
 * Prefer `initial_batches`; map legacy `initial_bulk_stock` when present (bulk only).
 * @returns {{ batches: object[], legacyZeroWarehouses: number[] }}
 */
function buildInitialBatchesFromPayload(data) {
  const legacyZeroWarehouses = []
  if (Array.isArray(data.initial_batches) && data.initial_batches.length > 0) {
    return { batches: data.initial_batches, legacyZeroWarehouses }
  }
  if ((data.unit_type ?? 'piece') === 'bulk' && Array.isArray(data.initial_bulk_stock)) {
    const kpb = Number(data.bag_weight_kg)
    const pp = data.purchase_price != null ? Number(data.purchase_price) : 0
    const sp = data.selling_price != null ? Number(data.selling_price) : 0
    const rows = []
    for (const row of data.initial_bulk_stock) {
      const whId = Number(row.warehouse_id)
      if (!Number.isInteger(whId)) continue
      const bagCount = Math.max(0, Math.floor(Number(row.bag_count) || 0))
      if (bagCount === 0) {
        legacyZeroWarehouses.push(whId)
        continue
      }
      if (!Number.isFinite(kpb) || kpb <= 0) {
        throw new Error('حدد وزن الشكارة بالكيلو للمنتج بالوزن')
      }
      const hasOpen = !!row.has_open_bag
      let openKg = null
      if (hasOpen) {
        const raw = row.open_kg_remaining
        if (raw == null || raw === '') {
          openKg = kpb
        } else {
          openKg = Number(raw)
          if (!Number.isFinite(openKg) || openKg < 0) openKg = kpb
        }
        openKg = Math.min(kpb, Math.max(0, openKg))
      }
      rows.push({
        warehouse_id: whId,
        expiry_date: null,
        purchase_price: pp,
        selling_price: sp,
        bag_count: bagCount,
        kg_per_bag: kpb,
        has_open_bag: hasOpen,
        open_kg_remaining: hasOpen ? openKg : null,
      })
    }
    return { batches: rows, legacyZeroWarehouses }
  }
  return { batches: [], legacyZeroWarehouses }
}

/**
 * Opening stock from "إضافة منتج" / seed — runs inside caller transaction.
 * supplier_purchase_id stays null; source = initial_stock.
 */
function createInitialBatch(d, productId, unitType, productData, batch, t) {
  const whId = Number(batch.warehouse_id)
  if (!Number.isInteger(whId) || whId <= 0) throw new Error('المخزن مطلوب لكل دفعة')

  const pp = batch.purchase_price != null && batch.purchase_price !== '' ? Number(batch.purchase_price) : NaN
  const sp = batch.selling_price != null && batch.selling_price !== '' ? Number(batch.selling_price) : NaN
  if (!Number.isFinite(pp) || pp < 0) throw new Error('سعر الشراء مطلوب لكل دفعة')
  if (!Number.isFinite(sp) || sp < 0) throw new Error('سعر البيع مطلوب لكل دفعة')

  const expRaw = batch.expiry_date
  const expiryDate = expRaw == null || expRaw === '' ? null : String(expRaw)

  if (unitType === 'piece') {
    const qty = Math.floor(Number(batch.quantity))
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('أدخل كمية أكبر من صفر لكل دفعة (قطعة)')
    d.prepare(`
      INSERT INTO product_batches
      (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'piece', 'initial_stock', ?, ?)
    `).run(productId, whId, expiryDate, qty, pp, sp, t, t)
    return
  }

  if (unitType === 'bulk') {
    const bagCount = Math.max(0, Math.floor(Number(batch.bag_count) || 0))
    const kgPerBag =
      batch.kg_per_bag != null && batch.kg_per_bag !== ''
        ? Number(batch.kg_per_bag)
        : Number(productData.bag_weight_kg)
    if (!Number.isFinite(kgPerBag) || kgPerBag <= 0) throw new Error('وزن الشكارة غير صالح في دفعة بالكيلو')
    if (bagCount <= 0) throw new Error('أدخل عدد شكاير أكبر من صفر لكل دفعة بالكيلو')

    const hasOpen = !!batch.has_open_bag
    let openKg = null
    if (hasOpen) {
      const raw = batch.open_kg_remaining
      if (raw == null || raw === '') {
        openKg = kgPerBag
      } else {
        openKg = Number(raw)
      }
      if (!Number.isFinite(openKg) || openKg <= 0) throw new Error('الكيلو المتبقي في الشكارة المفتوحة غير صالح')
      if (openKg > kgPerBag + 0.0001) throw new Error('الكيلو المتبقي يتجاوز وزن الشكارة')
    }

    const totalKg = hasOpen
      ? (bagCount - 1) * kgPerBag + (openKg ?? kgPerBag)
      : bagCount * kgPerBag

    d.prepare(`
      INSERT INTO product_batches
      (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type,
       bag_count, kg_per_bag, kg_remaining, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'bulk', ?, ?, ?, 'initial_stock', ?, ?)
    `).run(productId, whId, expiryDate, bagCount, pp, sp, bagCount, kgPerBag, totalKg, t, t)
    const batchId = d.prepare('SELECT last_insert_rowid() as id').get().id

    const expCol =
      expiryDate == null || expiryDate === '9999-12-31' ? null : expiryDate
    const insertBag = d.prepare(`
      INSERT INTO bag_instances
      (batch_id, product_id, warehouse_id, bag_number, kg_total, kg_remaining, status, expiry_date, opened_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (let i = 1; i <= bagCount; i++) {
      const isOpenBag = hasOpen && i === 1
      const kgRem = isOpenBag ? (openKg ?? kgPerBag) : kgPerBag
      insertBag.run(
        batchId,
        productId,
        whId,
        i,
        kgPerBag,
        kgRem,
        isOpenBag ? 'open' : 'sealed',
        expCol,
        isOpenBag ? t : null,
        t
      )
    }
    return
  }

  throw new Error('نوع وحدة غير معروف')
}

export function createProduct(data) {
  const d = getDb()
  const run = d.transaction(() => {
    const t = now()
    const barcode = data.barcode ?? `PRD-${Date.now()}`
    const imageUrl =
      data.image_url != null && String(data.image_url).trim() !== '' ? String(data.image_url) : null
    if (imageUrl) assertProductImageUrlField(imageUrl)
    const unitTypeIns = data.unit_type ?? 'piece'
    const defaultAlertLevel = unitTypeIns === 'bulk' ? 0 : 5
    d.prepare(`
    INSERT INTO products (name, company, category, barcode, unit_type, bag_weight_kg, purchase_price, selling_price, alert_level, alert_level_kg, expiry_date, image_url, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(
      data.name || '',
      data.company ?? null,
      data.category ?? null,
      barcode,
      unitTypeIns,
      data.bag_weight_kg ?? null,
      data.purchase_price ?? 0,
      data.selling_price ?? 0,
      data.alert_level ?? defaultAlertLevel,
      data.alert_level_kg != null && data.alert_level_kg !== '' ? Number(data.alert_level_kg) : null,
      imageUrl,
      data.notes ?? null,
      t,
      t
    )
    const id = d.prepare('SELECT last_insert_rowid() as id').get().id
    const unitType = unitTypeIns
    const { batches, legacyZeroWarehouses } = buildInitialBatchesFromPayload(data)

    const whSynced = new Set()
    if (batches.length > 0) {
      for (const batch of batches) {
        createInitialBatch(d, id, unitType, data, batch, t)
        whSynced.add(Number(batch.warehouse_id))
      }
      for (const wh of whSynced) {
        syncWarehouseStockFromBatches(id, wh)
      }
    }

    for (const whId of legacyZeroWarehouses) {
      d.prepare(`
        INSERT OR REPLACE INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
        VALUES (?, ?, 0, ?)
      `).run(id, whId, t)
    }

    if (data.warehouse_id && unitType !== 'bulk' && batches.length === 0) {
      d.prepare(`
      INSERT OR REPLACE INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
      VALUES (?, ?, 0, ?)
    `).run(id, data.warehouse_id, t)
    }
    return getProductById(id)
  })
  return run()
}

/**
 * Seed opening stock for an existing product that has no batches yet (e.g. Edit product flow).
 * Body: { initial_batches?: [...] } and/or legacy { initial_bulk_stock?: [...] }.
 */
export function seedInitialBulkStockForProductWithoutBatches(productId, body) {
  const d = getDb()
  const run = d.transaction(() => {
    const t = now()
    const p = d.prepare('SELECT * FROM products WHERE id = ?').get(productId)
    if (!p) throw new Error('المنتج غير موجود')
    const existing = d.prepare('SELECT COUNT(*) AS c FROM product_batches WHERE product_id = ?').get(productId).c
    if (existing > 0) throw new Error('يوجد مخزون دفعات بالفعل — لا يمكن إدخال مخزون أولي من هنا')

    const payloadForNorm = {
      unit_type: p.unit_type,
      bag_weight_kg: p.bag_weight_kg,
      purchase_price: p.purchase_price,
      selling_price: p.selling_price,
      initial_batches: body?.initial_batches,
      initial_bulk_stock: body?.initial_bulk_stock,
    }
    const { batches, legacyZeroWarehouses } = buildInitialBatchesFromPayload(payloadForNorm)

    if (batches.length === 0 && legacyZeroWarehouses.length === 0) {
      throw new Error('بيانات المخزون الأولي غير صالحة')
    }

    const unitType = p.unit_type ?? 'piece'
    if (batches.length > 0 && unitType === 'bulk') {
      const kpb = Number(p.bag_weight_kg)
      if (!Number.isFinite(kpb) || kpb <= 0) throw new Error('حدد وزن الشكارة بالكيلو أولاً')
    }

    const whSynced = new Set()
    if (batches.length > 0) {
      for (const batch of batches) {
        createInitialBatch(d, productId, unitType, p, batch, t)
        whSynced.add(Number(batch.warehouse_id))
      }
      for (const wh of whSynced) {
        syncWarehouseStockFromBatches(productId, wh)
      }
    }
    for (const whId of legacyZeroWarehouses) {
      d.prepare(`
        INSERT OR REPLACE INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
        VALUES (?, ?, 0, ?)
      `).run(productId, whId, t)
    }

    return getProductById(productId)
  })
  return run()
}

/** Coerce product money fields from PATCH JSON to safe non‑negative numbers. */
function coerceProductPrice(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export function updateProduct(id, data) {
  const d = getDb()
  const allowed = ['name', 'company', 'category', 'barcode', 'unit_type', 'bag_weight_kg', 'purchase_price', 'selling_price', 'alert_level', 'alert_level_kg', 'expiry_date', 'notes', 'image_url']
  const updates = []
  const params = []
  for (const k of allowed) {
    if (data[k] !== undefined) {
      if (k === 'image_url' && data[k] != null && data[k] !== '') {
        assertProductImageUrlField(String(data[k]))
      }
      let v = data[k]
      if (k === 'purchase_price' || k === 'selling_price') v = coerceProductPrice(v)
      updates.push(`${k} = ?`)
      params.push(v)
    }
  }
  if (updates.length === 0) return getProductById(id)
  params.push(now(), id)
  d.prepare(`UPDATE products SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...params)
  return getProductById(id)
}

export function deleteProduct(id) {
  const d = getDb()
  const batchIds = d.prepare('SELECT id FROM product_batches WHERE product_id = ?').all(id).map(r => r.id)
  if (batchIds.length) {
    const placeholders = batchIds.map(() => '?').join(',')
    d.prepare(`DELETE FROM invoice_item_batches WHERE batch_id IN (${placeholders})`).run(...batchIds)
  }
  d.prepare('DELETE FROM product_batches WHERE product_id = ?').run(id)
  d.prepare('DELETE FROM product_warehouse_stock WHERE product_id = ?').run(id)
  d.prepare('DELETE FROM products WHERE id = ?').run(id)
}

export function getProductStock(productId) {
  const d = getDb()
  const warehouses = d.prepare('SELECT id FROM warehouses WHERE is_active = 1').all()
  const rows = d.prepare(`
    SELECT product_id, warehouse_id, quantity, updated_at
    FROM product_warehouse_stock WHERE product_id = ?
  `).all(productId)
  const byWh = Object.fromEntries(rows.map(r => [r.warehouse_id, r]))
  const t = now()
  return warehouses.map(w => {
    const r = byWh[w.id]
    return {
      product_id: Number(productId),
      warehouse_id: w.id,
      quantity: r ? (r.quantity ?? 0) : 0,
      updated_at: r ? r.updated_at : t,
    }
  })
}

export function upsertProductStock(productId, warehouseId, quantityDelta) {
  const d = getDb()
  const t = now()
  const row = d.prepare('SELECT quantity FROM product_warehouse_stock WHERE product_id = ? AND warehouse_id = ?').get(productId, warehouseId)
  const current = row ? row.quantity : 0
  const newQty = Math.max(0, current + quantityDelta)
  d.prepare(`
    INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
  `).run(productId, warehouseId, newQty, t)
}

// ----- Product Batches (expiry tracking) -----

export function upsertBatch(productId, warehouseId, expiryDate, qtyDelta, prices = {}, bulkDetails = null) {
  const d = getDb()
  const t = now()
  const pp = prices.purchase_price ?? null
  const row = pp != null
    ? d.prepare(
        'SELECT id, quantity, kg_remaining FROM product_batches WHERE product_id = ? AND warehouse_id = ? AND purchase_price = ? AND expiry_date = ? ORDER BY id LIMIT 1'
      ).get(productId, warehouseId, pp, expiryDate)
    : d.prepare(
        'SELECT id, quantity, kg_remaining FROM product_batches WHERE product_id = ? AND warehouse_id = ? AND purchase_price IS NULL AND expiry_date = ? ORDER BY id LIMIT 1'
      ).get(productId, warehouseId, expiryDate)

  let finalQtyDelta = qtyDelta
  let finalBatchId = row?.id

  if (row) {
    const newQty = Math.max(0, (row.quantity ?? 0) + qtyDelta)
    const sets = ['quantity = ?', 'updated_at = ?']
    const params = [newQty, t]

    if (bulkDetails && bulkDetails.unit_type === 'bulk') {
      const bcAdded = bulkDetails.bag_count || 0
      const kilos = bcAdded * (bulkDetails.kg_per_bag || 0)
      sets.push('bag_count = bag_count + ?', 'kg_remaining = kg_remaining + ?')
      params.push(bcAdded, kilos)
      finalQtyDelta = kilos // for stock upsert tracking if needed, but we track batches now
    }

    if (pp != null) { sets.push('purchase_price = ?'); params.push(pp) }
    if (prices.selling_price != null) { sets.push('selling_price = ?'); params.push(prices.selling_price) }
    params.push(row.id)
    d.prepare(`UPDATE product_batches SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  } else {
    const qty = Math.max(0, qtyDelta)
    const sp = prices.selling_price ?? null
    let ut = 'piece', bc = null, kpb = null, kr = null
    if (bulkDetails && bulkDetails.unit_type === 'bulk') {
      ut = 'bulk'
      bc = bulkDetails.bag_count || 0
      kpb = bulkDetails.kg_per_bag || 0
      kr = bc * kpb
      finalQtyDelta = kr
    }
    const info = d.prepare(
      'INSERT INTO product_batches (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type, bag_count, kg_per_bag, kg_remaining, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(productId, warehouseId, expiryDate, qty, pp, sp, ut, bc, kpb, kr, t, t)
    finalBatchId = info.lastInsertRowid
  }

  // Create bag instances if bulk
  if (bulkDetails && bulkDetails.unit_type === 'bulk' && bulkDetails.bag_count > 0) {
    const kpb = bulkDetails.kg_per_bag || 0
    let existingCount = d.prepare('SELECT COUNT(*) as c FROM bag_instances WHERE batch_id = ?').get(finalBatchId).c
    const insertBag = d.prepare(`
      INSERT INTO bag_instances (batch_id, product_id, warehouse_id, bag_number, kg_total, kg_remaining, status, expiry_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'sealed', ?, ?)
    `)
    // Within this batch receiving event, insert each bag
    for (let i = 0; i < bulkDetails.bag_count; i++) {
        insertBag.run(finalBatchId, productId, warehouseId, existingCount + 1 + i, kpb, kpb, expiryDate, t)
    }
    // Auto-open if no bags are currently open for this (product, warehouse)
    const openBag = d.prepare("SELECT id FROM bag_instances WHERE product_id = ? AND warehouse_id = ? AND status = 'open' LIMIT 1").get(productId, warehouseId)
    if (!openBag) {
      d.prepare(`
        UPDATE bag_instances SET status = 'open', opened_at = ? 
        WHERE id = (
          SELECT id FROM bag_instances 
          WHERE product_id = ? AND warehouse_id = ? AND status = 'sealed' 
          ORDER BY expiry_date ASC NULLS LAST LIMIT 1
        )
      `).run(t, productId, warehouseId)
    }
  }

  upsertProductStock(productId, warehouseId, finalQtyDelta)
}


export function getBagsForProduct(productId, warehouseId = null) {
  const d = getDb();
  if (warehouseId) {
    return d.prepare(
      `SELECT b.*, pb.purchase_price, pb.selling_price 
       FROM bag_instances b
       LEFT JOIN product_batches pb ON pb.id = b.batch_id
       WHERE b.product_id = ? AND b.warehouse_id = ?
       ORDER BY CASE WHEN b.status = 'open' THEN 1 WHEN b.status = 'sealed' THEN 2 ELSE 3 END, b.expiry_date ASC NULLS LAST, b.id ASC`
    ).all(productId, warehouseId);
  }
  return d.prepare(
    `SELECT b.*, pb.purchase_price, pb.selling_price, w.name_ar AS warehouse_name_ar
     FROM bag_instances b
     LEFT JOIN product_batches pb ON pb.id = b.batch_id
     LEFT JOIN warehouses w ON w.id = b.warehouse_id
     WHERE b.product_id = ?
     ORDER BY CASE WHEN b.status = 'open' THEN 1 WHEN b.status = 'sealed' THEN 2 ELSE 3 END, b.expiry_date ASC NULLS LAST, b.id ASC`
  ).all(productId);
}

export function getBagInstanceById(bagId) {
  const d = getDb()
  return d
    .prepare(
      `SELECT b.*, pb.purchase_price, pb.selling_price, w.name_ar AS warehouse_name_ar
       FROM bag_instances b
       LEFT JOIN product_batches pb ON pb.id = b.batch_id
       LEFT JOIN warehouses w ON w.id = b.warehouse_id
       WHERE b.id = ?`
    )
    .get(bagId)
}

const soldStatsJoin = `
  LEFT JOIN (SELECT batch_id, SUM(quantity) AS sold_units FROM invoice_item_batches GROUP BY batch_id) pis ON pis.batch_id = pb.id
  LEFT JOIN (
    SELECT b.batch_id, SUM(iib.amount_kg) AS sold_kg
    FROM invoice_item_bags iib
    INNER JOIN bag_instances b ON b.id = iib.bag_id
    GROUP BY b.batch_id
  ) bks ON bks.batch_id = pb.id
`

const soldStatsSelect = `, COALESCE(pis.sold_units, 0) AS sold_units, COALESCE(bks.sold_kg, 0) AS sold_kg`

/**
 * @param {object} [opts]
 * @param {boolean} [opts.includeEmpty] — list zero-qty batches (product edit UI)
 */
export function getBatchesForProduct(productId, warehouseId, opts = {}) {
  const d = getDb()
  const includeEmpty = opts.includeEmpty === true
  const activeCond = includeEmpty
    ? '1=1'
    : `((COALESCE(pb.unit_type, 'piece') != 'bulk' AND pb.quantity > 0) OR (pb.unit_type = 'bulk' AND COALESCE(pb.kg_remaining, 0) > 0))`
  if (warehouseId) {
    return d
      .prepare(
        `SELECT pb.*, w.name_ar AS warehouse_name_ar ${soldStatsSelect}
       FROM product_batches pb
       LEFT JOIN warehouses w ON w.id = pb.warehouse_id
       ${soldStatsJoin}
       WHERE pb.product_id = ? AND pb.warehouse_id = ? AND (${activeCond})
       ORDER BY pb.expiry_date ASC`
      )
      .all(productId, warehouseId)
  }
  return d
    .prepare(
      `SELECT pb.*, w.name_ar AS warehouse_name_ar ${soldStatsSelect}
     FROM product_batches pb
     LEFT JOIN warehouses w ON w.id = pb.warehouse_id
     ${soldStatsJoin}
     WHERE pb.product_id = ? AND (${activeCond})
     ORDER BY pb.expiry_date ASC`
    )
    .all(productId)
}

export function batchHasInvoiceReferences(batchId) {
  const d = getDb()
  if (d.prepare('SELECT 1 FROM invoice_item_batches WHERE batch_id = ? LIMIT 1').get(batchId)) return true
  if (
    d
      .prepare(
        `SELECT 1 FROM invoice_item_bags iib
         INNER JOIN bag_instances b ON b.id = iib.bag_id
         WHERE b.batch_id = ? LIMIT 1`
      )
      .get(batchId)
  )
    return true
  if (d.prepare('SELECT 1 FROM invoice_items WHERE batch_id = ? LIMIT 1').get(batchId)) return true
  return false
}

export function deleteProductBatch(batchId, role) {
  const d = getDb()
  const b = getBatchById(batchId)
  if (!b) return { ok: false, error: 'الدفعة غير موجودة' }
  if (batchHasInvoiceReferences(batchId)) {
    return { ok: false, error: 'لا يمكن حذف الدفعة — مرتبطة بمبيعات مسجّلة' }
  }
  const isBulk = b.unit_type === 'bulk'
  const hasStock = isBulk ? (b.kg_remaining ?? 0) > 0.0001 : (b.quantity ?? 0) > 0
  if (role !== 'super_admin' && hasStock) {
    return { ok: false, error: 'لا يمكن حذف الدفعة — المخزون غير صفر (يتطلب صلاحية مدير أعلى لحذف مخزون متبقي)' }
  }
  d.prepare('DELETE FROM product_batches WHERE id = ?').run(batchId)
  syncWarehouseStockFromBatches(b.product_id, b.warehouse_id)
  return { ok: true }
}

export function updateProductBatch(batchId, body) {
  const d = getDb()
  const b = getBatchById(batchId)
  if (!b) return null
  const t = now()
  const sets = []
  const params = []
  if (body.quantity !== undefined && b.unit_type !== 'bulk') {
    const n = Number(body.quantity)
    if (!Number.isFinite(n) || n < 0) throw new Error('كمية غير صالحة')
    sets.push('quantity = ?')
    params.push(n)
  }
  if (body.kg_remaining !== undefined && b.unit_type === 'bulk') {
    const n = Number(body.kg_remaining)
    if (!Number.isFinite(n) || n < 0) throw new Error('الكيلوهات غير صالحة')
    sets.push('kg_remaining = ?')
    params.push(n)
  }
  if (body.purchase_price !== undefined) {
    sets.push('purchase_price = ?')
    params.push(body.purchase_price == null ? null : Number(body.purchase_price))
  }
  if (body.selling_price !== undefined) {
    sets.push('selling_price = ?')
    params.push(body.selling_price == null ? null : Number(body.selling_price))
  }
  if (body.expiry_date !== undefined) {
    const exp = body.expiry_date === '' || body.expiry_date == null ? '9999-12-31' : String(body.expiry_date)
    sets.push('expiry_date = ?')
    params.push(exp)
  }
  if (sets.length === 0) return b
  sets.push('updated_at = ?')
  params.push(t, batchId)
  try {
    d.prepare(`UPDATE product_batches SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  } catch (e) {
    const msg = e && e.message ? String(e.message) : ''
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      throw new Error('تعارض مع دفعة أخرى (نفس المخزن، الصلاحية، وسعر الشراء)')
    }
    throw e
  }
  const row = getBatchById(batchId)
  syncWarehouseStockFromBatches(row.product_id, row.warehouse_id)
  return row
}

export function createManualProductBatch(productId, body) {
  const p = getProductById(productId)
  if (!p) throw new Error('المنتج غير موجود')
  const d = getDb()
  const t = now()
  const wh = Number(body.warehouse_id)
  if (!Number.isInteger(wh)) throw new Error('المخزن مطلوب')
  const exp = body.expiry_date === '' || body.expiry_date == null ? '9999-12-31' : String(body.expiry_date)
  const pp = body.purchase_price != null && body.purchase_price !== '' ? Number(body.purchase_price) : null
  const sp = body.selling_price != null && body.selling_price !== '' ? Number(body.selling_price) : null
  if (p.unit_type === 'bulk') {
    const kgPerBag = Math.max(0, Number(body.kg_per_bag || p.bag_weight_kg || 0))
    const bagCount = Math.max(1, Math.floor(Number(body.bag_count || 1)))
    let totalKg =
      body.kg_remaining != null && body.kg_remaining !== ''
        ? Number(body.kg_remaining)
        : bagCount * kgPerBag
    if (!Number.isFinite(totalKg) || totalKg < 0) throw new Error('وزن غير صالح')
    d.prepare(
      `INSERT INTO product_batches (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type, bag_count, kg_per_bag, kg_remaining, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'bulk', ?, ?, ?, 'manual_adjustment', ?, ?)`
    ).run(productId, wh, exp, bagCount, pp, sp, bagCount, kgPerBag, totalKg, t, t)
    const batchId = d.prepare('SELECT last_insert_rowid() as id').get().id
    let remaining = totalKg
    for (let i = 0; i < bagCount; i++) {
      const isLast = i === bagCount - 1
      const kg = isLast ? remaining : Math.min(kgPerBag, remaining)
      remaining -= kg
      d.prepare(
        `INSERT INTO bag_instances (batch_id, product_id, warehouse_id, bag_number, kg_total, kg_remaining, status, expiry_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'sealed', ?, ?)`
      ).run(
        batchId,
        productId,
        wh,
        i + 1,
        kg,
        kg,
        exp === '9999-12-31' ? null : exp,
        t
      )
    }
    syncWarehouseStockFromBatches(productId, wh)
    return getBatchById(batchId)
  }
  const qty = Math.max(0, Number(body.quantity ?? 0))
  d.prepare(
    `INSERT INTO product_batches (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type, bag_count, kg_per_bag, kg_remaining, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'piece', NULL, NULL, NULL, 'manual_adjustment', ?, ?)`
  ).run(productId, wh, exp, qty, pp, sp, t, t)
  const batchId = d.prepare('SELECT last_insert_rowid() as id').get().id
  syncWarehouseStockFromBatches(productId, wh)
  return getBatchById(batchId)
}

/**
 * Allocate `totalQty` across batches in FEFO order. Returns array of { batch_id, quantity }.
 * Throws if total available < totalQty.
 */
export function allocateBatchesFEFO(productId, warehouseId, totalQty) {
  const batches = getBatchesForProduct(productId, warehouseId)
  const totalAvail = batches.reduce((s, b) => s + (b.quantity ?? 0), 0)
  if (totalAvail < totalQty) {
    throw new Error(`الكمية المتاحة في الدُفعات غير كافية للمنتج (مطلوب: ${totalQty}، متاح: ${totalAvail})`)
  }
  const allocations = []
  let remaining = totalQty
  for (const b of batches) {
    if (remaining <= 0) break
    const take = Math.min(remaining, b.quantity ?? 0)
    if (take > 0) {
      allocations.push({ batch_id: b.id, quantity: take })
      remaining -= take
    }
  }
  return allocations
}

/**
 * Allocate `totalKilos` across bags in FEFO order. Returns array of { bag_id, batch_id, amount_kg, becomes_empty }.
 */
export function allocateBagsFEFO(productId, warehouseId, totalKilos) {
  const d = getDb()
  const allocations = []
  let remaining = totalKilos

  // Find all bags that could be used. Order: open first, then sealed by expiry_date ASC
  const bags = d.prepare(`
    SELECT id, batch_id, kg_remaining, status 
    FROM bag_instances 
    WHERE product_id = ? AND warehouse_id = ? AND status IN ('open', 'sealed') AND kg_remaining > 0
    ORDER BY
      CASE WHEN status = 'open' THEN 1 ELSE 2 END,
      expiry_date ASC NULLS LAST,
      id ASC
  `).all(productId, warehouseId)

  const totalAvail = bags.reduce((s, b) => s + b.kg_remaining, 0)
  if (totalAvail < totalKilos) {
    throw new Error(`الوزن المتاح غير كافٍ للمنتج (مطلوب: ${totalKilos} كيلو، متاح: ${totalAvail} كيلو)`)
  }

  for (const b of bags) {
    if (remaining <= 0) break
    const take = Math.min(remaining, b.kg_remaining)
    if (take > 0) {
      allocations.push({
         bag_id: b.id, 
         batch_id: b.batch_id, 
         amount_kg: take,
         becomes_empty: (take >= b.kg_remaining - 0.0001)
      })
      remaining -= take
    }
  }
  return allocations
}

/**
 * Take kilos from one bag only (barcode scan `G{id}`). Returns same shape as allocateBagsFEFO entries.
 */
export function allocateKilosFromSpecificBag(bagId, productId, warehouseId, totalKilos) {
  const d = getDb()
  const bag = d
    .prepare(
      `SELECT id, batch_id, kg_remaining, status FROM bag_instances WHERE id = ? AND product_id = ? AND warehouse_id = ?`
    )
    .get(bagId, productId, warehouseId)
  if (!bag) {
    throw new Error('الشكارة غير موجودة أو لا تطابق المخزن')
  }
  if (!['open', 'sealed'].includes(bag.status)) {
    throw new Error('هذه الشكارة غير متاحة للبيع')
  }
  const avail = bag.kg_remaining ?? 0
  if (avail <= 0) {
    throw new Error('لا يوجد وزن متبقٍ في هذه الشكارة')
  }
  if (totalKilos > avail + 0.001) {
    throw new Error(`الكمية تتجاوز المتبقي في الشكارة (متاح: ${avail} كجم)`)
  }
  const take = totalKilos
  return [
    {
      bag_id: bag.id,
      batch_id: bag.batch_id,
      amount_kg: take,
      becomes_empty: take >= avail - 0.0001,
    },
  ]
}

/** Recalculate product_warehouse_stock.quantity from SUM of batch quantities. */
export function syncWarehouseStockFromBatches(productId, warehouseId) {
  const d = getDb()
  const t = now()
  const row = d.prepare(
    "SELECT COALESCE(SUM(CASE WHEN COALESCE(unit_type, 'piece') = 'bulk' THEN kg_remaining ELSE quantity END), 0) AS total FROM product_batches WHERE product_id = ? AND warehouse_id = ?"
  ).get(productId, warehouseId)
  const total = row?.total ?? 0
  d.prepare(`
    INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
  `).run(productId, warehouseId, total, t)
}

export function getBatchById(batchId) {
  return getDb().prepare('SELECT * FROM product_batches WHERE id = ?').get(batchId)
}

// ----- Suppliers -----
export function getSuppliers(search, limit = 50) {
  const d = getDb()
  let sql = 'SELECT * FROM suppliers WHERE 1=1'
  const params = []
  if (search) {
    sql += ' AND LOWER(name) LIKE ?'
    params.push(`%${search.toLowerCase()}%`)
  }
  sql += ' ORDER BY id DESC LIMIT ?'
  params.push(Math.min(limit, 200))
  return d.prepare(sql).all(...params).map(r => {
    const s = rowToSupplier(r)
    s.balance = getSupplierBalance(r.id)
    return s
  })
}

export function getSupplierById(id) {
  return rowToSupplier(getDb().prepare('SELECT * FROM suppliers WHERE id = ?').get(id))
}

export function createSupplier(data) {
  const d = getDb()
  const t = now()
  d.prepare(`
    INSERT INTO suppliers (name, phone, email, address, notes, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    data.name || '',
    data.phone ?? null,
    data.email ?? null,
    data.address ?? null,
    data.notes ?? null,
    t,
    t
  )
  const id = d.prepare('SELECT last_insert_rowid() as id').get().id
  return getSupplierById(id)
}

export function updateSupplier(id, data) {
  const d = getDb()
  const allowed = ['name', 'phone', 'email', 'address', 'notes', 'is_active']
  const updates = []
  const params = []
  for (const k of allowed) {
    if (data[k] !== undefined) {
      updates.push(`${k} = ?`)
      params.push(data[k])
    }
  }
  if (updates.length === 0) return getSupplierById(id)
  params.push(now(), id)
  d.prepare(`UPDATE suppliers SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...params)
  return getSupplierById(id)
}

export function deleteSupplier(id) {
  getDb().prepare('DELETE FROM supplier_purchase_items WHERE supplier_purchase_id IN (SELECT id FROM supplier_purchases WHERE supplier_id = ?)').run(id)
  getDb().prepare('DELETE FROM supplier_purchases WHERE supplier_id = ?').run(id)
  getDb().prepare('DELETE FROM supplier_payments WHERE supplier_id = ?').run(id)
  getDb().prepare('DELETE FROM suppliers WHERE id = ?').run(id)
}

export function getSupplierBalance(supplierId) {
  const d = getDb()
  const purchases = d.prepare('SELECT COALESCE(SUM(total_amount),0) as s FROM supplier_purchases WHERE supplier_id = ?').get(supplierId)?.s ?? 0
  const payments = d.prepare('SELECT COALESCE(SUM(amount),0) as s FROM supplier_payments WHERE supplier_id = ?').get(supplierId)?.s ?? 0
  return Math.max(0, purchases - payments)
}

export function getSupplierPurchases(supplierId, limit = 10) {
  const rows = getDb().prepare('SELECT * FROM supplier_purchases WHERE supplier_id = ? ORDER BY id DESC LIMIT ?').all(supplierId, limit)
  return rows.map(r => ({
    id: r.id,
    supplier_id: r.supplier_id,
    warehouse_id: r.warehouse_id,
    total_amount: r.total_amount ?? 0,
    notes: r.notes,
    created_at: r.created_at,
    created_by: r.created_by,
  }))
}

export function getSupplierPurchasesWithItems(supplierId, limit = 10) {
  const d = getDb()
  const purchases = d.prepare('SELECT * FROM supplier_purchases WHERE supplier_id = ? ORDER BY id DESC LIMIT ?').all(supplierId, limit)
  return purchases.map(p => {
    const items = d.prepare(`
      SELECT spi.*, pr.name as product_name
      FROM supplier_purchase_items spi
      LEFT JOIN products pr ON pr.id = spi.product_id
      WHERE spi.supplier_purchase_id = ?
    `).all(p.id)
    return {
      id: p.id,
      supplier_id: p.supplier_id,
      warehouse_id: p.warehouse_id,
      total_amount: p.total_amount ?? 0,
      notes: p.notes,
      created_at: p.created_at,
      created_by: p.created_by,
      items: items.map(i => ({
        id: i.id,
        supplier_purchase_id: i.supplier_purchase_id,
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total_price: i.total_price,
        product_name: i.product_name || '',
      })),
    }
  })
}

export function getSupplierPayments(supplierId, limit = 10) {
  const rows = getDb().prepare('SELECT * FROM supplier_payments WHERE supplier_id = ? ORDER BY id DESC LIMIT ?').all(supplierId, limit)
  return rows.map(r => ({
    id: r.id,
    supplier_id: r.supplier_id,
    amount: r.amount,
    payment_method: r.payment_method,
    notes: r.notes,
    payment_date: r.payment_date,
    created_at: r.created_at,
    created_by: r.created_by,
  }))
}

// ----- Supplier purchases -----
export function createSupplierPurchase(data) {
  const d = getDb()
  const t = now()
  const total = (data.items || []).reduce((a, i) => a + (i.total_price ?? i.quantity * i.unit_price ?? 0), 0)
  d.prepare(`
    INSERT INTO supplier_purchases (supplier_id, warehouse_id, total_amount, notes, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(data.supplier_id, data.warehouse_id ?? 1, data.total_amount ?? total, data.notes ?? null, t)
  const id = d.prepare('SELECT last_insert_rowid() as id').get().id
  for (const it of data.items || []) {
    const tp = it.total_price ?? (it.quantity || 0) * (it.unit_price || 0)
    d.prepare(`
      INSERT INTO supplier_purchase_items (supplier_purchase_id, product_id, quantity, unit_price, total_price, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, it.product_id, it.quantity ?? 0, it.unit_price ?? 0, tp, t)
  }
  return d.prepare('SELECT * FROM supplier_purchases WHERE id = ?').get(id)
}

export function getSupplierPurchaseById(id) {
  const d = getDb()
  const p = d.prepare('SELECT * FROM supplier_purchases WHERE id = ?').get(id)
  if (!p) return null
  const items = d.prepare('SELECT * FROM supplier_purchase_items WHERE supplier_purchase_id = ?').all(id)
  return { ...p, items }
}

// ----- Supplier receipts (receipt with stock update) -----
export function createSupplierReceipt(data) {
  const d = getDb()
  const t = now()
  const items = data.items || []
  const total_amount = items.reduce((a, i) => {
    const q = i.quantity || 0
    const up = i.unit_price || 0
    if (i.unit_type === 'bulk') {
      const kpb = Number(i.kg_per_bag) || 0
      return a + q * kpb * up
    }
    return a + q * up
  }, 0)
  const warehouseId = data.warehouse_id || 1
  d.prepare(`
    INSERT INTO supplier_purchases (supplier_id, warehouse_id, total_amount, notes, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(data.supplier_id, warehouseId, total_amount, data.notes ?? null, t)
  const purchaseId = d.prepare('SELECT last_insert_rowid() as id').get().id
  for (const it of items) {
    const expiryDate = it.expiry_date || null
    d.prepare(`
      INSERT INTO supplier_purchase_items (supplier_purchase_id, product_id, quantity, unit_price, total_price, created_at, expiry_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(purchaseId, it.product_id, it.quantity ?? 0, it.unit_price ?? 0, (it.quantity || 0) * (it.unit_price || 0), t, expiryDate)
    const purchasePrice = (it.unit_price != null && it.unit_price > 0) ? it.unit_price : null
    let sellingPriceForBatch = null
    if (purchasePrice != null) {
      const rawSp = it.selling_price
      if (rawSp !== undefined && rawSp !== null && String(rawSp).trim() !== '') {
        const n = Number(rawSp)
        if (Number.isFinite(n) && n > 0) sellingPriceForBatch = n
      }
      if (sellingPriceForBatch == null) {
        const markupPct = parseFloat(getSetting('default_markup_percent') || '0')
        sellingPriceForBatch = markupPct > 0
          ? Math.round(purchasePrice * (1 + markupPct / 100) * 100) / 100
          : purchasePrice
      }
      d.prepare('UPDATE products SET purchase_price = ?, selling_price = ?, updated_at = ? WHERE id = ?')
        .run(purchasePrice, sellingPriceForBatch, t, it.product_id)
    }
    const batchPrices = {
      purchase_price: purchasePrice,
      selling_price: sellingPriceForBatch,
    }
    const batchExpiry = expiryDate || '9999-12-31'
    const dist = it.distribution || {}
    let bulkDetails = null
    if (it.unit_type === 'bulk') {
      bulkDetails = {
         unit_type: 'bulk', 
         bag_count: null, // per warehouse loop
         kg_per_bag: it.kg_per_bag || 0 
      }
    }

    if (Object.keys(dist).length) {
      for (const [whId, qty] of Object.entries(dist)) {
        if (bulkDetails) bulkDetails.bag_count = qty
        upsertBatch(it.product_id, Number(whId), batchExpiry, qty || 0, batchPrices, bulkDetails)
      }
    } else {
      if (bulkDetails) bulkDetails.bag_count = it.quantity || 0
      upsertBatch(it.product_id, warehouseId, batchExpiry, it.quantity || 0, batchPrices, bulkDetails)
    }
  }
  return d.prepare('SELECT * FROM supplier_purchases WHERE id = ?').get(purchaseId)
}

// ----- Supplier payments -----
export function createSupplierPayment(data) {
  const d = getDb()
  const t = now()
  const paymentDate = data.payment_date || t.slice(0, 10)
  d.prepare(`
    INSERT INTO supplier_payments (supplier_id, amount, payment_method, notes, payment_date, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(data.supplier_id, data.amount ?? 0, data.payment_method || 'cash', data.notes ?? null, paymentDate, t)
  const id = d.prepare('SELECT last_insert_rowid() as id').get().id
  d.prepare(`
    INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
    VALUES ('supplier_payment_out', ?, 'supplier_payment', ?, NULL, ?, NULL)
  `).run(data.amount ?? 0, id, t)
  return d.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id)
}

// ----- Invoices -----
/**
 * @param {number | { limit?: number; payment_method?: string; warehouse_id?: number; from?: string; to?: string; unpaid_only?: boolean }} [limitOrOpts]
 */
export function getInvoices(limitOrOpts = 50) {
  const d = getDb()
  const opts = typeof limitOrOpts === 'number' ? { limit: limitOrOpts } : limitOrOpts || {}
  const limit = Math.min(Number(opts.limit) || 50, 200)
  const parts = [`COALESCE(invoice_lifecycle, 'active') != 'cancelled'`]
  const params = []
  if (opts.unpaid_only) parts.push('COALESCE(remaining_amount, 0) > 0')
  if (opts.payment_method) {
    const pm = String(opts.payment_method)
    if (pm === 'آجل' || pm === 'credit' || pm === 'deferred') {
      parts.push(`COALESCE(payment_method, '') IN ('آجل', 'credit', 'deferred')`)
    } else {
      parts.push('payment_method = ?')
      params.push(pm)
    }
  }
  if (opts.warehouse_id != null && Number.isFinite(Number(opts.warehouse_id))) {
    parts.push('warehouse_id = ?')
    params.push(Number(opts.warehouse_id))
  }
  if (opts.from && /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from).slice(0, 10))) {
    parts.push('date(created_at) >= date(?)')
    params.push(String(opts.from).slice(0, 10))
  }
  if (opts.to && /^\d{4}-\d{2}-\d{2}$/.test(String(opts.to).slice(0, 10))) {
    parts.push('date(created_at) <= date(?)')
    params.push(String(opts.to).slice(0, 10))
  }
  const where = parts.join(' AND ')
  const rows = d
    .prepare(`SELECT * FROM invoices WHERE ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit)
  return rows.map(inv => {
    const items = d.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(inv.id)
    return { ...inv, items }
  })
}

/**
 * Match Supabase GET /invoices/:id: client balance before/after at invoice time, warehouse name,
 * and barn balance before/after (initial_debt + barn invoices − barn payments).
 * @param {Record<string, unknown> & { items?: unknown[] }} inv
 */
function enrichInvoiceDetailSnapshot(inv) {
  if (!inv || inv.client_id == null) return inv
  const d = getDb()
  const clientId = inv.client_id
  const invId = inv.id
  const ts = inv.created_at || inv.updated_at || new Date().toISOString()

  const initialDebt =
    d.prepare('SELECT COALESCE(initial_debt, 0) AS d FROM clients WHERE id = ?').get(clientId)?.d ?? 0

  const invSumAfter =
    d
      .prepare(
        `SELECT COALESCE(SUM(total_amount), 0) AS s FROM invoices
         WHERE client_id = ?
           AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')
           AND ((created_at < ?) OR (created_at = ? AND id <= ?))`
      )
      .get(clientId, ts, ts, invId)?.s ?? 0

  const invSumBefore =
    d
      .prepare(
        `SELECT COALESCE(SUM(total_amount), 0) AS s FROM invoices
         WHERE client_id = ?
           AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')
           AND ((created_at < ?) OR (created_at = ? AND id < ?))`
      )
      .get(clientId, ts, ts, invId)?.s ?? 0

  const paySumAfter =
    d
      .prepare(
        `SELECT COALESCE(SUM(${sqlPaymentAmountTowardArExpr('')}), 0) AS s FROM payments
         WHERE client_id = ? AND created_at <= ?`
      )
      .get(clientId, ts)?.s ?? 0

  const paySumBefore =
    d
      .prepare(
        `SELECT COALESCE(SUM(${sqlPaymentAmountTowardArExpr('')}), 0) AS s FROM payments
         WHERE client_id = ? AND created_at < ?`
      )
      .get(clientId, ts)?.s ?? 0

  inv.client_balance_after = initialDebt + invSumAfter - paySumAfter
  inv.client_balance_before = initialDebt + invSumBefore - paySumBefore

  if (inv.warehouse_id != null) {
    const whRow = d.prepare('SELECT name_ar FROM warehouses WHERE id = ?').get(inv.warehouse_id)
    inv.warehouse_name_ar = whRow?.name_ar ?? null
  }

  const barnId = inv.barn_id
  if (barnId != null) {
    const barnInitial =
      d.prepare('SELECT COALESCE(initial_debt, 0) AS d FROM barns WHERE id = ?').get(barnId)?.d ?? 0

    const barnInvAfter =
      d
        .prepare(
          `SELECT COALESCE(SUM(total_amount), 0) AS s FROM invoices
           WHERE barn_id = ?
             AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')
             AND ((created_at < ?) OR (created_at = ? AND id <= ?))`
        )
        .get(barnId, ts, ts, invId)?.s ?? 0

    const barnInvBefore =
      d
        .prepare(
          `SELECT COALESCE(SUM(total_amount), 0) AS s FROM invoices
           WHERE barn_id = ?
             AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')
             AND ((created_at < ?) OR (created_at = ? AND id < ?))`
        )
        .get(barnId, ts, ts, invId)?.s ?? 0

    const barnPayAfter =
      d
        .prepare(
          `SELECT COALESCE(SUM(${sqlPaymentAmountTowardArExpr('')}), 0) AS s FROM payments
           WHERE barn_id = ? AND created_at <= ?`
        )
        .get(barnId, ts)?.s ?? 0

    const barnPayBefore =
      d
        .prepare(
          `SELECT COALESCE(SUM(${sqlPaymentAmountTowardArExpr('')}), 0) AS s FROM payments
           WHERE barn_id = ? AND created_at < ?`
        )
        .get(barnId, ts)?.s ?? 0

    inv.barn_balance_after = barnInitial + barnInvAfter - barnPayAfter
    inv.barn_balance_before = barnInitial + barnInvBefore - barnPayBefore
  }

  return inv
}

export function getInvoiceById(id) {
  const d = getDb()
  const inv = d.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  if (!inv) return null
  const items = d
    .prepare(
      `
    SELECT ii.*, p.unit_type AS product_unit_type
    FROM invoice_items ii
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE ii.invoice_id = ?
  `
    )
    .all(id)
  return enrichInvoiceDetailSnapshot({ ...inv, items })
}

/** Sync product_warehouse_stock from batch totals (Phase 13 name). */
export function recalculateWarehouseStock(productId, warehouseId) {
  syncWarehouseStockFromBatches(productId, warehouseId)
}

function loadInvoiceItemRowForReverse(d, invoiceItemId) {
  return d
    .prepare(
      `
    SELECT ii.*,
      i.warehouse_id AS invoice_warehouse_id,
      i.invoice_lifecycle AS inv_lifecycle,
      p.unit_type AS product_unit_type,
      pb.warehouse_id AS live_batch_warehouse_id
    FROM invoice_items ii
    INNER JOIN invoices i ON i.id = ii.invoice_id
    LEFT JOIN products p ON p.id = ii.product_id
    LEFT JOIN product_batches pb ON ii.batch_id = pb.id
    WHERE ii.id = ?
  `
    )
    .get(invoiceItemId)
}

function whForItem(item) {
  return item.batch_warehouse_id ?? item.live_batch_warehouse_id ?? item.invoice_warehouse_id
}

function recalcBatchKgFromBags(d, batchId, t) {
  d.prepare(
    `
    UPDATE product_batches SET kg_remaining = COALESCE(
      (SELECT SUM(kg_remaining) FROM bag_instances WHERE batch_id = ?), 0
    ), updated_at = ? WHERE id = ?
  `
  ).run(batchId, t, batchId)
}

function restoreKilosToBag(d, bagId, kilos, t) {
  const bag = d.prepare('SELECT id, batch_id FROM bag_instances WHERE id = ?').get(bagId)
  if (!bag) return false
  d.prepare(
    `
    UPDATE bag_instances
    SET kg_remaining = kg_remaining + ?,
        status = CASE
          WHEN status = 'empty' AND kg_remaining + ? > 0.001 THEN 'open'
          ELSE status
        END
    WHERE id = ?
  `
  ).run(kilos, kilos, bagId)
  recalcBatchKgFromBags(d, bag.batch_id, t)
  return true
}

function addQuantityToPieceBatchOrRecreate(d, batchId, productId, itemRow, qty, invWh, t) {
  if (!batchId) return
  const exists = d.prepare('SELECT id FROM product_batches WHERE id = ?').get(batchId)
  const wh = itemRow.batch_warehouse_id ?? invWh
  const exp =
    itemRow.batch_expiry_date != null && itemRow.batch_expiry_date !== ''
      ? String(itemRow.batch_expiry_date)
      : '9999-12-31'
  if (exists) {
    d.prepare('UPDATE product_batches SET quantity = quantity + ?, updated_at = ? WHERE id = ?').run(qty, t, batchId)
    return
  }
  d.prepare(
    `
    INSERT INTO product_batches (id, product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type, bag_count, kg_per_bag, kg_remaining, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'piece', NULL, NULL, NULL, ?, ?)
  `
  ).run(
    batchId,
    productId,
    wh,
    exp,
    qty,
    itemRow.unit_purchase_price ?? null,
    itemRow.unit_selling_price ?? null,
    t,
    t
  )
}

/**
 * Restore warehouse/batch stock for one line without deleting the line row.
 * @param {import('better-sqlite3').Database} d
 */
function reverseInvoiceItemStock(d, item, qtyToReverse) {
  const t = now()
  const unitType = item.product_unit_type ?? 'piece'
  const wh = whForItem(item)
  const lineQty = Number(item.quantity) || 0
  if (qtyToReverse <= 0 || qtyToReverse > lineQty + 0.0001) {
    throw new Error('كمية الإرجاع غير صالحة')
  }

  if (unitType === 'bulk') {
    const bagRows = d
      .prepare(
        'SELECT id, bag_id, amount_kg FROM invoice_item_bags WHERE invoice_item_id = ? ORDER BY id DESC'
      )
      .all(item.id)
    if (bagRows.length > 0) {
      let left = qtyToReverse
      for (const br of bagRows) {
        if (left <= 0.0001) break
        const take = Math.min(left, br.amount_kg)
        if (!restoreKilosToBag(d, br.bag_id, take, t)) continue
        left -= take
        const newAmt = br.amount_kg - take
        if (newAmt <= 0.001) d.prepare('DELETE FROM invoice_item_bags WHERE id = ?').run(br.id)
        else d.prepare('UPDATE invoice_item_bags SET amount_kg = ? WHERE id = ?').run(newAmt, br.id)
      }
      if (left > 0.001) throw new Error('تعذر مطابقة أرصدة الشكاير للإرجاع')
      recalculateWarehouseStock(item.product_id, wh)
      return
    }
    if (item.sold_from_bag_id) {
      if (!restoreKilosToBag(d, item.sold_from_bag_id, qtyToReverse, t)) {
        throw new Error('الشكارة الأصلية غير موجودة')
      }
      recalculateWarehouseStock(item.product_id, wh)
      return
    }
    upsertProductStock(item.product_id, wh, qtyToReverse)
    return
  }

  const batchRows = d
    .prepare(
      'SELECT id, batch_id, quantity FROM invoice_item_batches WHERE invoice_item_id = ? ORDER BY id DESC'
    )
    .all(item.id)
  if (batchRows.length > 0) {
    let left = qtyToReverse
    for (const br of batchRows) {
      if (left <= 0.0001) break
      const take = Math.min(left, br.quantity)
      addQuantityToPieceBatchOrRecreate(d, br.batch_id, item.product_id, item, take, item.invoice_warehouse_id, t)
      left -= take
      const newQ = br.quantity - take
      if (newQ <= 0.001) d.prepare('DELETE FROM invoice_item_batches WHERE id = ?').run(br.id)
      else d.prepare('UPDATE invoice_item_batches SET quantity = ? WHERE id = ?').run(newQ, br.id)
    }
    if (left > 0.001) throw new Error('تعذر مطابقة الدُفعات للإرجاع')
    recalculateWarehouseStock(item.product_id, wh)
    return
  }

  if (item.batch_id) {
    addQuantityToPieceBatchOrRecreate(d, item.batch_id, item.product_id, item, qtyToReverse, item.invoice_warehouse_id, t)
    recalculateWarehouseStock(item.product_id, wh)
    return
  }

  upsertProductStock(item.product_id, wh, qtyToReverse)
}

/**
 * Full stock reversal for one line and clear allocation rows (invoice_item_bags / invoice_item_batches).
 * Does not delete the invoice_items row.
 */
export function reverseInvoiceItem(invoiceItemId, db) {
  const d = db || getDb()
  const item = loadInvoiceItemRowForReverse(d, invoiceItemId)
  if (!item) throw new Error('بند الفاتورة غير موجود')
  const qty = Number(item.quantity) || 0
  reverseInvoiceItemStock(d, item, qty)
  d.prepare('DELETE FROM invoice_item_bags WHERE invoice_item_id = ?').run(invoiceItemId)
  d.prepare('DELETE FROM invoice_item_batches WHERE invoice_item_id = ?').run(invoiceItemId)
}

function assertInvoiceEditable(inv) {
  if ((inv.invoice_lifecycle || 'active') === 'cancelled') {
    throw new Error('الفاتورة ملغاة ولا يمكن تعديلها')
  }
}

function computeInvoiceCostFromItems(d, items) {
  let totalCost = 0
  for (const i of items) {
    let pp = i.unit_purchase_price
    if (pp == null && i.product_id) {
      const row = d.prepare('SELECT purchase_price FROM products WHERE id = ?').get(i.product_id)
      pp = row?.purchase_price ?? 0
    }
    totalCost += (Number(i.quantity) || 0) * (pp ?? 0)
  }
  return totalCost
}

function recalcInvoiceFinancials(d, invoiceId, t) {
  const inv = d.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId)
  if (!inv) return null
  const oldProfit = inv.profit_amount ?? 0
  const items = d.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId)
  const subtotal = items.reduce((a, i) => a + (Number(i.total_price) || 0), 0)
  const discountAmount = Math.max(0, Number(inv.discount_amount) || 0)
  const total = Math.max(0, subtotal - discountAmount)
  let paid = Math.max(0, Number(inv.paid_amount) || 0)
  if (paid > total) paid = total
  const remaining = Math.max(0, total - paid)
  let status = 'معلق'
  if (total > 0 && paid >= total) status = 'مدفوعة'
  else if (paid > 0) status = 'جزئي'
  const totalCost = computeInvoiceCostFromItems(d, items)
  const newProfit = Math.max(0, total - totalCost)
  d.prepare(
    `
    UPDATE invoices SET
      total_amount = ?, paid_amount = ?, remaining_amount = ?,
      profit_amount = ?, status = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(total, paid, remaining, newProfit, status, t, invoiceId)
  d.prepare('UPDATE clients SET total_profit = MAX(0, COALESCE(total_profit,0) - ? + ?) WHERE id = ?').run(
    oldProfit,
    newProfit,
    inv.client_id
  )
  if (inv.barn_id) {
    d.prepare('UPDATE barns SET total_profit = MAX(0, COALESCE(total_profit,0) - ? + ?) WHERE id = ?').run(
      oldProfit,
      newProfit,
      inv.barn_id
    )
  }
  const invAfter = d.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId)
  syncPaymentsForInvoice(d, invoiceId, invAfter, { mode: 'recalc' }, t)
  return invAfter
}

export function deleteInvoiceItem(invoiceId, itemId) {
  const d = getDb()
  const inv = d.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId)
  if (!inv) throw new Error('الفاتورة غير موجودة')
  assertInvoiceEditable(inv)
  const item = loadInvoiceItemRowForReverse(d, itemId)
  if (!item || item.invoice_id !== invoiceId) throw new Error('الصنف غير موجود في هذه الفاتورة')
  const itemsLeft = d.prepare('SELECT COUNT(*) as c FROM invoice_items WHERE invoice_id = ?').get(invoiceId).c
  if (itemsLeft <= 1) throw new Error('لا يمكن حذف آخر صنف — ألغِ الفاتورة أو أضف صنفاً آخر أولاً')

  const run = d.transaction(() => {
    const t = now()
    reverseInvoiceItem(itemId, d)
    d.prepare('DELETE FROM invoice_items WHERE id = ?').run(itemId)
    recalcInvoiceFinancials(d, invoiceId, t)
  })
  run()
  return getInvoiceById(invoiceId)
}

export function returnPartialInvoiceItem(invoiceId, itemId, returnedQuantity, notes) {
  const d = getDb()
  const inv = d.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId)
  if (!inv) throw new Error('الفاتورة غير موجودة')
  assertInvoiceEditable(inv)
  const item = loadInvoiceItemRowForReverse(d, itemId)
  if (!item || item.invoice_id !== invoiceId) throw new Error('الصنف غير موجود في هذه الفاتورة')
  const ret = Number(returnedQuantity)
  const lineQty = Number(item.quantity) || 0
  if (!Number.isFinite(ret) || ret <= 0 || ret > lineQty + 0.0001) {
    throw new Error('كمية الإرجاع غير صالحة')
  }

  const run = d.transaction(() => {
    const t = now()
    reverseInvoiceItemStock(d, item, ret)
    const newQty = lineQty - ret
    const unitPrice = Number(item.unit_price) || 0
    const newTotal = Math.max(0, unitPrice * newQty)
    d.prepare('UPDATE invoice_items SET quantity = ?, total_price = ? WHERE id = ?').run(newQty, newTotal, itemId)
    d.prepare(
      `INSERT INTO return_transactions (invoice_id, invoice_item_id, batch_id, bag_instance_id, returned_quantity, notes, return_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      invoiceId,
      itemId,
      item.batch_id ?? null,
      item.sold_from_bag_id ?? null,
      ret,
      notes ?? null,
      t
    )
    recalcInvoiceFinancials(d, invoiceId, t)
  })
  run()
  return getInvoiceById(invoiceId)
}

export function cancelInvoice(id) {
  const d = getDb()
  const inv = d.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  if (!inv) return null
  if ((inv.invoice_lifecycle || 'active') === 'cancelled') {
    throw new Error('الفاتورة ملغاة مسبقاً')
  }
  const itemIds = d.prepare('SELECT id FROM invoice_items WHERE invoice_id = ?').all(id).map((r) => r.id)

  const run = d.transaction(() => {
    const t = now()
    for (const iid of itemIds) {
      reverseInvoiceItem(iid, d)
    }
    const linkedPayments = d.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(id)
    for (const p of linkedPayments) {
      reverseRoutedPayment(d, p, t)
      if (p.payment_method === 'historical_invoice_paid' && (p.amount ?? 0) > 0) {
        d.prepare(
          `
        INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
        VALUES ('adjustment_out', ?, 'invoice_cancel', ?, ?, ?, NULL)
      `
        ).run(p.amount, id, `إلغاء فاتورة #${id} (مدفوع ترحيل)`, t)
      }
    }
    d.prepare('DELETE FROM payments WHERE invoice_id = ?').run(id)
    const paid = inv.paid_amount ?? 0
    const pm = inv.payment_method || 'cash'
    if (paid > 0 && pm === 'cash' && linkedPayments.length === 0) {
      d.prepare(
        `
        INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
        VALUES ('adjustment_out', ?, 'invoice_cancel', ?, ?, ?, NULL)
      `
      ).run(paid, id, `إلغاء فاتورة #${id}`, t)
    }
    d.prepare('UPDATE clients SET total_profit = MAX(0, COALESCE(total_profit,0) - ?) WHERE id = ?').run(
      inv.profit_amount ?? 0,
      inv.client_id
    )
    if (inv.barn_id) {
      d.prepare(
        'UPDATE barns SET total_invoices = MAX(0, COALESCE(total_invoices,0) - 1), total_profit = MAX(0, COALESCE(total_profit,0) - ?) WHERE id = ?'
      ).run(inv.profit_amount ?? 0, inv.barn_id)
    }
    d.prepare(
      `
      UPDATE invoices SET
        invoice_lifecycle = 'cancelled',
        profit_amount = 0,
        paid_amount = 0,
        remaining_amount = 0,
        status = 'معلق',
        updated_at = ?
      WHERE id = ?
    `
    ).run(t, id)
  })
  run()
  return getInvoiceById(id)
}

function applyInvoiceItemSnapshots(d, itemId, it, warehouseId, primaryBatchId, allocs, t) {
  let unitPurchase = null
  let unitSelling = null
  let batchExpiry = null
  let batchWh = null
  let soldBag = null
  const bid =
    primaryBatchId ||
    (allocs && allocs.length > 0 ? allocs[0].batch_id : null)
  if (bid) {
    const b = d
      .prepare('SELECT warehouse_id, expiry_date, purchase_price, selling_price FROM product_batches WHERE id = ?')
      .get(bid)
    if (b) {
      batchWh = b.warehouse_id
      batchExpiry = b.expiry_date
      unitPurchase = b.purchase_price
      unitSelling = b.selling_price
    }
  }
  if (batchWh == null) batchWh = warehouseId
  const p = it.product_id ? d.prepare('SELECT purchase_price, selling_price FROM products WHERE id = ?').get(it.product_id) : null
  if (unitPurchase == null && p) unitPurchase = p.purchase_price
  if (unitSelling == null && p) unitSelling = p.selling_price
  if (it.bag_id && allocs && allocs.length === 1) soldBag = allocs[0].bag_id
  d.prepare(
    `
    UPDATE invoice_items SET
      unit_purchase_price = ?,
      unit_selling_price = ?,
      batch_expiry_date = ?,
      batch_warehouse_id = ?,
      sold_from_bag_id = ?
    WHERE id = ?
  `
  ).run(unitPurchase, unitSelling, batchExpiry, batchWh, soldBag, itemId)
}

export function createInvoice(data) {
  const d = getDb()
  const run = d.transaction(() => {
  const t = now()
  const bulkNotifications = []
  const subtotal = (data.items || []).reduce((a, i) => a + (i.total_price || 0), 0)
  const discountAmount = Math.max(0, Number(data.discount_amount) || 0)
  const total = Math.max(0, subtotal - discountAmount)
  let paid = Math.max(0, Number(data.paid_amount) || 0)
  if (paid > total) paid = total
  const remaining = Math.max(0, total - paid)
  if (remaining > 0 && data.register_deferred !== true && paid > 0) {
    throw new Error(
      'المبلغ المدفوع أقل من إجمالي الفاتورة.\nيرجى إدخال المبلغ المتبقي أو تسجيله كآجل'
    )
  }
  let status = 'معلق'
  if (total > 0 && paid >= total) status = 'مدفوعة'
  else if (paid > 0) status = 'جزئي'
  const invoicePaymentMethod = remaining > 0 ? 'آجل' : (data.immediate_payment_method || data.payment_method || 'cash')
  // Profit = invoice total (after discount) minus total cost at purchase price
  const productIds = [...new Set((data.items || []).map((i) => i.product_id).filter(Boolean))]
  const purchasePriceMap = {};
  const unitTypeMap = {};
  if (productIds.length > 0) {
    const placeholders = productIds.map(() => '?').join(',')
    const rows = d.prepare(`SELECT id, purchase_price, unit_type FROM products WHERE id IN (${placeholders})`).all(...productIds)
    for (const r of rows) {
      purchasePriceMap[r.id] = r.purchase_price ?? 0;
      unitTypeMap[r.id] = r.unit_type ?? 'piece';
    }
  }
  const totalCost = (data.items || []).reduce(
    (sum, i) => sum + (i.quantity || 0) * (purchasePriceMap[i.product_id] ?? 0),
    0
  )
  const profit = Math.max(0, total - totalCost)
  let barnBillingCycleId = null
  if (data.barn_id) {
    const ob = d
      .prepare(
        'SELECT id FROM barn_billing_cycles WHERE barn_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
      )
      .get(data.barn_id)
    barnBillingCycleId = ob ? ob.id : null
  }
  const dueDate = data.due_date != null && String(data.due_date).trim() !== '' ? String(data.due_date).trim().slice(0, 10) : null
  d.prepare(`
    INSERT INTO invoices (client_id, barn_id, warehouse_id, customer_name, total_amount, paid_amount, remaining_amount, profit_amount, payment_method, status, notes, discount_amount, created_at, created_by, billing_cycle_id, barn_billing_cycle_id, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
  `).run(
    data.client_id,
    data.barn_id ?? null,
    data.warehouse_id,
    data.customer_name || '',
    total,
    paid,
    remaining,
    profit,
    invoicePaymentMethod,
    status,
    data.notes ?? null,
    discountAmount,
    t,
    barnBillingCycleId,
    dueDate
  )
  const id = d.prepare('SELECT last_insert_rowid() as id').get().id
  for (const it of data.items || []) {
    const batchId = it.batch_id ?? null
    const dispQtyRaw = it.display_quantity != null ? Number(it.display_quantity) : Number(it.quantity ?? 0)
    const dispU = it.display_unit === 'gram' ? 'gram' : 'kg'
    d.prepare(`
      INSERT INTO invoice_items (invoice_id, product_id, product_name, quantity, unit_price, total_price, batch_id, display_quantity, display_unit, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, it.product_id, it.product_name || '', it.quantity ?? 0, it.unit_price ?? 0, it.total_price ?? 0, batchId, dispQtyRaw, dispU, t)
    const itemId = d.prepare('SELECT last_insert_rowid() as id').get().id
    const qty = it.quantity ?? 0
    let snapAllocs = []
    const snapPrimaryBatch = batchId
    if (qty > 0 && it.product_id) {
      if (unitTypeMap[it.product_id] === 'bulk') {
        const allocs = it.bag_id
          ? allocateKilosFromSpecificBag(it.bag_id, it.product_id, data.warehouse_id, qty)
          : allocateBagsFEFO(it.product_id, data.warehouse_id, qty)
        snapAllocs = allocs
        for (const al of allocs) {
          d.prepare('INSERT INTO invoice_item_bags (invoice_item_id, bag_id, amount_kg) VALUES (?, ?, ?)').run(itemId, al.bag_id, al.amount_kg)
          d.prepare('UPDATE product_batches SET kg_remaining = MAX(0, kg_remaining - ?), updated_at = ? WHERE id = ?').run(al.amount_kg, t, al.batch_id)
          d.prepare('UPDATE bag_instances SET kg_remaining = MAX(0, kg_remaining - ?), status = CASE WHEN kg_remaining - ? <= 0.001 THEN "empty" ELSE status END WHERE id = ?').run(al.amount_kg, al.amount_kg, al.bag_id)
        }
        const openBag = d.prepare("SELECT id FROM bag_instances WHERE product_id = ? AND warehouse_id = ? AND status = 'open' LIMIT 1").get(it.product_id, data.warehouse_id)
        if (!openBag) {
          const ur = d.prepare(`UPDATE bag_instances SET status = 'open', opened_at = ? 
             WHERE id = (SELECT id FROM bag_instances WHERE product_id = ? AND warehouse_id = ? AND status = 'sealed' ORDER BY expiry_date ASC NULLS LAST, id ASC LIMIT 1)`
           ).run(t, it.product_id, data.warehouse_id)
          if (ur.changes > 0) {
            const whn = d.prepare('SELECT name_ar FROM warehouses WHERE id = ?').get(data.warehouse_id)
            const opened = d.prepare(
              `SELECT expiry_date FROM bag_instances WHERE product_id = ? AND warehouse_id = ? AND status = 'open' ORDER BY datetime(opened_at) DESC LIMIT 1`
            ).get(it.product_id, data.warehouse_id)
            bulkNotifications.push({
              type: 'bag_auto_opened',
              product_id: it.product_id,
              product_name: it.product_name || '',
              warehouse_name: whn?.name_ar ?? '',
              expiry_date: opened?.expiry_date ?? null,
            })
          }
        }
        syncWarehouseStockFromBatches(it.product_id, data.warehouse_id)
      } else {
        if (batchId) {
          const batch = d.prepare('SELECT quantity FROM product_batches WHERE id = ?').get(batchId)
          if (!batch || (batch.quantity ?? 0) < qty) {
            throw new Error(`الكمية المطلوبة تتجاوز المخزون المتاح في هذه الدفعة (متاح: ${batch?.quantity ?? 0})`)
          }
          d.prepare('UPDATE product_batches SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?').run(qty, t, batchId)
          d.prepare('INSERT INTO invoice_item_batches (invoice_item_id, batch_id, quantity) VALUES (?, ?, ?)').run(itemId, batchId, qty)
          syncWarehouseStockFromBatches(it.product_id, data.warehouse_id)
        } else {
          const allocs = allocateBatchesFEFO(it.product_id, data.warehouse_id, qty)
          snapAllocs = allocs
          for (const al of allocs) {
            d.prepare('INSERT INTO invoice_item_batches (invoice_item_id, batch_id, quantity) VALUES (?, ?, ?)').run(itemId, al.batch_id, al.quantity)
            d.prepare('UPDATE product_batches SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?').run(al.quantity, t, al.batch_id)
          }
          upsertProductStock(it.product_id, data.warehouse_id, -(qty))
        }
      }
    }
    applyInvoiceItemSnapshots(d, itemId, it, data.warehouse_id, snapPrimaryBatch, snapAllocs, t)
  }
  // Add profit to client and to barn (if invoice is linked to a barn)
  d.prepare('UPDATE clients SET total_profit = COALESCE(total_profit,0) + ? WHERE id = ?').run(profit, data.client_id)
  if (data.barn_id) {
    d.prepare('UPDATE barns SET total_invoices = COALESCE(total_invoices,0) + 1, total_profit = COALESCE(total_profit,0) + ? WHERE id = ?').run(profit, data.barn_id)
  }
  const invRow = {
    client_id: data.client_id,
    barn_id: data.barn_id ?? null,
    billing_cycle_id: null,
    barn_billing_cycle_id: barnBillingCycleId,
    total_amount: total,
    paid_amount: paid,
    remaining_amount: remaining,
    created_at: t,
  }
  syncPaymentsForInvoice(d, id, invRow, {
    mode: 'user',
    register_deferred: data.register_deferred === true,
    immediate_payment_method:
      data.immediate_payment_method ||
      (['cash', 'vodafone_cash', 'instapay'].includes(data.payment_method) ? data.payment_method : 'cash'),
    wallet_id: data.wallet_id,
  }, t)
  const invOut = getInvoiceById(id)
  return { ...invOut, bulk_notifications: bulkNotifications }
  })
  return run()
}

export function updateInvoice(id, data) {
  const d = getDb()
  const inv = d.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  if (!inv) return null
  assertInvoiceEditable(inv)
  const allowed = ['paid_amount', 'remaining_amount', 'status', 'notes']
  const updates = []
  const params = []
  for (const k of allowed) {
    if (data[k] !== undefined) {
      updates.push(`${k} = ?`)
      params.push(data[k])
    }
  }
  if (updates.length === 0) return getInvoiceById(id)
  params.push(now(), id)
  d.prepare(`UPDATE invoices SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...params)
  return getInvoiceById(id)
}

/**
 * Replace invoice line items and totals (edit فاتورة). Restores warehouse stock for old lines,
 * then applies new lines. Client / barn / warehouse stay fixed on the invoice row.
 */
export function replaceInvoice(id, data) {
  const d = getDb()
  const inv = d.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  if (!inv) return null
  assertInvoiceEditable(inv)

  const items = data.items || []
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('أضف صنفاً واحداً على الأقل')
  }

  const warehouseId = inv.warehouse_id
  const clientId = inv.client_id
  const barnId = inv.barn_id

  const t = now()
  const oldItems = d.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(id)
  const oldProfit = inv.profit_amount ?? 0

  const run = d.transaction(() => {
    const bulkNotifications = []
    // Restore batch allocations from old invoice items
    const oldUnitTypeMap = {}
    if (oldItems.length > 0) {
      const pids = [...new Set(oldItems.map(i => i.product_id))]
      const ph = pids.map(() => '?').join(',')
      const rows = d.prepare(`SELECT id, unit_type FROM products WHERE id IN (${ph})`).all(...pids)
      for (const r of rows) oldUnitTypeMap[r.id] = r.unit_type ?? 'piece'
    }
    for (const it of oldItems) {
      if (oldUnitTypeMap[it.product_id] === 'bulk') {
        const bagAllocs = d.prepare('SELECT bag_id, amount_kg FROM invoice_item_bags WHERE invoice_item_id = ?').all(it.id)
        for (const ba of bagAllocs) {
          d.prepare('UPDATE bag_instances SET kg_remaining = kg_remaining + ?, status = CASE WHEN status = "empty" THEN "open" ELSE status END WHERE id = ?').run(ba.amount_kg, ba.bag_id)
          d.prepare('UPDATE product_batches SET kg_remaining = kg_remaining + ?, updated_at = ? WHERE id = (SELECT batch_id FROM bag_instances WHERE id = ?)').run(ba.amount_kg, t, ba.bag_id)
        }
        d.prepare('DELETE FROM invoice_item_bags WHERE invoice_item_id = ?').run(it.id)
        syncWarehouseStockFromBatches(it.product_id, warehouseId)
      } else {
        const batchAllocs = d.prepare('SELECT batch_id, quantity FROM invoice_item_batches WHERE invoice_item_id = ?').all(it.id)
        for (const ba of batchAllocs) {
          d.prepare('UPDATE product_batches SET quantity = quantity + ?, updated_at = ? WHERE id = ?').run(ba.quantity, t, ba.batch_id)
        }
        d.prepare('DELETE FROM invoice_item_batches WHERE invoice_item_id = ?').run(it.id)
        if (batchAllocs.length > 0) {
          syncWarehouseStockFromBatches(it.product_id, warehouseId)
        } else {
          upsertProductStock(it.product_id, warehouseId, it.quantity ?? 0)
        }
      }
    }

    d.prepare('UPDATE clients SET total_profit = MAX(0, COALESCE(total_profit,0) - ?) WHERE id = ?').run(
      oldProfit,
      clientId
    )
    if (barnId) {
      d.prepare('UPDATE barns SET total_profit = MAX(0, COALESCE(total_profit,0) - ?) WHERE id = ?').run(
        oldProfit,
        barnId
      )
    }

    d.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(id)

    const subtotal = items.reduce((a, i) => a + (i.total_price || 0), 0)
    const discountAmount = Math.max(
      0,
      data.discount_amount !== undefined ? Number(data.discount_amount) : inv.discount_amount ?? 0
    )
    const total = Math.max(0, subtotal - discountAmount)
    let paid = Math.max(0, Number(data.paid_amount !== undefined ? data.paid_amount : inv.paid_amount) || 0)
    if (paid > total) paid = total
    const remaining = Math.max(0, total - paid)
    let registerDeferred = data.register_deferred
    if (registerDeferred === undefined) {
      const hadDef = d
        .prepare(`SELECT 1 FROM payments WHERE invoice_id = ? AND payment_method = 'deferred'`)
        .get(id)
      const pm0 = String(inv.payment_method || '')
      registerDeferred = !!hadDef || pm0 === 'آجل' || pm0 === 'credit'
    }
    if (remaining > 0 && paid === 0) registerDeferred = true
    if (remaining > 0 && registerDeferred !== true) {
      throw new Error(
        'المبلغ المدفوع أقل من إجمالي الفاتورة.\nيرجى إدخال المبلغ المتبقي أو تسجيله كآجل'
      )
    }
    let status = 'معلق'
    if (total > 0 && paid >= total) status = 'مدفوعة'
    else if (paid > 0) status = 'جزئي'

    const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))]
    const purchasePriceMap = {}
    if (productIds.length > 0) {
      const ph = productIds.map(() => '?').join(',')
      const rows = d.prepare(`SELECT id, purchase_price FROM products WHERE id IN (${ph})`).all(...productIds)
      for (const r of rows) purchasePriceMap[r.id] = r.purchase_price ?? 0
    }
    const totalCost = items.reduce(
      (sum, i) => sum + (i.quantity || 0) * (purchasePriceMap[i.product_id] ?? 0),
      0
    )
    const profit = Math.max(0, total - totalCost)

    const newUnitTypeMap = {}
    if (productIds.length > 0) {
      const phUt = productIds.map(() => '?').join(',')
      const utRows = d.prepare(`SELECT id, unit_type FROM products WHERE id IN (${phUt})`).all(...productIds)
      for (const r of utRows) newUnitTypeMap[r.id] = r.unit_type ?? 'piece'
    }

    const imm =
      data.immediate_payment_method ||
      (['cash', 'vodafone_cash', 'instapay'].includes(data.payment_method) ? data.payment_method : null) ||
      (['cash', 'vodafone_cash', 'instapay'].includes(inv.payment_method) ? inv.payment_method : null) ||
      'cash'
    const paymentMethod = remaining > 0 ? 'آجل' : imm
    const customerName =
      data.customer_name != null ? String(data.customer_name) : inv.customer_name || ''
    const notes = data.notes !== undefined ? data.notes : inv.notes
    const dueDate =
      data.due_date !== undefined
        ? data.due_date != null && String(data.due_date).trim() !== ''
          ? String(data.due_date).trim().slice(0, 10)
          : null
        : inv.due_date ?? null

    const stockAvail = {}
    const pids = [...new Set(items.map((i) => i.product_id).filter(Boolean))]
    for (const pid of pids) {
      const row = d
        .prepare('SELECT quantity FROM product_warehouse_stock WHERE product_id = ? AND warehouse_id = ?')
        .get(pid, warehouseId)
      stockAvail[pid] = row ? row.quantity ?? 0 : 0
    }
    const need = {}
    for (const it of items) {
      const pid = it.product_id
      const q = it.quantity ?? 0
      need[pid] = (need[pid] ?? 0) + q
    }
    for (const pid of pids) {
      if ((need[pid] ?? 0) > (stockAvail[pid] ?? 0)) {
        throw new Error('الكمية المتاحة في المخزن غير كافية لأحد الأصناف')
      }
    }

    d.prepare(`
      UPDATE invoices SET
        customer_name = ?, total_amount = ?, paid_amount = ?, remaining_amount = ?,
        profit_amount = ?, payment_method = ?, status = ?, notes = ?, discount_amount = ?, due_date = ?, updated_at = ?
      WHERE id = ?
    `).run(
      customerName,
      total,
      paid,
      remaining,
      profit,
      paymentMethod,
      status,
      notes ?? null,
      discountAmount,
      dueDate,
      t,
      id
    )

    for (const it of items) {
      const batchId = it.batch_id ?? null
      const dispQtyRaw = it.display_quantity != null ? Number(it.display_quantity) : Number(it.quantity ?? 0)
      const dispU = it.display_unit === 'gram' ? 'gram' : 'kg'
      d.prepare(`
        INSERT INTO invoice_items (invoice_id, product_id, product_name, quantity, unit_price, total_price, batch_id, display_quantity, display_unit, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        it.product_id,
        it.product_name || '',
        it.quantity ?? 0,
        it.unit_price ?? 0,
        it.total_price ?? 0,
        batchId,
        dispQtyRaw,
        dispU,
        t
      )
      const itemId = d.prepare('SELECT last_insert_rowid() as id').get().id
      const qty = it.quantity ?? 0
      let snapAllocs = []
      const snapPrimaryBatch = batchId
      if (qty > 0 && it.product_id) {
        if (newUnitTypeMap[it.product_id] === 'bulk') {
          const allocs = it.bag_id
            ? allocateKilosFromSpecificBag(it.bag_id, it.product_id, warehouseId, qty)
            : allocateBagsFEFO(it.product_id, warehouseId, qty)
          snapAllocs = allocs
          for (const al of allocs) {
            d.prepare('INSERT INTO invoice_item_bags (invoice_item_id, bag_id, amount_kg) VALUES (?, ?, ?)').run(itemId, al.bag_id, al.amount_kg)
            d.prepare('UPDATE product_batches SET kg_remaining = MAX(0, kg_remaining - ?), updated_at = ? WHERE id = ?').run(al.amount_kg, t, al.batch_id)
            d.prepare('UPDATE bag_instances SET kg_remaining = MAX(0, kg_remaining - ?), status = CASE WHEN kg_remaining - ? <= 0.001 THEN "empty" ELSE status END WHERE id = ?').run(al.amount_kg, al.amount_kg, al.bag_id)
          }
          const openBag = d.prepare("SELECT id FROM bag_instances WHERE product_id = ? AND warehouse_id = ? AND status = 'open' LIMIT 1").get(it.product_id, warehouseId)
          if (!openBag) {
            const ur = d.prepare(`UPDATE bag_instances SET status = 'open', opened_at = ? 
               WHERE id = (SELECT id FROM bag_instances WHERE product_id = ? AND warehouse_id = ? AND status = 'sealed' ORDER BY expiry_date ASC NULLS LAST, id ASC LIMIT 1)`
             ).run(t, it.product_id, warehouseId)
            if (ur.changes > 0) {
              const whn = d.prepare('SELECT name_ar FROM warehouses WHERE id = ?').get(warehouseId)
              const opened = d.prepare(
                `SELECT expiry_date FROM bag_instances WHERE product_id = ? AND warehouse_id = ? AND status = 'open' ORDER BY datetime(opened_at) DESC LIMIT 1`
              ).get(it.product_id, warehouseId)
              bulkNotifications.push({
                type: 'bag_auto_opened',
                product_id: it.product_id,
                product_name: it.product_name || '',
                warehouse_name: whn?.name_ar ?? '',
                expiry_date: opened?.expiry_date ?? null,
              })
            }
          }
          syncWarehouseStockFromBatches(it.product_id, warehouseId)
        } else {
          if (batchId) {
            const batch = d.prepare('SELECT quantity FROM product_batches WHERE id = ?').get(batchId)
            if (!batch || (batch.quantity ?? 0) < qty) {
              throw new Error(`الكمية المطلوبة تتجاوز المخزون المتاح في هذه الدفعة (متاح: ${batch?.quantity ?? 0})`)
            }
            d.prepare('UPDATE product_batches SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?').run(qty, t, batchId)
            d.prepare('INSERT INTO invoice_item_batches (invoice_item_id, batch_id, quantity) VALUES (?, ?, ?)').run(itemId, batchId, qty)
            syncWarehouseStockFromBatches(it.product_id, warehouseId)
          } else {
            const allocs = allocateBatchesFEFO(it.product_id, warehouseId, qty)
            snapAllocs = allocs
            for (const al of allocs) {
              d.prepare('INSERT INTO invoice_item_batches (invoice_item_id, batch_id, quantity) VALUES (?, ?, ?)').run(itemId, al.batch_id, al.quantity)
              d.prepare('UPDATE product_batches SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?').run(al.quantity, t, al.batch_id)
            }
            upsertProductStock(it.product_id, warehouseId, -(qty))
          }
        }
      }
      applyInvoiceItemSnapshots(d, itemId, it, warehouseId, snapPrimaryBatch, snapAllocs, t)
    }

    d.prepare('UPDATE clients SET total_profit = COALESCE(total_profit,0) + ? WHERE id = ?').run(profit, clientId)
    if (barnId) {
      d.prepare('UPDATE barns SET total_profit = COALESCE(total_profit,0) + ? WHERE id = ?').run(profit, barnId)
    }

    const invFresh = d.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
    syncPaymentsForInvoice(
      d,
      id,
      invFresh,
      {
        mode: 'user',
        register_deferred: registerDeferred === true,
        immediate_payment_method: imm,
        wallet_id: data.wallet_id,
      },
      t
    )
    return bulkNotifications
  })

  const bulkNotes = run()
  const invOut = getInvoiceById(id)
  return { ...invOut, bulk_notifications: bulkNotes }
}

/** Soft-cancel: restores stock, records safe adjustment for cash paid, preserves invoice + lines for audit. */
export function deleteInvoice(id) {
  return cancelInvoice(id)
}

// ----- Payments -----
export function getPayments(limit = 50) {
  return getDb().prepare('SELECT * FROM payments ORDER BY id DESC LIMIT ?').all(Math.min(limit, 200))
}

export function createPayment(data) {
  const d = getDb()
  const method = data.payment_method || 'cash'
  if (method === 'deferred') {
    throw new Error('لا يمكن تسجيل دفعة آجل من هنا — استخدم الفاتورة أو تسجيل المتبقي كآجل')
  }
  const t = now()
  const paymentDate = data.payment_date || t.slice(0, 10)
  let barnBillingCycleId = null
  if (data.barn_id) {
    const ob = d
      .prepare(
        'SELECT id FROM barn_billing_cycles WHERE barn_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
      )
      .get(data.barn_id)
    barnBillingCycleId = ob ? ob.id : null
  }
  const billingCycleId = data.billing_cycle_id ?? getOpenClientBillingCycleId(d, data.client_id)
  const row = insertPaymentWithRouting(d, {
    client_id: data.client_id,
    barn_id: data.barn_id ?? null,
    amount: data.amount ?? 0,
    payment_method: method,
    notes: data.notes ?? null,
    payment_date: paymentDate,
    created_at: t,
    billing_cycle_id: billingCycleId,
    barn_billing_cycle_id: barnBillingCycleId,
    invoice_id: data.invoice_id ?? null,
    wallet_id: data.wallet_id ?? null,
  })
  if (data.invoice_id && paymentAmountTowardArJs({ payment_method: method })) {
    const def = d
      .prepare(
        `SELECT id FROM payments WHERE invoice_id = ? AND payment_method = 'deferred' AND settled_at IS NULL ORDER BY id DESC LIMIT 1`
      )
      .get(data.invoice_id)
    if (def) {
      d.prepare('UPDATE payments SET settled_at = ? WHERE id = ?').run(t, def.id)
    }
  }
  return row
}

// ----- Safe -----
export function getSafeBalance() {
  const rows = getDb().prepare('SELECT type, amount FROM safe_transactions').all()
  let balance = 0
  for (const t of rows) {
    const amt = t.amount || 0
    if (t.type === 'initial' || t.type === 'customer_payment_in' || t.type === 'adjustment_in') balance += amt
    else balance -= amt
  }
  return Math.max(0, balance)
}

export function getSafeTransactions(limit = 50) {
  return getDb().prepare('SELECT * FROM safe_transactions ORDER BY id DESC LIMIT ?').all(Math.min(limit, 100))
}

export function createSafeInitial(data) {
  getDb().prepare(`
    INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
    VALUES ('initial', ?, NULL, NULL, ?, ?, NULL)
  `).run(data.amount ?? 0, data.notes ?? null, now())
}

export function createSafeAdjustment(data) {
  getDb().prepare(`
    INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
    VALUES (?, ?, NULL, NULL, ?, ?, NULL)
  `).run(data.type || 'adjustment_in', data.amount ?? 0, data.notes ?? null, now())
}

export function deleteSafeTransaction(id) {
  const d = getDb()
  const row = d.prepare('SELECT * FROM safe_transactions WHERE id = ?').get(id)
  if (!row) return false
  // لا نحذف الحركات المرتبطة بسداد العملاء أو الموردين حفاظاً على الاتساق
  if (row.reference_type) {
    throw new Error('لا يمكن حذف حركة مرتبطة بعملية أخرى (دفعة عميل أو مورد).')
  }
  d.prepare('DELETE FROM safe_transactions WHERE id = ?').run(id)
  return true
}

/** Bulk-delete log rows not tied to customer/supplier payments (same rule as deleteSafeTransaction). */
export function clearDeletableSafeTransactions() {
  const d = getDb()
  const r = d.prepare('DELETE FROM safe_transactions WHERE reference_type IS NULL').run()
  return r.changes ?? 0
}

// ----- Account statement -----

/** YYYY-MM-DD from query; avoids SQLite date() quirks on ISO timestamps. */
function normalizeStmtDate(s) {
  if (s == null || typeof s !== 'string') return null
  const t = s.trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

/** Next calendar day as YYYY-MM-DD (UTC). */
function addOneCalendarDay(isoDateStr) {
  const t = normalizeStmtDate(isoDateStr)
  if (!t) return null
  const [y, m, d] = t.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}

function attachInvoiceItems(d, invoices) {
  if (!invoices.length) return
  const ids = invoices.map((i) => i.id)
  const ph = ids.map(() => '?').join(',')
  const items = d
    .prepare(`SELECT invoice_id, product_name, quantity, total_price FROM invoice_items WHERE invoice_id IN (${ph})`)
    .all(...ids)
  const byInvoice = new Map()
  for (const it of items) {
    if (!byInvoice.has(it.invoice_id)) byInvoice.set(it.invoice_id, [])
    byInvoice.get(it.invoice_id).push({
      product_name: it.product_name,
      quantity: it.quantity,
      total_price: it.total_price,
    })
  }
  for (const inv of invoices) {
    inv.items = byInvoice.get(inv.id) || []
  }
}

function computeInvoiceQuantityUnitPrice(items) {
  if (!items || items.length === 0) return { quantity: null, unit_price: null }
  const sumQty = items.reduce((a, it) => a + (Number(it.quantity) || 0), 0)
  if (sumQty <= 0) return { quantity: null, unit_price: null }
  if (items.length === 1) {
    const tp = Number(items[0].total_price) || 0
    const q = Number(items[0].quantity) || 0
    return { quantity: sumQty, unit_price: q > 0 ? tp / q : null }
  }
  return { quantity: sumQty, unit_price: null }
}

function statementDisplayAmount(m) {
  if (m.type === 'invoice') return Number(m.debit || 0)
  return Math.max(
    Number(m.display_debit || 0),
    Number(m.display_credit || 0),
    Number(m.credit || 0),
    Number(m.debit || 0)
  )
}

function formatPaymentDescriptionAr(amount, paymentMethod) {
  const m = String(paymentMethod || '')
  const methodAr =
    m === 'cash'
      ? 'كاش'
      : m === 'deferred'
        ? 'آجل'
        : m === 'vodafone_cash'
          ? 'فودافون كاش'
          : m === 'instapay'
            ? 'انستاباي'
            : m === 'historical_invoice_paid'
              ? 'مدفوع (ترحيل)'
              : m || '—'
  const n = Math.round(Number(amount) || 0)
  const formatted = new Intl.NumberFormat('ar-EG', {
    numberingSystem: 'latn',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
  return `سداد ${formatted} ج.م — ${methodAr}`
}

function buildAccountStatementRows(baseBalance, invoices, payments) {
  const rows = []
  const merged = [
    ...invoices.map((i) => ({
      date: i.created_at,
      type: 'invoice',
      description: `فاتورة #${i.id}`,
      debit: i.total_amount || 0,
      credit: 0,
      display_debit: i.total_amount || 0,
      display_credit: i.paid_amount > 0 ? i.paid_amount : 0,
      invoice_id: i.id,
      invoice_total: i.total_amount ?? 0,
      paid: i.paid_amount ?? 0,
      remaining: i.remaining_amount ?? 0,
      status: i.status ?? '',
      items: i.items || [],
      barn_name: i.barn_name ?? null,
      ledger_skip: false,
    })),
    ...payments.map((p) => {
      const isDef = p.payment_method === 'deferred'
      const settles = paymentAmountTowardArJs(p)
      const amt = p.amount || 0
      const desc = formatPaymentDescriptionAr(amt, p.payment_method)
      return {
        date: p.payment_date || p.created_at,
        type: 'payment',
        description: desc,
        debit: 0,
        credit: settles ? amt : 0,
        display_debit: isDef ? amt : 0,
        display_credit: settles ? amt : 0,
        payment_id: p.id,
        payment_amount: amt,
        payment_method: p.payment_method,
        invoice_id_link: p.invoice_id,
        settled_at: p.settled_at,
        barn_name: p.barn_name ?? null,
        ledger_skip: isDef,
      }
    }),
  ]
  merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  let rowSeq = 0
  let runningBalance = baseBalance
  for (const m of merged) {
    rowSeq += 1
    const amountForRow = statementDisplayAmount(m)
    if (m.type === 'invoice') {
      runningBalance += amountForRow
    } else {
      runningBalance -= amountForRow
    }
    const direction = m.type === 'invoice' ? 'debit' : 'credit'
    const qpu =
      m.type === 'invoice' ? computeInvoiceQuantityUnitPrice(m.items || []) : { quantity: null, unit_price: null }
    const row = {
      id: rowSeq,
      date: m.date,
      type: m.type,
      description: m.description,
      quantity: qpu.quantity,
      unit_price: qpu.unit_price,
      amount: amountForRow,
      direction,
      running_balance: runningBalance,
    }
    if (m.type === 'invoice') {
      row.invoice_id = m.invoice_id
      if (m.items && m.items.length) row.items = m.items
    } else {
      row.payment_id = m.payment_id
      if (m.payment_method) row.payment_method = m.payment_method
      if (m.settled_at) row.settled_at = m.settled_at
    }
    rows.push(row)
  }
  return { rows, closingBalance: runningBalance }
}

export function getAccountStatementClient(clientId, from, to) {
  const d = getDb()
  const fromD = normalizeStmtDate(from)
  const toD = normalizeStmtDate(to)
  const client = d.prepare('SELECT initial_debt FROM clients WHERE id = ?').get(clientId)
  const barns = d.prepare('SELECT COALESCE(SUM(initial_debt), 0) AS sum_barns FROM barns WHERE client_id = ?').get(clientId)
  const initialDebt = (client?.initial_debt ?? 0) + (barns?.sum_barns ?? 0)

  const beforeInvoices = d
    .prepare(
      `SELECT total_amount, created_at FROM invoices WHERE client_id = ? AND (? IS NULL OR substr(created_at, 1, 10) < ?)
       AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')`
    )
    .all(clientId, fromD, fromD)
  const beforePayments = d
    .prepare(
      `SELECT amount, payment_date, created_at, payment_method, invoice_id, notes FROM payments WHERE client_id = ? AND (? IS NULL OR substr(payment_date, 1, 10) < ?)`
    )
    .all(clientId, fromD, fromD)
  const netBefore =
    (beforeInvoices.reduce((a, i) => a + (i.total_amount || 0), 0) ||
      0) -
    (beforePayments.reduce((a, p) => a + (paymentAmountTowardArJs(p) ? p.amount || 0 : 0), 0) || 0)
  const openingBalance = initialDebt + netBefore

  const invoicesInRange = d
    .prepare(
      `SELECT i.id, i.total_amount, i.paid_amount, i.remaining_amount, i.status, i.created_at, b.name AS barn_name
       FROM invoices i
       LEFT JOIN barns b ON b.id = i.barn_id
       WHERE i.client_id = ? AND (? IS NULL OR substr(i.created_at, 1, 10) >= ?) AND (? IS NULL OR substr(i.created_at, 1, 10) <= ?)
         AND (COALESCE(i.invoice_lifecycle, 'active') != 'cancelled')`
    )
    .all(clientId, fromD, fromD, toD, toD)
  attachInvoiceItems(d, invoicesInRange)
  const paymentsInRange = d
    .prepare(
      `SELECT p.id, p.amount, p.payment_date, p.created_at, p.payment_method, p.invoice_id, p.notes, p.settled_at, b.name AS barn_name
       FROM payments p
       LEFT JOIN barns b ON b.id = p.barn_id
       WHERE p.client_id = ? AND (? IS NULL OR substr(p.payment_date, 1, 10) >= ?) AND (? IS NULL OR substr(p.payment_date, 1, 10) <= ?)`
    )
    .all(clientId, fromD, fromD, toD, toD)

  const { rows, closingBalance } = buildAccountStatementRows(
    openingBalance,
    invoicesInRange,
    paymentsInRange
  )

  return {
    opening_balance: openingBalance,
    closing_balance: closingBalance,
    rows,
  }
}

export function getAccountStatementBarn(barnId, from, to) {
  const d = getDb()
  const fromD = normalizeStmtDate(from)
  const toD = normalizeStmtDate(to)
  const barn = d.prepare('SELECT initial_debt FROM barns WHERE id = ?').get(barnId)
  const initialDebt = barn?.initial_debt ?? 0

  const beforeInvoices = d
    .prepare(
      `SELECT total_amount, created_at FROM invoices WHERE barn_id = ? AND (? IS NULL OR substr(created_at, 1, 10) < ?)
       AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')`
    )
    .all(barnId, fromD, fromD)
  const beforePayments = d
    .prepare(
      `SELECT amount, payment_date, created_at, payment_method FROM payments WHERE barn_id = ? AND (? IS NULL OR substr(payment_date, 1, 10) < ?)`
    )
    .all(barnId, fromD, fromD)
  const netBefore =
    (beforeInvoices.reduce((a, i) => a + (i.total_amount || 0), 0) ||
      0) -
    (beforePayments.reduce((a, p) => a + (paymentAmountTowardArJs(p) ? p.amount || 0 : 0), 0) || 0)
  const openingBalance = initialDebt + netBefore

  const invoicesInRange = d
    .prepare(
      `SELECT i.id, i.total_amount, i.paid_amount, i.remaining_amount, i.status, i.created_at, b.name AS barn_name
       FROM invoices i
       LEFT JOIN barns b ON b.id = i.barn_id
       WHERE i.barn_id = ? AND (? IS NULL OR substr(i.created_at, 1, 10) >= ?) AND (? IS NULL OR substr(i.created_at, 1, 10) <= ?)
         AND (COALESCE(i.invoice_lifecycle, 'active') != 'cancelled')`
    )
    .all(barnId, fromD, fromD, toD, toD)
  attachInvoiceItems(d, invoicesInRange)
  const paymentsInRange = d
    .prepare(
      `SELECT p.id, p.amount, p.payment_date, p.created_at, p.payment_method, p.invoice_id, p.notes, p.settled_at, b.name AS barn_name
       FROM payments p
       LEFT JOIN barns b ON b.id = p.barn_id
       WHERE p.barn_id = ? AND (? IS NULL OR substr(p.payment_date, 1, 10) >= ?) AND (? IS NULL OR substr(p.payment_date, 1, 10) <= ?)`
    )
    .all(barnId, fromD, fromD, toD, toD)

  const { rows, closingBalance } = buildAccountStatementRows(
    openingBalance,
    invoicesInRange,
    paymentsInRange
  )

  return {
    opening_balance: openingBalance,
    closing_balance: closingBalance,
    rows,
  }
}

// ----- Client billing cycles -----

export function getClientBillingCycles(clientId) {
  const d = getDb()
  return d
    .prepare(
      'SELECT * FROM client_billing_cycles WHERE client_id = ? ORDER BY id DESC'
    )
    .all(clientId)
}

export function getOpenBillingCycle(clientId) {
  const d = getDb()
  return d
    .prepare(
      'SELECT * FROM client_billing_cycles WHERE client_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
    )
    .get(clientId)
}

export function getBillingCycleById(cycleId) {
  return getDb().prepare('SELECT * FROM client_billing_cycles WHERE id = ?').get(cycleId)
}

/**
 * Start a billing cycle. carry_in defaults to current client balance (unpaid total = opening / "lifetime" debt for this period).
 * Only one open cycle per client.
 */
export function startClientBillingCycle(clientId, { started_at, carry_in } = {}) {
  const d = getDb()
  const existing = d
    .prepare('SELECT id FROM client_billing_cycles WHERE client_id = ? AND ended_at IS NULL')
    .get(clientId)
  if (existing) {
    throw new Error('يوجد دورة محاسبية مفتوحة بالفعل')
  }
  const c = getClientById(clientId)
  if (!c) throw new Error('العميل غير موجود')
  const t = now()
  const start = normalizeStmtDate(started_at) || t.slice(0, 10)
  let carry = carry_in
  if (carry === undefined || carry === null) {
    carry = getClientBalance(clientId) ?? 0
  } else {
    carry = Number(carry) || 0
  }
  d.prepare(`
    INSERT INTO client_billing_cycles (client_id, started_at, ended_at, carry_in, created_at)
    VALUES (?, ?, NULL, ?, ?)
  `).run(clientId, start, carry, t)
  const id = d.prepare('SELECT last_insert_rowid() as id').get().id
  return d.prepare('SELECT * FROM client_billing_cycles WHERE id = ?').get(id)
}

export function endClientBillingCycle(clientId, { ended_at } = {}) {
  const d = getDb()
  const cycle = d
    .prepare(
      'SELECT * FROM client_billing_cycles WHERE client_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
    )
    .get(clientId)
  if (!cycle) {
    throw new Error('لا توجد دورة محاسبية مفتوحة')
  }
  const t = now()
  const end = normalizeStmtDate(ended_at) || t.slice(0, 10)
  const stmt = getAccountStatementForCycle(cycle.id)
  const closing = stmt ? stmt.closing_balance : 0
  d.prepare(
    `
    UPDATE client_billing_cycles
    SET ended_at = ?, carryover_out = ?, closed_at = ?
    WHERE id = ?
  `
  ).run(end, closing, t, cycle.id)
  return d.prepare('SELECT * FROM client_billing_cycles WHERE id = ?').get(cycle.id)
}

/**
 * Statement for one cycle: opening = carry_in; rows = invoices/payments tagged with this cycle.
 * Closing balance = unpaid remaining for the cycle ledger (carries conceptually to next cycle as lifetime debt).
 */
export function getAccountStatementForCycle(cycleId) {
  const d = getDb()
  const cycle = d.prepare('SELECT * FROM client_billing_cycles WHERE id = ?').get(cycleId)
  if (!cycle) return null

  const opening = cycle.carry_in ?? 0
  const invoicesInRange = d
    .prepare(
      `
      SELECT i.id, i.total_amount, i.paid_amount, i.remaining_amount, i.status, i.created_at, b.name AS barn_name
      FROM invoices i
      LEFT JOIN barns b ON b.id = i.barn_id
      WHERE i.billing_cycle_id = ?
        AND (COALESCE(i.invoice_lifecycle, 'active') != 'cancelled')
      ORDER BY i.created_at ASC
    `
    )
    .all(cycleId)
  attachInvoiceItems(d, invoicesInRange)
  const paymentsInRange = d
    .prepare(
      `
      SELECT p.id, p.amount, p.payment_date, p.created_at, p.payment_method, p.invoice_id, p.notes, p.settled_at, b.name AS barn_name
      FROM payments p
      LEFT JOIN barns b ON b.id = p.barn_id
      WHERE p.billing_cycle_id = ?
      ORDER BY p.payment_date ASC, p.created_at ASC
    `
    )
    .all(cycleId)

  const { rows, closingBalance } = buildAccountStatementRows(
    opening,
    invoicesInRange,
    paymentsInRange
  )

  const fromLabel = normalizeStmtDate(cycle.started_at) || cycle.started_at
  const toLabel = cycle.ended_at ? normalizeStmtDate(cycle.ended_at) || cycle.ended_at : 'مفتوحة'

  return {
    opening_balance: opening,
    closing_balance: closingBalance,
    rows,
    cycle: {
      id: cycle.id,
      client_id: cycle.client_id,
      started_at: cycle.started_at,
      ended_at: cycle.ended_at,
      carry_in: opening,
      carryover_out: cycle.carryover_out,
      label: `دورة ${cycle.id} (${fromLabel} — ${toLabel})`,
    },
  }
}

/** Standard client statement from the day after a closed cycle through today (post-cycle period). */
export function getAccountStatementAfterCycle(clientId, cycleId) {
  const d = getDb()
  const cycle = d
    .prepare('SELECT * FROM client_billing_cycles WHERE id = ? AND client_id = ?')
    .get(cycleId, clientId)
  if (!cycle?.ended_at) return null
  const fromD = addOneCalendarDay(cycle.ended_at)
  if (!fromD) return null
  const toD = normalizeStmtDate(now().slice(0, 10)) || now().slice(0, 10)
  const inner = getAccountStatementClient(clientId, fromD, toD)
  return {
    ...inner,
    after_cycle: {
      cycle_id: cycle.id,
      cycle_ended_at: cycle.ended_at,
      from: fromD,
      to: toD,
    },
  }
}

// ----- Barn billing cycles -----

export function getBarnBillingCycles(barnId) {
  return getDb()
    .prepare('SELECT * FROM barn_billing_cycles WHERE barn_id = ? ORDER BY id DESC')
    .all(barnId)
}

export function getOpenBarnBillingCycle(barnId) {
  return getDb()
    .prepare(
      'SELECT * FROM barn_billing_cycles WHERE barn_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
    )
    .get(barnId)
}

export function startBarnBillingCycle(barnId, { started_at, carry_in } = {}) {
  const d = getDb()
  const existing = d.prepare('SELECT id FROM barn_billing_cycles WHERE barn_id = ? AND ended_at IS NULL').get(barnId)
  if (existing) {
    throw new Error('يوجد دورة محاسبية مفتوحة لهذا العنبر')
  }
  const b = getBarnById(barnId)
  if (!b) throw new Error('العنبر غير موجود')
  const t = now()
  const start = normalizeStmtDate(started_at) || t.slice(0, 10)
  let carry = carry_in
  if (carry === undefined || carry === null) {
    carry = getBarnBalance(barnId) ?? 0
  } else {
    carry = Number(carry) || 0
  }
  d.prepare(`
    INSERT INTO barn_billing_cycles (barn_id, started_at, ended_at, carry_in, created_at)
    VALUES (?, ?, NULL, ?, ?)
  `).run(barnId, start, carry, t)
  const id = d.prepare('SELECT last_insert_rowid() as id').get().id
  return d.prepare('SELECT * FROM barn_billing_cycles WHERE id = ?').get(id)
}

export function endBarnBillingCycle(barnId, { ended_at } = {}) {
  const d = getDb()
  const cycle = d
    .prepare(
      'SELECT * FROM barn_billing_cycles WHERE barn_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
    )
    .get(barnId)
  if (!cycle) {
    throw new Error('لا توجد دورة محاسبية مفتوحة')
  }
  const t = now()
  const end = normalizeStmtDate(ended_at) || t.slice(0, 10)
  const stmt = getAccountStatementForBarnCycle(cycle.id)
  const closing = stmt ? stmt.closing_balance : 0
  d.prepare(
    `
    UPDATE barn_billing_cycles
    SET ended_at = ?, carryover_out = ?, closed_at = ?
    WHERE id = ?
  `
  ).run(end, closing, t, cycle.id)
  return d.prepare('SELECT * FROM barn_billing_cycles WHERE id = ?').get(cycle.id)
}

export function getAccountStatementForBarnCycle(cycleId) {
  const d = getDb()
  const cycle = d.prepare('SELECT * FROM barn_billing_cycles WHERE id = ?').get(cycleId)
  if (!cycle) return null

  const opening = cycle.carry_in ?? 0
  const invoicesInRange = d
    .prepare(
      `
      SELECT i.id, i.total_amount, i.paid_amount, i.remaining_amount, i.status, i.created_at, b.name AS barn_name
      FROM invoices i
      LEFT JOIN barns b ON b.id = i.barn_id
      WHERE i.barn_billing_cycle_id = ?
        AND (COALESCE(i.invoice_lifecycle, 'active') != 'cancelled')
      ORDER BY i.created_at ASC
    `
    )
    .all(cycleId)
  attachInvoiceItems(d, invoicesInRange)
  const paymentsInRange = d
    .prepare(
      `
      SELECT p.id, p.amount, p.payment_date, p.created_at, b.name AS barn_name
      FROM payments p
      LEFT JOIN barns b ON b.id = p.barn_id
      WHERE p.barn_billing_cycle_id = ?
      ORDER BY p.payment_date ASC, p.created_at ASC
    `
    )
    .all(cycleId)

  const { rows, closingBalance } = buildAccountStatementRows(
    opening,
    invoicesInRange,
    paymentsInRange
  )

  const fromLabel = normalizeStmtDate(cycle.started_at) || cycle.started_at
  const toLabel = cycle.ended_at ? normalizeStmtDate(cycle.ended_at) || cycle.ended_at : 'مفتوحة'

  return {
    opening_balance: opening,
    closing_balance: closingBalance,
    rows,
    cycle: {
      id: cycle.id,
      barn_id: cycle.barn_id,
      started_at: cycle.started_at,
      ended_at: cycle.ended_at,
      carry_in: opening,
      carryover_out: cycle.carryover_out,
      label: `دورة ${cycle.id} (${fromLabel} — ${toLabel})`,
    },
  }
}

export function getAccountStatementAfterBarnCycle(barnId, cycleId) {
  const d = getDb()
  const cycle = d.prepare('SELECT * FROM barn_billing_cycles WHERE id = ? AND barn_id = ?').get(cycleId, barnId)
  if (!cycle?.ended_at) return null
  const fromD = addOneCalendarDay(cycle.ended_at)
  if (!fromD) return null
  const toD = normalizeStmtDate(now().slice(0, 10)) || now().slice(0, 10)
  const inner = getAccountStatementBarn(barnId, fromD, toD)
  return {
    ...inner,
    after_cycle: {
      cycle_id: cycle.id,
      cycle_ended_at: cycle.ended_at,
      from: fromD,
      to: toD,
    },
  }
}

// ----- Dashboard -----
/** @param {{ from?: string; to?: string }} [opts] When from+to set (YYYY-MM-DD), sales/profit sums are date-scoped. */
export function getDashboardStats(opts = {}) {
  const d = getDb()
  const from = opts.from && /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from).slice(0, 10)) ? String(opts.from).slice(0, 10) : null
  const to = opts.to && /^\d{4}-\d{2}-\d{2}$/.test(String(opts.to).slice(0, 10)) ? String(opts.to).slice(0, 10) : null
  const range = from && to
  const salesWhere = range
    ? `WHERE (COALESCE(invoice_lifecycle, 'active') != 'cancelled') AND date(created_at) >= date(?) AND date(created_at) <= date(?)`
    : `WHERE (COALESCE(invoice_lifecycle, 'active') != 'cancelled')`
  const salesParams = range ? [from, to] : []
  const totalSales = d.prepare(`SELECT COALESCE(SUM(total_amount),0) as s FROM invoices ${salesWhere}`).get(...salesParams)?.s ?? 0
  const totalProfit = d.prepare(`SELECT COALESCE(SUM(profit_amount),0) as s FROM invoices ${salesWhere}`).get(...salesParams)?.s ?? 0
  const unpaidCount = d.prepare(`SELECT COUNT(*) as n FROM invoices WHERE remaining_amount > 0 AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')`).get()?.n ?? 0
  const clientDebt = (() => {
    const debts = d.prepare('SELECT COALESCE(SUM(initial_debt),0) as s FROM clients').get()?.s ?? 0
    const invTotals = d.prepare(`SELECT COALESCE(SUM(total_amount),0) as s FROM invoices WHERE (COALESCE(invoice_lifecycle, 'active') != 'cancelled')`).get()?.s ?? 0
    const clientPayments =
      d
        .prepare(
          `SELECT COALESCE(SUM(${sqlPaymentAmountTowardArExpr('')}),0) as s FROM payments`
        )
        .get()?.s ?? 0
    return Math.max(0, debts + invTotals - clientPayments)
  })()
  const totalDeferredReceivable =
    d
      .prepare(
        `SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE payment_method = 'deferred' AND settled_at IS NULL`
      )
      .get()?.s ?? 0
  const purchases = d.prepare('SELECT COALESCE(SUM(total_amount),0) as s FROM supplier_purchases').get()?.s ?? 0
  const supplierPayments = d.prepare('SELECT COALESCE(SUM(amount),0) as s FROM supplier_payments').get()?.s ?? 0
  const safeBalance = getSafeBalance()
  // Find primary warehouse (اجهور) for scoped KPIs
  const primaryWh = d.prepare(
    "SELECT id FROM warehouses WHERE name_ar LIKE '%اجهور%' OR name_ar LIKE '%أجهور%' OR LOWER(name_en) LIKE '%aghour%' LIMIT 1"
  ).get()
  const primaryWhId = primaryWh?.id ?? 1
  const productCount = d.prepare(
    'SELECT COUNT(*) as n FROM product_warehouse_stock WHERE warehouse_id = ? AND COALESCE(quantity,0) > 0'
  ).get(primaryWhId)?.n ?? 0
  const clientsCount = d.prepare('SELECT COUNT(*) as n FROM clients').get()?.n ?? 0
  const invoicesCount = d.prepare(`SELECT COUNT(*) as n FROM invoices WHERE (COALESCE(invoice_lifecycle, 'active') != 'cancelled')`).get()?.n ?? 0
  let lowStockCount = 0
  let expiringCount = 0
  let inventoryValuePurchase = 0
  let inventoryValueSelling = 0
  try {
    lowStockCount =
      d
        .prepare(
          `
      SELECT COUNT(*) AS n FROM (
        SELECT p.id
        FROM products p
        JOIN product_warehouse_stock s ON s.product_id = p.id AND s.warehouse_id = ?
        WHERE (
          (COALESCE(p.unit_type, 'piece') != 'bulk' AND p.alert_level > 0 AND COALESCE(s.quantity, 0) <= p.alert_level)
          OR (p.unit_type = 'bulk' AND COALESCE(p.alert_level_kg, 0) > 0 AND COALESCE(s.quantity, 0) <= p.alert_level_kg)
        )
      )
    `
        )
        .get(primaryWhId)?.n ?? 0
  } catch (_) { /* ignore */ }
  try {
    const batchNear = sqlNearExpiryBatchExists(primaryWhId)
    expiringCount =
      d
        .prepare(
          `
      SELECT COUNT(*) AS n FROM products p
      WHERE (
        (p.expiry_date IS NOT NULL
          AND date(p.expiry_date) >= date('now')
          AND date(p.expiry_date) <= date('now', '+90 days'))
        OR ${batchNear}
      )
    `
        )
        .get(primaryWhId)?.n ?? 0
  } catch (_) { /* ignore */ }
  try {
    const invRow = d.prepare(`
      SELECT
        COALESCE(SUM(
          CASE WHEN COALESCE(pb.unit_type, 'piece') = 'bulk'
            THEN COALESCE(pb.kg_remaining, 0) * COALESCE(pb.purchase_price, p.purchase_price, 0)
            ELSE COALESCE(pb.quantity, 0) * COALESCE(pb.purchase_price, p.purchase_price, 0)
          END
        ), 0) AS inv_purchase,
        COALESCE(SUM(
          CASE WHEN COALESCE(pb.unit_type, 'piece') = 'bulk'
            THEN COALESCE(pb.kg_remaining, 0) * COALESCE(pb.selling_price, p.selling_price, 0)
            ELSE COALESCE(pb.quantity, 0) * COALESCE(pb.selling_price, p.selling_price, 0)
          END
        ), 0) AS inv_selling
      FROM product_batches pb
      JOIN products p ON p.id = pb.product_id
      WHERE pb.warehouse_id = ?
    `).get(primaryWhId)
    inventoryValuePurchase = invRow?.inv_purchase ?? 0
    inventoryValueSelling = invRow?.inv_selling ?? 0
  } catch (_) { /* ignore */ }
  return {
    total_sales: totalSales,
    total_profit: totalProfit,
    client_debt: clientDebt,
    total_deferred_receivable: totalDeferredReceivable,
    safe_balance: safeBalance,
    supplier_payable: Math.max(0, purchases - supplierPayments),
    product_count: productCount,
    low_stock_count: lowStockCount,
    expiring_count: expiringCount,
    unpaid_invoices_count: unpaidCount,
    clients_count: clientsCount,
    invoices_count: invoicesCount,
    inventory_value_purchase: inventoryValuePurchase,
    inventory_value_selling: inventoryValueSelling,
  }
}

// ----- Reports: by category & top products -----

/**
 * Sales aggregated by product category within optional date range.
 * Returns [{ category, total_sales, total_quantity }]
 */
export function getSalesByCategory(from, to) {
  const d = getDb()
  let sql = `
    SELECT
      COALESCE(p.category, 'غير محددة') AS category,
      COALESCE(SUM(ii.total_price), 0)   AS total_sales,
      COALESCE(SUM(ii.quantity), 0)      AS total_quantity
    FROM invoice_items ii
    JOIN invoices inv ON inv.id = ii.invoice_id
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE (COALESCE(inv.invoice_lifecycle, 'active') != 'cancelled')
  `
  const params = []
  if (from) {
    sql += ' AND inv.created_at >= ?'
    params.push(from)
  }
  if (to) {
    sql += ' AND inv.created_at <= ?'
    params.push(to)
  }
  sql += ' GROUP BY category ORDER BY total_sales DESC'
  const rows = d.prepare(sql).all(...params)
  return rows.map(r => ({
    category: r.category,
    total_sales: r.total_sales ?? 0,
    total_quantity: r.total_quantity ?? 0,
  }))
}

/**
 * Top products by sales amount within optional date range.
 * Returns [{ product_id, name, total_sales, total_quantity }]
 */
export function getTopProducts(from, to, limit = 10, warehouseId = null) {
  const d = getDb()
  let sql = `
    SELECT
      COALESCE(ii.product_id, 0)        AS product_id,
      COALESCE(p.name, ii.product_name) AS name,
      COALESCE(SUM(ii.total_price), 0)  AS total_sales,
      COALESCE(SUM(ii.quantity), 0)     AS total_quantity
    FROM invoice_items ii
    JOIN invoices inv ON inv.id = ii.invoice_id
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE (COALESCE(inv.invoice_lifecycle, 'active') != 'cancelled')
  `
  const params = []
  if (from) {
    sql += ' AND inv.created_at >= ?'
    params.push(from)
  }
  if (to) {
    sql += ' AND inv.created_at <= ?'
    params.push(to)
  }
  if (warehouseId != null && warehouseId !== '') {
    const wid = parseInt(String(warehouseId), 10)
    if (Number.isFinite(wid)) {
      sql += ' AND inv.warehouse_id = ?'
      params.push(wid)
    }
  }
  sql += ' GROUP BY product_id, name ORDER BY total_sales DESC LIMIT ?'
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 500)
  params.push(lim)
  const rows = d.prepare(sql).all(...params)
  return rows.map(r => ({
    product_id: r.product_id,
    name: r.name,
    total_sales: r.total_sales ?? 0,
    total_quantity: r.total_quantity ?? 0,
  }))
}

/**
 * Daily invoice totals for the last `days` calendar days (SQLite date()).
 * Fills missing days with zero so charts can render a continuous series.
 */
export function getDailyInvoiceTotals(days = 30) {
  const d = getDb()
  const n = Math.min(Math.max(1, days), 90)
  const rows = d
    .prepare(
      `
    WITH RECURSIVE seq(i) AS (
      SELECT 0
      UNION ALL
      SELECT i + 1 FROM seq WHERE i < ? - 1
    )
    SELECT
      date('now', '-' || (? - 1 - seq.i) || ' days') AS day,
      COALESCE((
        SELECT SUM(total_amount) FROM invoices
        WHERE date(created_at) = date('now', '-' || (? - 1 - seq.i) || ' days')
          AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')
      ), 0) AS total_sales,
      COALESCE((
        SELECT COUNT(*) FROM invoices
        WHERE date(created_at) = date('now', '-' || (? - 1 - seq.i) || ' days')
          AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')
      ), 0) AS invoice_count
    FROM seq
    ORDER BY day ASC
  `
    )
    .all(n, n, n, n)
  return rows.map((r) => ({
    day: r.day,
    total_sales: r.total_sales ?? 0,
    invoice_count: r.invoice_count ?? 0,
  }))
}

/**
 * Daily invoice totals between two calendar dates (YYYY-MM-DD), inclusive.
 */
export function getDailyInvoiceTotalsForRange(fromIso, toIso) {
  const d = getDb()
  if (!fromIso || !toIso) return []
  const start = fromIso <= toIso ? fromIso : toIso
  const end = fromIso <= toIso ? toIso : fromIso
  const rows = d
    .prepare(
      `
    WITH RECURSIVE days(d) AS (
      SELECT date(?)
      UNION ALL
      SELECT date(d, '+1 day') FROM days WHERE d < date(?)
    )
    SELECT
      days.d AS day,
      COALESCE((
        SELECT SUM(total_amount) FROM invoices WHERE date(created_at) = days.d
          AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')
      ), 0) AS total_sales,
      COALESCE((
        SELECT COUNT(*) FROM invoices WHERE date(created_at) = days.d
          AND (COALESCE(invoice_lifecycle, 'active') != 'cancelled')
      ), 0) AS invoice_count
    FROM days
    ORDER BY day ASC
  `
    )
    .all(start, end)
  return rows.map((r) => ({
    day: r.day,
    total_sales: r.total_sales ?? 0,
    invoice_count: r.invoice_count ?? 0,
  }))
}

/**
 * Transfer inventory between warehouses (e.g. اجهور → شبرا).
 * Validates stock, deducts from source batches (LIFO: newest batch first),
 * creates matching batches in the target warehouse, and updates product_warehouse_stock.
 */
export function createInventoryTransfer(data) {
  const d = getDb()
  const fromWh = Number(data.from_warehouse_id)
  const toWh = Number(data.to_warehouse_id)
  const items = Array.isArray(data.items) ? data.items : []
  const t = now()

  const transfer = d.transaction(() => {
    for (const it of items) {
      const pid = Number(it.product_id)
      const qty = Number(it.quantity ?? 0)
      if (!Number.isFinite(pid) || !Number.isFinite(qty) || qty <= 0) {
        throw new Error(`كمية غير صالحة للمنتج #${pid}`)
      }
      // Validate stock
      const stockRow = d.prepare(
        'SELECT COALESCE(quantity, 0) AS qty FROM product_warehouse_stock WHERE product_id = ? AND warehouse_id = ?'
      ).get(pid, fromWh)
      const available = Number(stockRow?.qty ?? 0)
      if (qty > available) {
        const pRow = d.prepare('SELECT name FROM products WHERE id = ?').get(pid)
        const name = pRow?.name ?? `#${pid}`
        throw new Error(`الكمية المطلوبة (${qty}) للمنتج «${name}» أكبر من المتاح (${available})`)
      }

      // ── Deduct from source batches (LIFO: newest batch first by id DESC) ──
      const sourceBatches = d.prepare(
        `SELECT * FROM product_batches
         WHERE product_id = ? AND warehouse_id = ? AND COALESCE(quantity, 0) > 0
         ORDER BY id DESC`
      ).all(pid, fromWh)
      let remaining = qty
      for (const batch of sourceBatches) {
        if (remaining <= 0) break
        const batchQty = Number(batch.quantity ?? 0)
        const take = Math.min(remaining, batchQty)
        if (take <= 0) continue

        // Subtract from source batch
        d.prepare(
          'UPDATE product_batches SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE id = ?'
        ).run(take, t, batch.id)

        // Create or update matching batch in target warehouse
        const existingTarget = d.prepare(
          `SELECT id, quantity FROM product_batches
           WHERE product_id = ? AND warehouse_id = ? AND expiry_date = ?
             AND COALESCE(purchase_price, 0) = COALESCE(?, 0)
             AND COALESCE(selling_price, 0) = COALESCE(?, 0)
           LIMIT 1`
        ).get(pid, toWh, batch.expiry_date, batch.purchase_price, batch.selling_price)

        if (existingTarget) {
          d.prepare(
            'UPDATE product_batches SET quantity = quantity + ?, updated_at = ? WHERE id = ?'
          ).run(take, t, existingTarget.id)
        } else {
          d.prepare(
            `INSERT INTO product_batches
             (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price,
              unit_type, bag_count, kg_per_bag, kg_remaining, source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'transfer', ?, ?)`
          ).run(
            pid, toWh, batch.expiry_date, take,
            batch.purchase_price ?? null, batch.selling_price ?? null,
            batch.unit_type ?? 'piece', null, batch.kg_per_bag ?? null, null,
            t, t
          )
        }
        remaining -= take
      }

      // ── Update product_warehouse_stock for both warehouses ──
      // Subtract from source
      d.prepare(
        `UPDATE product_warehouse_stock SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE product_id = ? AND warehouse_id = ?`
      ).run(qty, t, pid, fromWh)
      // Add to target (upsert)
      const existing = d.prepare(
        'SELECT 1 FROM product_warehouse_stock WHERE product_id = ? AND warehouse_id = ?'
      ).get(pid, toWh)
      if (existing) {
        d.prepare(
          'UPDATE product_warehouse_stock SET quantity = quantity + ?, updated_at = ? WHERE product_id = ? AND warehouse_id = ?'
        ).run(qty, t, pid, toWh)
      } else {
        d.prepare(
          'INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at) VALUES (?, ?, ?, ?)'
        ).run(pid, toWh, qty, t)
      }
    }

    // ── Persist transfer log ──
    d.prepare(
      'INSERT INTO inventory_transfers (from_warehouse_id, to_warehouse_id, notes, created_at) VALUES (?, ?, ?, ?)'
    ).run(fromWh, toWh, data.notes ?? null, t)
    const transferId = d.prepare('SELECT last_insert_rowid() as id').get().id
    for (const it of items) {
      const pid = Number(it.product_id)
      const qty = Number(it.quantity ?? 0)
      const pRow = d.prepare('SELECT name FROM products WHERE id = ?').get(pid)
      d.prepare(
        'INSERT INTO inventory_transfer_items (transfer_id, product_id, product_name, quantity) VALUES (?, ?, ?, ?)'
      ).run(transferId, pid, pRow?.name ?? `#${pid}`, qty)
    }
  })

  transfer()
}

/**
 * List transfer history. Returns transfers with their items, newest first.
 */
export function getInventoryTransfers(limit = 50) {
  const d = getDb()
  const transfers = d.prepare(`
    SELECT t.*,
      wf.name_ar AS from_warehouse_name,
      wt.name_ar AS to_warehouse_name
    FROM inventory_transfers t
    LEFT JOIN warehouses wf ON wf.id = t.from_warehouse_id
    LEFT JOIN warehouses wt ON wt.id = t.to_warehouse_id
    ORDER BY t.id DESC
    LIMIT ?
  `).all(Math.min(limit, 200))

  const ids = transfers.map((t) => t.id)
  if (ids.length === 0) return []

  const ph = ids.map(() => '?').join(',')
  const itemRows = d.prepare(
    `SELECT * FROM inventory_transfer_items WHERE transfer_id IN (${ph}) ORDER BY id`
  ).all(...ids)

  const itemsByTransfer = {}
  for (const item of itemRows) {
    if (!itemsByTransfer[item.transfer_id]) itemsByTransfer[item.transfer_id] = []
    itemsByTransfer[item.transfer_id].push(item)
  }

  return transfers.map((t) => ({
    ...t,
    items: itemsByTransfer[t.id] ?? [],
  }))
}
