import 'dotenv/config'
/**
 * PostgreSQL-backed data layer for Vet Pharmacy Dashboard.
 *
 * NOTE:
 * - Core auth/settings/master-data reads are implemented natively with pg.
 * - Remaining complex business flows are temporarily delegated to sqlite db.js
 *   while parity migration is completed.
 */
import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg

const connectionString = process.env.DB_URL || process.env.SUPABASE_DB_URL
if (!connectionString) {
  throw new Error('DB_URL is required for PostgreSQL backend')
}

const pool = new Pool({ connectionString })
export const dbPath = 'postgresql'

function nowIso() {
  return new Date().toISOString()
}

const MAX_PRODUCT_IMAGE_URL_LEN = 800_000
function assertProductImageUrlField(v) {
  if (v == null || v === '') return
  if (typeof v !== 'string') throw new Error('صورة المنتج غير صالحة')
  if (v.length > MAX_PRODUCT_IMAGE_URL_LEN) {
    throw new Error('صورة المنتج كبيرة جداً — قلّل الحجم وحاول مجدداً')
  }
}

function toPublicUser(r) {
  if (!r) return null
  return {
    id: String(r.id),
    email: r.email,
    display_name: r.display_name,
    role: r.role,
    is_active: !!r.is_active,
  }
}

export async function countUsers() {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM users')
  return r.rows[0]?.n ?? 0
}

export async function getUserByEmail(email) {
  const r = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1', [
    String(email || '').trim(),
  ])
  return r.rows[0] ?? null
}

export async function getUserById(id) {
  const r = await pool.query('SELECT * FROM users WHERE id = $1', [id])
  return r.rows[0] ?? null
}

export async function getUserPublic(id) {
  return toPublicUser(await getUserById(id))
}

export async function verifyUserPassword(email, plainPassword) {
  const row = await getUserByEmail(email)
  if (!row || !row.is_active) return null
  if (!bcrypt.compareSync(String(plainPassword || ''), row.password_hash)) return null
  return toPublicUser(row)
}

export async function createUser({ email, password, display_name, role }) {
  const password_hash = bcrypt.hashSync(password, 12)
  const r = await pool.query(
    `
      INSERT INTO users (email, password_hash, display_name, role, is_active, created_at, updated_at)
      VALUES (lower(trim($1)), $2, $3, $4, true, NOW(), NOW())
      RETURNING id
    `,
    [email, password_hash, display_name || '', role || 'staff']
  )
  return getUserPublic(r.rows[0].id)
}

export async function listUsersPublic() {
  const r = await pool.query(
    'SELECT id, email, display_name, role, is_active FROM users ORDER BY id'
  )
  return r.rows.map(toPublicUser)
}

export async function countActiveSuperAdmins() {
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM users WHERE role = 'super_admin' AND is_active = true"
  )
  return r.rows[0]?.n ?? 0
}

export async function updateUser(id, data) {
  const existing = await getUserById(id)
  if (!existing) return null
  const updates = []
  const vals = []
  let idx = 1
  if (data.display_name !== undefined) {
    updates.push(`display_name = $${idx++}`)
    vals.push(data.display_name ?? '')
  }
  if (data.role !== undefined) {
    updates.push(`role = $${idx++}`)
    vals.push(data.role)
  }
  if (data.is_active !== undefined) {
    updates.push(`is_active = $${idx++}`)
    vals.push(!!data.is_active)
  }
  if (data.password !== undefined && String(data.password).length > 0) {
    updates.push(`password_hash = $${idx++}`)
    vals.push(bcrypt.hashSync(String(data.password), 12))
  }
  if (updates.length === 0) return getUserPublic(id)
  vals.push(id)
  await pool.query(
    `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
    vals
  )
  return getUserPublic(id)
}

export async function deleteUser(id) {
  const r = await pool.query('DELETE FROM users WHERE id = $1', [id])
  return r.rowCount > 0
}

export async function getWarehouses() {
  const r = await pool.query(
    'SELECT id, name_ar, name_en, is_active FROM warehouses WHERE is_active = true'
  )
  return r.rows.map((x) => ({ ...x, is_active: !!x.is_active }))
}

export async function getSetting(key) {
  const r = await pool.query(
    `
      SELECT value FROM settings WHERE key = $1
      UNION ALL
      SELECT value FROM app_settings WHERE key = $1
      LIMIT 1
    `,
    [key]
  )
  return r.rows[0]?.value ?? null
}

export async function setSetting(key, value) {
  await pool.query(
    `
      INSERT INTO settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [String(key), String(value)]
  )
}

export async function getAllSettings() {
  const r = await pool.query('SELECT key, value FROM settings')
  const out = {}
  for (const row of r.rows) out[row.key] = row.value
  return out
}

export async function getCategoryOptions() {
  const r1 = await pool.query(
    "SELECT DISTINCT name_ar AS value FROM categories WHERE name_ar IS NOT NULL AND name_ar <> ''"
  )
  const r2 = await pool.query(
    "SELECT DISTINCT category AS value FROM products WHERE category IS NOT NULL AND category <> ''"
  )
  const set = new Set([...r1.rows, ...r2.rows].map((r) => r.value))
  return [...set].sort((a, b) => String(a).localeCompare(String(b)))
}

export async function createCategory(name_ar) {
  const n = String(name_ar || '').trim() || 'فئة'
  const r = await pool.query('INSERT INTO categories (name_ar) VALUES ($1) RETURNING id', [n])
  return { id: r.rows[0].id, name_ar: n }
}

export async function getProductById(id) {
  const r = await pool.query('SELECT * FROM products WHERE id = $1', [id])
  return r.rows[0] ?? null
}

export async function getProductByBarcode(barcode) {
  const raw = String(barcode ?? '').trim()
  const r = await pool.query('SELECT * FROM products WHERE barcode = $1 LIMIT 1', [raw])
  return r.rows[0] ?? null
}

export async function getProductCount() {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM products')
  return r.rows[0]?.n ?? 0
}

export async function getCategoryCount() {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM categories')
  return r.rows[0]?.n ?? 0
}

export async function getAllProductNames() {
  const r = await pool.query('SELECT name FROM products')
  return r.rows.map((x) => x.name)
}

function buildProductsFilterWhere({ search, category, warehouseId = null, lowStock = false, unpriced = false, expiring = false }) {
  const clauses = []
  const params = []
  let idx = 1

  if (lowStock) {
    if (warehouseId != null && Number.isInteger(warehouseId)) {
      clauses.push(`(
        (COALESCE(p.unit_type, 'piece') != 'bulk' AND COALESCE(p.alert_level,0) > 0 AND COALESCE(pws.quantity,0) <= COALESCE(p.alert_level,0))
        OR
        (p.unit_type = 'bulk' AND COALESCE(p.alert_level_kg,0) > 0 AND COALESCE(pws.quantity,0) <= COALESCE(p.alert_level_kg,0))
      )`)
    } else {
      clauses.push(`(
        (COALESCE(p.unit_type, 'piece') != 'bulk' AND COALESCE(p.alert_level,0) > 0 AND COALESCE(s.q,0) <= COALESCE(p.alert_level,0))
        OR
        (p.unit_type = 'bulk' AND COALESCE(p.alert_level_kg,0) > 0 AND COALESCE(s.q,0) <= COALESCE(p.alert_level_kg,0))
      )`)
    }
  } else if (unpriced) {
    clauses.push('(p.selling_price IS NULL OR p.selling_price <= 0)')
  } else if (expiring) {
    const expClause = `(
      (
        p.expiry_date IS NOT NULL
        AND p.expiry_date >= CURRENT_DATE
        AND p.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
      )
      OR EXISTS (
        SELECT 1 FROM product_batches pbx
        WHERE pbx.product_id = p.id
          ${warehouseId != null && Number.isInteger(warehouseId) ? 'AND pbx.warehouse_id = pws.warehouse_id' : ''}
          AND pbx.expiry_date IS NOT NULL
          AND pbx.expiry_date != DATE '9999-12-31'
          AND pbx.expiry_date >= CURRENT_DATE
          AND pbx.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
          AND (
            (COALESCE(pbx.unit_type, 'piece') = 'bulk' AND COALESCE(pbx.kg_remaining, 0) > 0)
            OR (COALESCE(pbx.unit_type, 'piece') != 'bulk' AND COALESCE(pbx.quantity, 0) > 0)
          )
      )
    )`
    clauses.push(expClause)
  }

  if (search) {
    clauses.push(`LOWER(p.name) LIKE $${idx}`)
    params.push(`%${String(search).toLowerCase()}%`)
    idx += 1
  }
  if (category) {
    clauses.push(`p.category = $${idx}`)
    params.push(category)
    idx += 1
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params, nextIndex: idx }
}

export async function getProductCountFiltered(
  search,
  category,
  warehouseId = null,
  lowStock = false,
  unpriced = false,
  expiring = false
) {
  const whOk = warehouseId != null && Number.isInteger(warehouseId)
  const joins = whOk
    ? 'LEFT JOIN product_warehouse_stock pws ON pws.product_id = p.id AND pws.warehouse_id = $1'
    : 'LEFT JOIN (SELECT product_id, SUM(quantity) AS q FROM product_warehouse_stock GROUP BY product_id) s ON s.product_id = p.id'
  const filter = buildProductsFilterWhere({
    search,
    category,
    warehouseId: whOk ? warehouseId : null,
    lowStock,
    unpriced,
    expiring,
  })
  const params = whOk ? [warehouseId, ...filter.params] : [...filter.params]
  const q = await pool.query(
    `
      SELECT COUNT(*)::int AS n
      FROM products p
      ${joins}
      ${filter.where}
    `,
    params
  )
  return q.rows[0]?.n ?? 0
}

export async function getProducts(
  search,
  category,
  limit = 100,
  offset = 0,
  warehouseId = null,
  lowStock = false,
  unpriced = false,
  expiring = false
) {
  const whOk = warehouseId != null && Number.isInteger(warehouseId)
  const joins = whOk
    ? `
      LEFT JOIN product_warehouse_stock pws ON pws.product_id = p.id AND pws.warehouse_id = $1
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
          MAX(CASE WHEN bi.status = 'open' AND bi.kg_total > 0.001 AND (bi.kg_remaining / bi.kg_total) < 0.2 THEN 1 ELSE 0 END) AS bulk_open_bag_low
        FROM bag_instances bi
        WHERE bi.status != 'empty'
        GROUP BY bi.product_id
      ) bgi ON bgi.product_id = p.id
    `
    : `
      LEFT JOIN (SELECT product_id, SUM(quantity) AS q FROM product_warehouse_stock GROUP BY product_id) s ON s.product_id = p.id
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
          MAX(CASE WHEN bi.status = 'open' AND bi.kg_total > 0.001 AND (bi.kg_remaining / bi.kg_total) < 0.2 THEN 1 ELSE 0 END) AS bulk_open_bag_low
        FROM bag_instances bi
        WHERE bi.status != 'empty'
        GROUP BY bi.product_id
      ) bgi ON bgi.product_id = p.id
    `

  const filter = buildProductsFilterWhere({
    search,
    category,
    warehouseId: whOk ? warehouseId : null,
    lowStock,
    unpriced,
    expiring,
  })
  const lim = Math.min(Number(limit) || 100, 500)
  const off = Math.max(0, Number(offset) || 0)
  const params = whOk
    ? [warehouseId, ...filter.params, lim, off]
    : [...filter.params, lim, off]
  const q = await pool.query(
    `
      SELECT p.*,
        ba.purchase_price_min, ba.purchase_price_max, ba.selling_price_min, ba.selling_price_max, ba.batch_total_quantity,
        bgi.bulk_bag_count, bgi.bulk_open_bag_low
      FROM products p
      ${joins}
      ${filter.where}
      ORDER BY p.id DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
    params
  )
  return q.rows.map((r) => ({
    ...r,
    bulk_open_bag_low: !!r.bulk_open_bag_low,
  }))
}

export async function getWarehouseStockMap(warehouseId) {
  const r = await pool.query(
    `
      SELECT product_id, quantity
      FROM product_warehouse_stock
      WHERE warehouse_id = $1
    `,
    [warehouseId]
  )
  const map = {}
  for (const row of r.rows) map[row.product_id] = Number(row.quantity ?? 0)
  return map
}

export async function getProductsWithStockInWarehouse(warehouseId) {
  const r = await pool.query(
    `
      SELECT
        pws.product_id,
        pws.quantity,
        p.name, p.company, p.category, p.barcode, p.unit_type, p.bag_weight_kg,
        p.purchase_price, p.selling_price, p.alert_level, p.alert_level_kg,
        p.expiry_date, p.image_url, p.notes, p.created_at, p.updated_at
      FROM product_warehouse_stock pws
      JOIN products p ON p.id = pws.product_id
      WHERE pws.warehouse_id = $1 AND pws.quantity > 0
      ORDER BY p.name
    `,
    [warehouseId]
  )
  return r.rows.map((x) => ({
    product: {
      id: x.product_id,
      name: x.name,
      company: x.company,
      category: x.category,
      barcode: x.barcode,
      unit_type: x.unit_type,
      bag_weight_kg: x.bag_weight_kg,
      purchase_price: x.purchase_price,
      selling_price: x.selling_price,
      alert_level: x.alert_level,
      alert_level_kg: x.alert_level_kg,
      expiry_date: x.expiry_date,
      image_url: x.image_url,
      notes: x.notes,
      created_at: x.created_at,
      updated_at: x.updated_at,
    },
    stock: Number(x.quantity ?? 0),
  }))
}

export async function getProductsInWarehouse(warehouseId) {
  const r = await pool.query(
    `
      SELECT
        p.id AS product_id,
        COALESCE(pws.quantity, 0) AS quantity,
        p.name, p.company, p.category, p.barcode, p.unit_type, p.bag_weight_kg,
        p.purchase_price, p.selling_price, p.alert_level, p.alert_level_kg,
        p.expiry_date, p.image_url, p.notes, p.created_at, p.updated_at
      FROM products p
      LEFT JOIN product_warehouse_stock pws
        ON pws.product_id = p.id AND pws.warehouse_id = $1
      ORDER BY p.name
    `,
    [warehouseId]
  )
  return r.rows.map((x) => ({
    product: {
      id: x.product_id,
      name: x.name,
      company: x.company,
      category: x.category,
      barcode: x.barcode,
      unit_type: x.unit_type,
      bag_weight_kg: x.bag_weight_kg,
      purchase_price: x.purchase_price,
      selling_price: x.selling_price,
      alert_level: x.alert_level,
      alert_level_kg: x.alert_level_kg,
      expiry_date: x.expiry_date,
      image_url: x.image_url,
      notes: x.notes,
      created_at: x.created_at,
      updated_at: x.updated_at,
    },
    stock: Number(x.quantity ?? 0),
  }))
}

export async function getBatchesByWarehouse(warehouseId) {
  const r = await pool.query(
    `
      SELECT *
      FROM product_batches
      WHERE warehouse_id = $1
        AND (
          (COALESCE(unit_type, 'piece') = 'bulk' AND COALESCE(kg_remaining,0) > 0)
          OR (COALESCE(unit_type, 'piece') != 'bulk' AND COALESCE(quantity,0) > 0)
        )
      ORDER BY product_id, expiry_date ASC
    `,
    [warehouseId]
  )
  return r.rows
}

export async function updateBatchPrice(batchId, sellingPrice) {
  await pool.query(
    'UPDATE product_batches SET selling_price = $1, updated_at = NOW() WHERE id = $2',
    [sellingPrice, batchId]
  )
  const r = await pool.query('SELECT * FROM product_batches WHERE id = $1', [batchId])
  return r.rows[0] ?? null
}

export async function getProductStock(productId) {
  const wh = await pool.query('SELECT id FROM warehouses WHERE is_active = true')
  const rows = await pool.query(
    `
      SELECT product_id, warehouse_id, quantity, updated_at
      FROM product_warehouse_stock
      WHERE product_id = $1
    `,
    [productId]
  )
  const byWh = Object.fromEntries(rows.rows.map((r) => [r.warehouse_id, r]))
  const now = nowIso()
  return wh.rows.map((w) => {
    const r = byWh[w.id]
    return {
      product_id: Number(productId),
      warehouse_id: w.id,
      quantity: r ? Number(r.quantity ?? 0) : 0,
      updated_at: r ? r.updated_at : now,
    }
  })
}

export async function getBagsForProduct(productId, warehouseId = null) {
  const r = warehouseId
    ? await pool.query(
        `
          SELECT b.*, pb.purchase_price, pb.selling_price
          FROM bag_instances b
          LEFT JOIN product_batches pb ON pb.id = b.batch_id
          WHERE b.product_id = $1 AND b.warehouse_id = $2
          ORDER BY
            CASE WHEN b.status = 'open' THEN 1 WHEN b.status = 'sealed' THEN 2 ELSE 3 END,
            b.expiry_date ASC NULLS LAST, b.id ASC
        `,
        [productId, warehouseId]
      )
    : await pool.query(
        `
          SELECT b.*, pb.purchase_price, pb.selling_price, w.name_ar AS warehouse_name_ar
          FROM bag_instances b
          LEFT JOIN product_batches pb ON pb.id = b.batch_id
          LEFT JOIN warehouses w ON w.id = b.warehouse_id
          WHERE b.product_id = $1
          ORDER BY
            CASE WHEN b.status = 'open' THEN 1 WHEN b.status = 'sealed' THEN 2 ELSE 3 END,
            b.expiry_date ASC NULLS LAST, b.id ASC
        `,
        [productId]
      )
  return r.rows
}

export async function getBagInstanceById(bagId) {
  const r = await pool.query(
    `
      SELECT b.*, pb.purchase_price, pb.selling_price, w.name_ar AS warehouse_name_ar
      FROM bag_instances b
      LEFT JOIN product_batches pb ON pb.id = b.batch_id
      LEFT JOIN warehouses w ON w.id = b.warehouse_id
      WHERE b.id = $1
    `,
    [bagId]
  )
  return r.rows[0] ?? null
}

export async function getBatchById(batchId) {
  const r = await pool.query('SELECT * FROM product_batches WHERE id = $1', [batchId])
  return r.rows[0] ?? null
}

export async function getBatchesForProduct(productId, warehouseId, opts = {}) {
  const includeEmpty = opts.includeEmpty === true
  const activeCond = includeEmpty
    ? 'TRUE'
    : `(
      (COALESCE(pb.unit_type, 'piece') != 'bulk' AND COALESCE(pb.quantity,0) > 0)
      OR
      (COALESCE(pb.unit_type, 'piece') = 'bulk' AND COALESCE(pb.kg_remaining,0) > 0)
    )`
  const sql = warehouseId
    ? `
      SELECT pb.*, w.name_ar AS warehouse_name_ar,
        COALESCE(pis.sold_units,0) AS sold_units,
        COALESCE(bks.sold_kg,0) AS sold_kg
      FROM product_batches pb
      LEFT JOIN warehouses w ON w.id = pb.warehouse_id
      LEFT JOIN (
        SELECT batch_id, SUM(quantity) AS sold_units
        FROM invoice_item_batches
        GROUP BY batch_id
      ) pis ON pis.batch_id = pb.id
      LEFT JOIN (
        SELECT b.batch_id, SUM(iib.amount_kg) AS sold_kg
        FROM invoice_item_bags iib
        INNER JOIN bag_instances b ON b.id = iib.bag_id
        GROUP BY b.batch_id
      ) bks ON bks.batch_id = pb.id
      WHERE pb.product_id = $1 AND pb.warehouse_id = $2 AND ${activeCond}
      ORDER BY pb.expiry_date ASC
    `
    : `
      SELECT pb.*, w.name_ar AS warehouse_name_ar,
        COALESCE(pis.sold_units,0) AS sold_units,
        COALESCE(bks.sold_kg,0) AS sold_kg
      FROM product_batches pb
      LEFT JOIN warehouses w ON w.id = pb.warehouse_id
      LEFT JOIN (
        SELECT batch_id, SUM(quantity) AS sold_units
        FROM invoice_item_batches
        GROUP BY batch_id
      ) pis ON pis.batch_id = pb.id
      LEFT JOIN (
        SELECT b.batch_id, SUM(iib.amount_kg) AS sold_kg
        FROM invoice_item_bags iib
        INNER JOIN bag_instances b ON b.id = iib.bag_id
        GROUP BY b.batch_id
      ) bks ON bks.batch_id = pb.id
      WHERE pb.product_id = $1 AND ${activeCond}
      ORDER BY pb.expiry_date ASC
    `
  const r = warehouseId
    ? await pool.query(sql, [productId, warehouseId])
    : await pool.query(sql, [productId])
  return r.rows
}

export async function batchHasInvoiceReferences(batchId) {
  const a = await pool.query('SELECT 1 FROM invoice_item_batches WHERE batch_id = $1 LIMIT 1', [batchId])
  if (a.rows[0]) return true
  const b = await pool.query(
    `
      SELECT 1
      FROM invoice_item_bags iib
      INNER JOIN bag_instances bi ON bi.id = iib.bag_id
      WHERE bi.batch_id = $1
      LIMIT 1
    `,
    [batchId]
  )
  if (b.rows[0]) return true
  const c = await pool.query('SELECT 1 FROM invoice_items WHERE batch_id = $1 LIMIT 1', [batchId])
  return !!c.rows[0]
}

export async function deleteProductBatch(batchId, role) {
  const b = await getBatchById(batchId)
  if (!b) return { ok: false, error: 'الدفعة غير موجودة' }
  if (await batchHasInvoiceReferences(batchId)) {
    return { ok: false, error: 'لا يمكن حذف الدفعة — مرتبطة بمبيعات مسجّلة' }
  }
  const isBulk = b.unit_type === 'bulk'
  const hasStock = isBulk ? Number(b.kg_remaining ?? 0) > 0.0001 : Number(b.quantity ?? 0) > 0
  if (role !== 'super_admin' && hasStock) {
    return {
      ok: false,
      error: 'لا يمكن حذف الدفعة — المخزون غير صفر (يتطلب صلاحية مدير أعلى لحذف مخزون متبقي)',
    }
  }
  await pool.query('DELETE FROM product_batches WHERE id = $1', [batchId])
  await syncWarehouseStockFromBatches(b.product_id, b.warehouse_id)
  return { ok: true }
}

export async function updateProductBatch(batchId, body) {
  const b = await getBatchById(batchId)
  if (!b) return null
  const sets = []
  const vals = []
  let i = 1
  if (body.quantity !== undefined && b.unit_type !== 'bulk') {
    const n = Number(body.quantity)
    if (!Number.isFinite(n) || n < 0) throw new Error('كمية غير صالحة')
    sets.push(`quantity = $${i++}`)
    vals.push(n)
  }
  if (body.kg_remaining !== undefined && b.unit_type === 'bulk') {
    const n = Number(body.kg_remaining)
    if (!Number.isFinite(n) || n < 0) throw new Error('الكيلوهات غير صالحة')
    sets.push(`kg_remaining = $${i++}`)
    vals.push(n)
  }
  if (body.purchase_price !== undefined) {
    sets.push(`purchase_price = $${i++}`)
    vals.push(body.purchase_price == null ? null : Number(body.purchase_price))
  }
  if (body.selling_price !== undefined) {
    sets.push(`selling_price = $${i++}`)
    vals.push(body.selling_price == null ? null : Number(body.selling_price))
  }
  if (body.expiry_date !== undefined) {
    const exp = body.expiry_date === '' || body.expiry_date == null ? '9999-12-31' : String(body.expiry_date)
    sets.push(`expiry_date = $${i++}::date`)
    vals.push(exp)
  }
  if (!sets.length) return b
  vals.push(batchId)
  await pool.query(`UPDATE product_batches SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals)
  const row = await getBatchById(batchId)
  await syncWarehouseStockFromBatches(row.product_id, row.warehouse_id)
  return row
}

export async function createManualProductBatch(productId, body) {
  const p = await getProductById(productId)
  if (!p) throw new Error('المنتج غير موجود')
  const wh = Number(body.warehouse_id)
  if (!Number.isInteger(wh)) throw new Error('المخزن مطلوب')
  const exp = body.expiry_date === '' || body.expiry_date == null ? '9999-12-31' : String(body.expiry_date)
  const pp = body.purchase_price != null && body.purchase_price !== '' ? Number(body.purchase_price) : null
  const sp = body.selling_price != null && body.selling_price !== '' ? Number(body.selling_price) : null

  if (p.unit_type === 'bulk') {
    const kgPerBag = Math.max(0, Number(body.kg_per_bag || p.bag_weight_kg || 0))
    const bagCount = Math.max(1, Math.floor(Number(body.bag_count || 1)))
    const totalKg =
      body.kg_remaining != null && body.kg_remaining !== ''
        ? Number(body.kg_remaining)
        : bagCount * kgPerBag
    if (!Number.isFinite(totalKg) || totalKg < 0) throw new Error('وزن غير صالح')
    const ins = await pool.query(
      `
        INSERT INTO product_batches
        (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type, bag_count, kg_per_bag, kg_remaining, source, created_at, updated_at)
        VALUES ($1,$2,$3::date,$4,$5,$6,'bulk',$7,$8,$9,'manual_adjustment',NOW(),NOW())
        RETURNING id
      `,
      [productId, wh, exp, bagCount, pp, sp, bagCount, kgPerBag, totalKg]
    )
    const batchId = ins.rows[0].id
    let remaining = totalKg
    for (let idx = 0; idx < bagCount; idx += 1) {
      const isLast = idx === bagCount - 1
      const kg = isLast ? remaining : Math.min(kgPerBag, remaining)
      remaining -= kg
      await pool.query(
        `
          INSERT INTO bag_instances
          (batch_id, product_id, warehouse_id, bag_number, kg_total, kg_remaining, status, expiry_date, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,'sealed',$7::date,NOW())
        `,
        [batchId, productId, wh, idx + 1, kg, kg, exp === '9999-12-31' ? null : exp]
      )
    }
    await syncWarehouseStockFromBatches(productId, wh)
    return getBatchById(batchId)
  }

  const qty = Math.max(0, Number(body.quantity ?? 0))
  const ins = await pool.query(
    `
      INSERT INTO product_batches
      (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type, bag_count, kg_per_bag, kg_remaining, source, created_at, updated_at)
      VALUES ($1,$2,$3::date,$4,$5,$6,'piece',NULL,NULL,NULL,'manual_adjustment',NOW(),NOW())
      RETURNING id
    `,
    [productId, wh, exp, qty, pp, sp]
  )
  const batchId = ins.rows[0].id
  await syncWarehouseStockFromBatches(productId, wh)
  return getBatchById(batchId)
}

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
      if (!Number.isFinite(kpb) || kpb <= 0) throw new Error('حدد وزن الشكارة بالكيلو للمنتج بالوزن')
      const hasOpen = !!row.has_open_bag
      let openKg = null
      if (hasOpen) {
        const raw = row.open_kg_remaining
        openKg = raw == null || raw === '' ? kpb : Number(raw)
        if (!Number.isFinite(openKg) || openKg < 0) openKg = kpb
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

async function createInitialBatchWithClient(q, productId, unitType, productData, batch) {
  const whId = Number(batch.warehouse_id)
  if (!Number.isInteger(whId) || whId <= 0) throw new Error('المخزن مطلوب لكل دفعة')
  const pp = batch.purchase_price != null && batch.purchase_price !== '' ? Number(batch.purchase_price) : NaN
  const sp = batch.selling_price != null && batch.selling_price !== '' ? Number(batch.selling_price) : NaN
  if (!Number.isFinite(pp) || pp < 0) throw new Error('سعر الشراء مطلوب لكل دفعة')
  if (!Number.isFinite(sp) || sp < 0) throw new Error('سعر البيع مطلوب لكل دفعة')
  const expiryDate = batch.expiry_date == null || batch.expiry_date === '' ? null : String(batch.expiry_date)
  if (unitType === 'piece') {
    const qty = Math.floor(Number(batch.quantity))
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('أدخل كمية أكبر من صفر لكل دفعة (قطعة)')
    await q.query(
      `
        INSERT INTO product_batches
        (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type, source, created_at, updated_at)
        VALUES ($1,$2,$3::date,$4,$5,$6,'piece','initial_stock',NOW(),NOW())
      `,
      [productId, whId, expiryDate || '9999-12-31', qty, pp, sp]
    )
    return whId
  }
  const bagCount = Math.max(0, Math.floor(Number(batch.bag_count) || 0))
  const kgPerBag =
    batch.kg_per_bag != null && batch.kg_per_bag !== '' ? Number(batch.kg_per_bag) : Number(productData.bag_weight_kg)
  if (!Number.isFinite(kgPerBag) || kgPerBag <= 0) throw new Error('وزن الشكارة غير صالح في دفعة بالكيلو')
  if (bagCount <= 0) throw new Error('أدخل عدد شكاير أكبر من صفر لكل دفعة بالكيلو')
  const hasOpen = !!batch.has_open_bag
  let openKg = null
  if (hasOpen) {
    openKg = batch.open_kg_remaining == null || batch.open_kg_remaining === '' ? kgPerBag : Number(batch.open_kg_remaining)
    if (!Number.isFinite(openKg) || openKg <= 0) throw new Error('الكيلو المتبقي في الشكارة المفتوحة غير صالح')
    if (openKg > kgPerBag + 0.0001) throw new Error('الكيلو المتبقي يتجاوز وزن الشكارة')
  }
  const totalKg = hasOpen ? (bagCount - 1) * kgPerBag + (openKg ?? kgPerBag) : bagCount * kgPerBag
  const ins = await q.query(
    `
      INSERT INTO product_batches
      (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type, bag_count, kg_per_bag, kg_remaining, source, created_at, updated_at)
      VALUES ($1,$2,$3::date,$4,$5,$6,'bulk',$7,$8,$9,'initial_stock',NOW(),NOW())
      RETURNING id
    `,
    [productId, whId, expiryDate || '9999-12-31', bagCount, pp, sp, bagCount, kgPerBag, totalKg]
  )
  const batchId = ins.rows[0].id
  const expCol = expiryDate == null || expiryDate === '9999-12-31' ? null : expiryDate
  for (let i = 1; i <= bagCount; i += 1) {
    const isOpenBag = hasOpen && i === 1
    const kgRem = isOpenBag ? (openKg ?? kgPerBag) : kgPerBag
    await q.query(
      `
        INSERT INTO bag_instances
        (batch_id, product_id, warehouse_id, bag_number, kg_total, kg_remaining, status, expiry_date, opened_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,NOW())
      `,
      [batchId, productId, whId, i, kgPerBag, kgRem, isOpenBag ? 'open' : 'sealed', expCol, isOpenBag ? nowIso() : null]
    )
  }
  return whId
}

export async function createProduct(data) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const barcode = data.barcode ?? `PRD-${Date.now()}`
    const imageUrl =
      data.image_url != null && String(data.image_url).trim() !== '' ? String(data.image_url) : null
    if (imageUrl) assertProductImageUrlField(imageUrl)
    const unitTypeIns = data.unit_type ?? 'piece'
    const defaultAlertLevel = unitTypeIns === 'bulk' ? 0 : 5
    const ins = await client.query(
      `
        INSERT INTO products
        (name, company, category, barcode, unit_type, bag_weight_kg, purchase_price, selling_price, alert_level, alert_level_kg, expiry_date, image_url, notes, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,NOW(),NOW())
        RETURNING id
      `,
      [
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
      ]
    )
    const id = ins.rows[0].id
    const unitType = unitTypeIns
    const { batches, legacyZeroWarehouses } = buildInitialBatchesFromPayload(data)
    const syncedWh = new Set()
    for (const batch of batches) {
      const wh = await createInitialBatchWithClient(client, id, unitType, data, batch)
      syncedWh.add(wh)
    }
    for (const wh of syncedWh) await syncWarehouseStockFromBatchesWithClient(client, id, wh)
    for (const whId of legacyZeroWarehouses) {
      await client.query(
        `
          INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
          VALUES ($1,$2,0,NOW())
          ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity = 0, updated_at = NOW()
        `,
        [id, whId]
      )
    }
    if (data.warehouse_id && unitType !== 'bulk' && batches.length === 0) {
      await client.query(
        `
          INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
          VALUES ($1,$2,0,NOW())
          ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity = 0, updated_at = NOW()
        `,
        [id, data.warehouse_id]
      )
    }
    await client.query('COMMIT')
    return getProductById(id)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function seedInitialBulkStockForProductWithoutBatches(productId, body) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const p = await client.query('SELECT * FROM products WHERE id = $1', [productId]).then((r) => r.rows[0])
    if (!p) throw new Error('المنتج غير موجود')
    const existing = await client.query('SELECT COUNT(*)::int AS c FROM product_batches WHERE product_id = $1', [productId]).then((r) => r.rows[0].c)
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
    if (!batches.length && !legacyZeroWarehouses.length) throw new Error('بيانات المخزون الأولي غير صالحة')
    const syncedWh = new Set()
    for (const batch of batches) {
      const wh = await createInitialBatchWithClient(client, productId, p.unit_type ?? 'piece', p, batch)
      syncedWh.add(wh)
    }
    for (const wh of syncedWh) await syncWarehouseStockFromBatchesWithClient(client, productId, wh)
    for (const whId of legacyZeroWarehouses) {
      await client.query(
        `
          INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
          VALUES ($1,$2,0,NOW())
          ON CONFLICT (product_id, warehouse_id) DO UPDATE SET quantity = 0, updated_at = NOW()
        `,
        [productId, whId]
      )
    }
    await client.query('COMMIT')
    return getProductById(productId)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

function coerceProductPrice(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export async function updateProduct(id, data) {
  const allowed = [
    'name',
    'company',
    'category',
    'barcode',
    'unit_type',
    'bag_weight_kg',
    'purchase_price',
    'selling_price',
    'alert_level',
    'alert_level_kg',
    'expiry_date',
    'notes',
    'image_url',
  ]
  const sets = []
  const vals = []
  let i = 1
  for (const k of allowed) {
    if (data[k] !== undefined) {
      if (k === 'image_url' && data[k] != null && data[k] !== '') {
        assertProductImageUrlField(String(data[k]))
      }
      if (k === 'expiry_date') {
        sets.push(`${k} = $${i++}::date`)
        vals.push(data[k] || null)
      } else {
        let v = data[k]
        if (k === 'purchase_price' || k === 'selling_price') v = coerceProductPrice(v)
        sets.push(`${k} = $${i++}`)
        vals.push(v)
      }
    }
  }
  if (!sets.length) return getProductById(id)
  vals.push(id)
  await pool.query(`UPDATE products SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals)
  return getProductById(id)
}

export async function deleteProduct(id) {
  await pool.query('DELETE FROM products WHERE id = $1', [id])
}

export async function parseInvoiceEditWindowDays() {
  const raw = await getSetting('invoice_edit_window_days')
  const v = Number.parseInt(raw ?? '7', 10)
  if (!Number.isFinite(v) || v < 1) return 7
  return Math.min(365, v)
}

export async function getInvoiceEditWindowStatus(invoiceId) {
  const windowDays = await parseInvoiceEditWindowDays()
  const r = await pool.query('SELECT created_at FROM invoices WHERE id = $1', [invoiceId])
  const inv = r.rows[0]
  if (!inv) return null
  const createdAt = new Date(inv.created_at).getTime()
  const ageDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24)
  return {
    windowDays,
    ageDays: Math.round(ageDays * 100) / 100,
    withinWindow: ageDays <= windowDays,
  }
}

export async function assertInvoiceReplaceAllowed(invoiceId, role) {
  const st = await getInvoiceEditWindowStatus(invoiceId)
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

export async function recordInvoiceEditOverride(invoiceId, userId, reason) {
  const uid = userId != null && Number.isFinite(Number(userId)) ? Number(userId) : null
  await pool.query(
    'UPDATE invoices SET last_edited_by = $1, last_edited_at = NOW(), edit_override_reason = $2 WHERE id = $3',
    [uid, reason != null && String(reason).trim() !== '' ? String(reason) : null, invoiceId]
  )
}

function toClient(r) {
  if (!r) return null
  return {
    ...r,
    favorite: !!r.favorite,
    pinned: !!r.pinned,
  }
}

function toBarn(r) {
  return r ? { ...r } : null
}

function toSupplier(r) {
  if (!r) return null
  return { ...r, is_active: !!r.is_active }
}

export async function getClients(search, pinned, limit = 50, sort) {
  const params = []
  let i = 1
  let sql = `
    SELECT c.*,
      (
        COALESCE(c.initial_debt,0)
        + COALESCE((SELECT SUM(initial_debt) FROM barns b2 WHERE b2.client_id = c.id), 0)
        + COALESCE((SELECT SUM(i.total_amount) FROM invoices i WHERE i.client_id = c.id AND COALESCE(i.invoice_lifecycle,'active') != 'cancelled'),0)
        - COALESCE((SELECT SUM(CASE WHEN COALESCE(p.payment_method,'') IN ('deferred','آجل','credit') THEN 0 ELSE p.amount END) FROM payments p WHERE p.client_id = c.id),0)
      ) AS balance
    FROM clients c
    WHERE 1=1
  `
  if (search) {
    sql += ` AND (LOWER(c.name) LIKE $${i} OR LOWER(COALESCE(c.phone,'')) LIKE $${i})`
    params.push(`%${String(search).toLowerCase()}%`)
    i += 1
  }
  if (pinned === true || pinned === 'true') {
    sql += ' AND c.pinned = true'
  }
  sql += sort === 'debt_desc' ? ' ORDER BY balance DESC, c.id DESC' : ' ORDER BY c.id DESC'
  sql += ` LIMIT $${i}`
  params.push(Math.min(Number(limit) || 50, 500))
  const r = await pool.query(sql, params)
  return r.rows.map(toClient)
}

export async function getClientById(id) {
  const r = await pool.query('SELECT * FROM clients WHERE id = $1', [id])
  return toClient(r.rows[0] ?? null)
}

export async function createClient(data) {
  const r = await pool.query(
    `
      INSERT INTO clients
      (name, phone, location, initial_debt, last_visit, total_profit, favorite, pinned, pinned_at, notes, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NULL, 0, false, false, NULL, $5, NOW(), NOW())
      RETURNING id
    `,
    [
      data.name || '',
      data.phone ?? null,
      data.location ?? null,
      data.initial_debt ?? 0,
      data.notes ?? null,
    ]
  )
  return getClientById(r.rows[0].id)
}

export async function updateClient(id, data) {
  const allowed = ['name', 'phone', 'location', 'initial_debt', 'notes']
  const sets = []
  const vals = []
  let i = 1
  for (const k of allowed) {
    if (data[k] !== undefined) {
      sets.push(`${k} = $${i++}`)
      vals.push(data[k])
    }
  }
  if (sets.length === 0) return getClientById(id)
  vals.push(id)
  await pool.query(`UPDATE clients SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals)
  return getClientById(id)
}

export async function deleteClient(id) {
  await pool.query('DELETE FROM clients WHERE id = $1', [id])
}

export async function toggleClientPin(id) {
  const c = await getClientById(id)
  if (!c) return null
  const pinned = !c.pinned
  await pool.query(
    'UPDATE clients SET pinned = $1, pinned_at = $2, updated_at = NOW() WHERE id = $3',
    [pinned, pinned ? nowIso() : null, id]
  )
  return getClientById(id)
}

export async function toggleClientFavorite(id) {
  const c = await getClientById(id)
  if (!c) return null
  await pool.query('UPDATE clients SET favorite = $1, updated_at = NOW() WHERE id = $2', [
    !c.favorite,
    id,
  ])
  return getClientById(id)
}

export async function getClientBalance(clientId) {
  const c = await getClientById(clientId)
  if (!c) return null
  const r = await pool.query(
    `
      SELECT
        COALESCE((SELECT initial_debt FROM clients WHERE id = $1), 0) + COALESCE((SELECT SUM(initial_debt) FROM barns WHERE client_id = $1), 0) AS initial_debt,
        COALESCE((SELECT SUM(total_amount) FROM invoices WHERE client_id = $1 AND COALESCE(invoice_lifecycle,'active') != 'cancelled'),0) AS inv_total,
        COALESCE((SELECT SUM(CASE WHEN COALESCE(payment_method,'') IN ('deferred','آجل','credit') THEN 0 ELSE amount END) FROM payments WHERE client_id = $1),0) AS paid
    `,
    [clientId]
  )
  const invTotal = Number(r.rows[0]?.inv_total ?? 0)
  const paid = Number(r.rows[0]?.paid ?? 0)
  const initialDebt = Number(r.rows[0]?.initial_debt ?? 0)
  const totalAccount = initialDebt + invTotal
  return {
    total_account: totalAccount,
    total_paid: paid,
    balance: totalAccount - paid,
  }
}

export async function getBarnsByClientId(clientId) {
  const r = await pool.query(
    `
      SELECT b.*,
        COALESCE((SELECT SUM(total_amount) FROM invoices i WHERE i.barn_id = b.id AND COALESCE(i.invoice_lifecycle,'active') != 'cancelled'), 0) AS inv_total,
        COALESCE((SELECT SUM(CASE WHEN COALESCE(p.payment_method,'') IN ('deferred','آجل','credit') THEN 0 ELSE p.amount END) FROM payments p WHERE p.barn_id = b.id), 0) AS paid
      FROM barns b
      WHERE b.client_id = $1
      ORDER BY b.id
    `,
    [clientId]
  )
  return r.rows.map((row) => {
    const barn = toBarn(row)
    const invTotal = Number(row.inv_total ?? 0)
    const paid = Number(row.paid ?? 0)
    const initialDebt = Number(barn.initial_debt ?? 0)
    const totalAccount = initialDebt + invTotal
    return {
      ...barn,
      total_account: totalAccount,
      total_paid: paid,
      balance: totalAccount - paid,
    }
  })
}

export async function getBarnById(id) {
  const r = await pool.query(
    `SELECT b.*,
       COALESCE((SELECT SUM(total_amount) FROM invoices i WHERE i.barn_id = b.id AND COALESCE(i.invoice_lifecycle,'active') != 'cancelled'), 0) AS inv_total,
       COALESCE((SELECT SUM(CASE WHEN COALESCE(p.payment_method,'') IN ('deferred','آجل','credit') THEN 0 ELSE p.amount END) FROM payments p WHERE p.barn_id = b.id), 0) AS paid
     FROM barns b
     WHERE b.id = $1`,
    [id]
  )
  const row = r.rows[0]
  if (!row) return null

  const barn = toBarn(row)
  const invTotal = Number(row.inv_total ?? 0)
  const paid = Number(row.paid ?? 0)
  const initialDebt = Number(barn.initial_debt ?? 0)
  const totalAccount = initialDebt + invTotal

  return {
    ...barn,
    total_account: totalAccount,
    total_paid: paid,
    balance: totalAccount - paid,
  }
}

export async function createBarn(clientId, data) {
  const r = await pool.query(
    `
      INSERT INTO barns (client_id, name, initial_debt, total_invoices, total_profit, created_at, updated_at)
      VALUES ($1, $2, $3, 0, 0, NOW(), NOW())
      RETURNING id
    `,
    [clientId, data.name || '', data.initial_debt ?? 0]
  )
  return getBarnById(r.rows[0].id)
}

export async function updateBarn(id, data) {
  const allowed = ['name', 'initial_debt']
  const sets = []
  const vals = []
  let i = 1
  for (const k of allowed) {
    if (data[k] !== undefined) {
      sets.push(`${k} = $${i++}`)
      vals.push(data[k])
    }
  }
  if (!sets.length) return getBarnById(id)
  vals.push(id)
  await pool.query(`UPDATE barns SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals)
  return getBarnById(id)
}

export async function deleteBarn(id) {
  await pool.query('DELETE FROM barns WHERE id = $1', [id])
}

export async function getPayments(limit = 50) {
  const r = await pool.query('SELECT * FROM payments ORDER BY id DESC LIMIT $1', [
    Math.min(Number(limit) || 50, 200),
  ])
  return r.rows
}

export async function createPayment(data) {
  const method = data.payment_method || 'cash'
  if (method === 'deferred') {
    throw new Error('لا يمكن تسجيل دفعة آجل من هنا — استخدم الفاتورة أو تسجيل المتبقي كآجل')
  }
  const paymentDate = data.payment_date || nowIso().slice(0, 10)
  const r = await pool.query(
    `
      INSERT INTO payments
      (client_id, barn_id, amount, payment_method, notes, payment_date, created_at, created_by, invoice_id, wallet_id)
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NULL,$7,$8)
      RETURNING *
    `,
    [
      data.client_id,
      data.barn_id ?? null,
      data.amount ?? 0,
      method,
      data.notes ?? null,
      paymentDate,
      data.invoice_id ?? null,
      data.wallet_id ?? null,
    ]
  )
  return r.rows[0]
}

export async function getSafeTransactions(limit = 50) {
  const r = await pool.query('SELECT * FROM safe_transactions ORDER BY id DESC LIMIT $1', [
    Math.min(Number(limit) || 50, 100),
  ])
  return r.rows
}

export async function getSafeBalance() {
  const r = await pool.query(
    `
      SELECT COALESCE(SUM(
        CASE
          WHEN type IN ('initial','customer_payment_in','adjustment_in') THEN amount
          ELSE -amount
        END
      ),0) AS balance
      FROM safe_transactions
    `
  )
  return Math.max(0, Number(r.rows[0]?.balance ?? 0))
}

export async function createSafeInitial(data) {
  await pool.query(
    `
      INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
      VALUES ('initial', $1, NULL, NULL, $2, NOW(), NULL)
    `,
    [data.amount ?? 0, data.notes ?? null]
  )
}

export async function createSafeAdjustment(data) {
  await pool.query(
    `
      INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
      VALUES ($1, $2, NULL, NULL, $3, NOW(), NULL)
    `,
    [data.type || 'adjustment_in', data.amount ?? 0, data.notes ?? null]
  )
}

export async function deleteSafeTransaction(id) {
  const row = (await pool.query('SELECT * FROM safe_transactions WHERE id = $1', [id])).rows[0]
  if (!row) return false
  if (row.reference_type) {
    throw new Error('لا يمكن حذف حركة مرتبطة بعملية أخرى (دفعة عميل أو مورد).')
  }
  const r = await pool.query('DELETE FROM safe_transactions WHERE id = $1', [id])
  return r.rowCount > 0
}

export async function clearDeletableSafeTransactions() {
  const r = await pool.query('DELETE FROM safe_transactions WHERE reference_type IS NULL')
  return r.rowCount ?? 0
}

export async function getSuppliers(search, limit = 50, sort) {
  const params = []
  let i = 1
  let sql = `
    SELECT s.*,
      (
        COALESCE((SELECT SUM(total_amount) FROM supplier_purchases sp WHERE sp.supplier_id = s.id),0)
        - COALESCE((SELECT SUM(amount) FROM supplier_payments spm WHERE spm.supplier_id = s.id),0)
      ) AS balance
    FROM suppliers s
    WHERE 1=1
  `
  if (search) {
    sql += ` AND LOWER(s.name) LIKE $${i++}`
    params.push(`%${String(search).toLowerCase()}%`)
  }
  sql +=
    sort === 'balance_desc'
      ? ` ORDER BY (
        COALESCE((SELECT SUM(total_amount) FROM supplier_purchases sp WHERE sp.supplier_id = s.id),0)
        - COALESCE((SELECT SUM(amount) FROM supplier_payments spm WHERE spm.supplier_id = s.id),0)
      ) DESC, s.id DESC`
      : ` ORDER BY s.id DESC`
  sql += ` LIMIT $${i}`
  params.push(Math.min(Number(limit) || 50, 200))
  const r = await pool.query(sql, params)
  return r.rows.map((row) => ({ ...toSupplier(row), balance: Number(row.balance ?? 0) }))
}

export async function getSupplierById(id) {
  const r = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id])
  return toSupplier(r.rows[0] ?? null)
}

export async function createSupplier(data) {
  const r = await pool.query(
    `
      INSERT INTO suppliers (name, phone, email, address, notes, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
      RETURNING id
    `,
    [data.name || '', data.phone ?? null, data.email ?? null, data.address ?? null, data.notes ?? null]
  )
  return getSupplierById(r.rows[0].id)
}

export async function updateSupplier(id, data) {
  const allowed = ['name', 'phone', 'email', 'address', 'notes', 'is_active']
  const sets = []
  const vals = []
  let i = 1
  for (const k of allowed) {
    if (data[k] !== undefined) {
      sets.push(`${k} = $${i++}`)
      vals.push(k === 'is_active' ? !!data[k] : data[k])
    }
  }
  if (!sets.length) return getSupplierById(id)
  vals.push(id)
  await pool.query(
    `UPDATE suppliers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`,
    vals
  )
  return getSupplierById(id)
}

export async function deleteSupplier(id) {
  await pool.query('DELETE FROM suppliers WHERE id = $1', [id])
}

export async function getSupplierBalance(supplierId) {
  const r = await pool.query(
    `
      SELECT
        COALESCE((SELECT SUM(total_amount) FROM supplier_purchases WHERE supplier_id = $1),0) AS purchases,
        COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = $1),0) AS payments
    `,
    [supplierId]
  )
  const purchases = Number(r.rows[0]?.purchases ?? 0)
  const payments = Number(r.rows[0]?.payments ?? 0)
  return Math.max(0, purchases - payments)
}

export async function getSupplierPurchases(supplierId, limit = 10) {
  const r = await pool.query(
    `
      SELECT id, supplier_id, warehouse_id, total_amount, notes, created_at, created_by
      FROM supplier_purchases
      WHERE supplier_id = $1
      ORDER BY id DESC
      LIMIT $2
    `,
    [supplierId, Math.min(Number(limit) || 10, 100)]
  )
  return r.rows
}

export async function getSupplierPurchasesWithItems(supplierId, limit = 10) {
  const purchases = await getSupplierPurchases(supplierId, limit)
  if (!purchases.length) return []
  const out = []
  for (const p of purchases) {
    const items = await pool.query(
      `
        SELECT spi.*, COALESCE(pr.name, 'منتج') AS product_name
        FROM supplier_purchase_items spi
        LEFT JOIN products pr ON pr.id = spi.product_id
        WHERE spi.supplier_purchase_id = $1
      `,
      [p.id]
    )
    out.push({
      ...p,
      items: items.rows
    })
  }
  return out
}

export async function getSupplierPayments(supplierId, limit = 10) {
  const r = await pool.query(
    `
      SELECT *
      FROM supplier_payments
      WHERE supplier_id = $1
      ORDER BY id DESC
      LIMIT $2
    `,
    [supplierId, Math.min(Number(limit) || 10, 100)]
  )
  return r.rows
}

export async function createSupplierPurchase(data) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const items = Array.isArray(data.items) ? data.items : []
    const computedTotal = items.reduce((sum, it) => {
      const qty = Number(it.quantity ?? 0)
      const unit = Number(it.unit_price ?? 0)
      const tp = it.total_price != null ? Number(it.total_price) : qty * unit
      return sum + (Number.isFinite(tp) ? tp : 0)
    }, 0)
    const total = data.total_amount != null ? Number(data.total_amount) : computedTotal

    const insPurchase = await client.query(
      `
        INSERT INTO supplier_purchases
        (supplier_id, warehouse_id, total_amount, notes, created_at, created_by)
        VALUES ($1, $2, $3, $4, NOW(), NULL)
        RETURNING id
      `,
      [data.supplier_id, data.warehouse_id ?? 1, total, data.notes ?? null]
    )
    const purchaseId = insPurchase.rows[0].id

    for (const it of items) {
      const qty = Number(it.quantity ?? 0)
      const unit = Number(it.unit_price ?? 0)
      const kpb = Number(it.kg_per_bag ?? 0)
      const computedTp = it.unit_type === 'bulk' ? qty * kpb * unit : qty * unit
      const tp = it.total_price != null ? Number(it.total_price) : computedTp

      await client.query(
        `
          INSERT INTO supplier_purchase_items
          (supplier_purchase_id, product_id, quantity, unit_price, total_price, created_at, unit_type, kg_per_bag)
          VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
        `,
        [purchaseId, it.product_id, qty, unit, tp, it.unit_type || 'piece', kpb || null]
      )
    }

    await client.query('COMMIT')
    const out = await pool.query('SELECT * FROM supplier_purchases WHERE id = $1', [purchaseId])
    return out.rows[0] ?? null
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function getSupplierPurchaseById(id) {
  const p = await pool.query('SELECT * FROM supplier_purchases WHERE id = $1', [id])
  const purchase = p.rows[0]
  if (!purchase) return null
  const items = await pool.query('SELECT * FROM supplier_purchase_items WHERE supplier_purchase_id = $1', [
    id,
  ])
  return { ...purchase, items: items.rows }
}

export async function createSupplierPayment(data) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const paymentDate = data.payment_date || nowIso().slice(0, 10)
    const ins = await client.query(
      `
        INSERT INTO supplier_payments
        (supplier_id, amount, payment_method, notes, payment_date, created_at, created_by)
        VALUES ($1, $2, $3, $4, $5, NOW(), NULL)
        RETURNING *
      `,
      [
        data.supplier_id,
        Number(data.amount ?? 0),
        data.payment_method || 'cash',
        data.notes ?? null,
        paymentDate,
      ]
    )
    const payment = ins.rows[0]
    await client.query(
      `
        INSERT INTO safe_transactions
        (type, amount, reference_type, reference_id, notes, created_at, created_by)
        VALUES ('supplier_payment_out', $1, 'supplier_payment', $2, NULL, NOW(), NULL)
      `,
      [Number(data.amount ?? 0), payment.id]
    )
    await client.query('COMMIT')
    return payment
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/**
 * @param {{ from?: string; to?: string }} [opts]
 * When `from` and `to` (YYYY-MM-DD) are set, `total_sales` and `total_profit` are limited to that range;
 * other fields stay snapshot / all-time as before.
 */
export async function getDashboardStats(opts = {}) {
  const from = opts.from && /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from).slice(0, 10)) ? String(opts.from).slice(0, 10) : null
  const to = opts.to && /^\d{4}-\d{2}-\d{2}$/.test(String(opts.to).slice(0, 10)) ? String(opts.to).slice(0, 10) : null
  const rangeActive = from && to
  const salesWhere = rangeActive
    ? `WHERE COALESCE(invoice_lifecycle,'active') != 'cancelled'
         AND created_at::date >= $1::date AND created_at::date <= $2::date`
    : `WHERE COALESCE(invoice_lifecycle,'active') != 'cancelled'`
  const salesParams = rangeActive ? [from, to] : []
  const totalSales = Number(
    (
      await pool.query(
        `SELECT COALESCE(SUM(total_amount),0) AS s FROM invoices ${salesWhere}`,
        salesParams
      )
    ).rows[0]?.s ?? 0
  )
  const totalProfit = Number(
    (
      await pool.query(
        `SELECT COALESCE(SUM(profit_amount),0) AS s FROM invoices ${salesWhere}`,
        salesParams
      )
    ).rows[0]?.s ?? 0
  )
  const unpaidCount = Number(
    (
      await pool.query(
        "SELECT COUNT(*)::int AS n FROM invoices WHERE remaining_amount > 0 AND COALESCE(invoice_lifecycle,'active') != 'cancelled'"
      )
    ).rows[0]?.n ?? 0
  )
  const clientDebt = Number(
    (
      await pool.query(
        `
          SELECT
            COALESCE((SELECT SUM(initial_debt) FROM clients),0)
            + COALESCE((SELECT SUM(initial_debt) FROM barns),0)
            + COALESCE((SELECT SUM(total_amount) FROM invoices WHERE COALESCE(invoice_lifecycle,'active') != 'cancelled'),0)
            - COALESCE((SELECT SUM(CASE WHEN COALESCE(payment_method,'') IN ('deferred','آجل','credit') THEN 0 ELSE amount END) FROM payments),0)
            AS s
        `
      )
    ).rows[0]?.s ?? 0
  )
  const deferred = Number(
    (
      await pool.query(
        "SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE payment_method = 'deferred' AND settled_at IS NULL"
      )
    ).rows[0]?.s ?? 0
  )
  const purchases = Number(
    (await pool.query('SELECT COALESCE(SUM(total_amount),0) AS s FROM supplier_purchases')).rows[0]?.s ?? 0
  )
  const supplierPayments = Number(
    (await pool.query('SELECT COALESCE(SUM(amount),0) AS s FROM supplier_payments')).rows[0]?.s ?? 0
  )
  const safeBalance = await getSafeBalance()
  const productCount = Number(
    (await pool.query('SELECT COUNT(*)::int AS n FROM products')).rows[0]?.n ?? 0
  )
  const clientsCount = Number(
    (await pool.query('SELECT COUNT(*)::int AS n FROM clients')).rows[0]?.n ?? 0
  )
  const invoicesCount = Number(
    (
      await pool.query(
        "SELECT COUNT(*)::int AS n FROM invoices WHERE COALESCE(invoice_lifecycle,'active') != 'cancelled'"
      )
    ).rows[0]?.n ?? 0
  )

  const inventoryStats = await pool.query(`
    SELECT
      SUM(
        CASE
          WHEN COALESCE(pb.unit_type, 'piece') = 'bulk'
            THEN COALESCE(pb.kg_remaining, 0) * COALESCE(pb.purchase_price, p.purchase_price, 0)
          ELSE
            COALESCE(pb.quantity, 0) * COALESCE(pb.purchase_price, p.purchase_price, 0)
        END
      ) AS inventory_value_purchase,
      SUM(
        CASE
          WHEN COALESCE(pb.unit_type, 'piece') = 'bulk'
            THEN COALESCE(pb.kg_remaining, 0) * COALESCE(pb.selling_price, p.selling_price, 0)
          ELSE
            COALESCE(pb.quantity, 0) * COALESCE(pb.selling_price, p.selling_price, 0)
        END
      ) AS inventory_value_selling
    FROM product_batches pb
    JOIN products p ON p.id = pb.product_id
  `)
  const inventoryValuePurchase = Number(inventoryStats.rows[0]?.inventory_value_purchase ?? 0)
  const inventoryValueSelling = Number(inventoryStats.rows[0]?.inventory_value_selling ?? 0)

  if (process.env.NODE_ENV !== 'production') {
    console.log('[getDashboardStats] result:', {
      totalSales,
      inventoryValuePurchase,
      inventoryValueSelling,
    })
  }

  return {
    total_sales: totalSales,
    total_profit: totalProfit,
    client_debt: Math.max(0, clientDebt),
    total_deferred_receivable: deferred,
    safe_balance: safeBalance,
    supplier_payable: Math.max(0, purchases - supplierPayments),
    product_count: productCount,
    low_stock_count: 0,
    expiring_count: 0,
    unpaid_invoices_count: unpaidCount,
    clients_count: clientsCount,
    invoices_count: invoicesCount,
    inventory_value_purchase: inventoryValuePurchase,
    inventory_value_selling: inventoryValueSelling,
  }
}

function normalizeStmtDate(s) {
  if (s == null) return null
  if (s instanceof Date) {
    if (Number.isNaN(s.getTime())) return null
    return s.toISOString().slice(0, 10)
  }
  const t = String(s).trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

function addOneCalendarDay(isoDateStr) {
  const t = normalizeStmtDate(isoDateStr)
  if (!t) return null
  const [y, m, d] = t.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}

function paymentAmountTowardArJs(p) {
  const m = String(p?.payment_method ?? '')
  return m !== 'deferred' && m !== 'آجل' && m !== 'credit'
}

async function attachInvoiceItems(q, invoices) {
  if (!invoices.length) return
  const ids = invoices.map((i) => i.id)
  const rows = await q.query(
    'SELECT invoice_id, product_name, quantity, total_price FROM invoice_items WHERE invoice_id = ANY($1)',
    [ids]
  )
  const byInvoice = new Map()
  for (const it of rows.rows) {
    if (!byInvoice.has(it.invoice_id)) byInvoice.set(it.invoice_id, [])
    byInvoice.get(it.invoice_id).push({
      product_name: it.product_name,
      quantity: it.quantity,
      total_price: it.total_price,
    })
  }
  for (const inv of invoices) inv.items = byInvoice.get(inv.id) || []
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

/** وصف سطر الدفعة في كشف الحساب — المبلغ + طريقة الدفع فقط (بدون ربط بفاتورة). */
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
      sort_at: i.created_at,
      type: 'invoice',
      description: `فاتورة #${i.id}`,
      debit: Number(i.total_amount || 0),
      credit: 0,
      display_debit: Number(i.total_amount || 0),
      display_credit: Number(i.paid_amount || 0) > 0 ? Number(i.paid_amount || 0) : 0,
      invoice_id: i.id,
      invoice_total: Number(i.total_amount ?? 0),
      paid: Number(i.paid_amount ?? 0),
      remaining: Number(i.remaining_amount ?? 0),
      status: i.status ?? '',
      items: i.items || [],
      barn_name: i.barn_name ?? null,
      ledger_skip: false,
    })),
    ...payments
      .map((p) => {
        const settles = paymentAmountTowardArJs(p)
        if (!settles) return null
        const amt = Number(p.amount || 0)
        const desc = formatPaymentDescriptionAr(amt, p.payment_method)
        return {
          date: p.payment_date || p.created_at,
          sort_at: p.created_at || p.payment_date || p.date,
          type: 'payment',
          description: desc,
          debit: 0,
          credit: amt,
          display_debit: 0,
          display_credit: amt,
          payment_id: p.id,
          payment_amount: amt,
          payment_method: p.payment_method,
          invoice_id_link: p.invoice_id,
          settled_at: p.settled_at,
          barn_name: p.barn_name ?? null,
          ledger_skip: false,
        }
      })
      .filter(Boolean),
  ]
  merged.sort((a, b) => {
    const aTs = new Date(a.sort_at || a.date).getTime()
    const bTs = new Date(b.sort_at || b.date).getTime()
    if (aTs !== bTs) return aTs - bTs
    const aType = a.type === 'invoice' ? 0 : 1
    const bType = b.type === 'invoice' ? 0 : 1
    if (aType !== bType) return aType - bType
    const aId = a.type === 'invoice' ? Number(a.invoice_id || 0) : Number(a.payment_id || 0)
    const bId = b.type === 'invoice' ? Number(b.invoice_id || 0) : Number(b.payment_id || 0)
    return aId - bId
  })
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
      sort_at: m.sort_at || m.date,
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

export async function getAccountStatementClient(clientId, from, to) {
  const fromD = normalizeStmtDate(from)
  const toD = normalizeStmtDate(to)
  const c = await pool.query('SELECT initial_debt FROM clients WHERE id = $1', [clientId])
  const b = await pool.query('SELECT COALESCE(SUM(initial_debt), 0) AS sum_barns FROM barns WHERE client_id = $1', [clientId])
  const initialDebt = Number(c.rows[0]?.initial_debt ?? 0) + Number(b.rows[0]?.sum_barns ?? 0)
  const beforeInvoices = await pool.query(
    `
      SELECT total_amount
      FROM invoices
      WHERE client_id = $1
        AND ($2::date IS NULL OR created_at::date < $2::date)
        AND COALESCE(invoice_lifecycle,'active') != 'cancelled'
    `,
    [clientId, fromD]
  )
  const beforePayments = await pool.query(
    `
      SELECT amount, payment_method
      FROM payments
      WHERE client_id = $1
        AND ($2::date IS NULL OR payment_date::date < $2::date)
    `,
    [clientId, fromD]
  )
  const netBefore =
    beforeInvoices.rows.reduce((a, i) => a + Number(i.total_amount || 0), 0) -
    beforePayments.rows.reduce((a, p) => a + (paymentAmountTowardArJs(p) ? Number(p.amount || 0) : 0), 0)
  const opening = initialDebt + netBefore

  const invRows = await pool.query(
    `
      SELECT i.id, i.total_amount, i.paid_amount, i.remaining_amount, i.status, i.created_at, b.name AS barn_name
      FROM invoices i
      LEFT JOIN barns b ON b.id = i.barn_id
      WHERE i.client_id = $1
        AND ($2::date IS NULL OR i.created_at::date >= $2::date)
        AND ($3::date IS NULL OR i.created_at::date <= $3::date)
        AND COALESCE(i.invoice_lifecycle,'active') != 'cancelled'
    `,
    [clientId, fromD, toD]
  )
  const invoices = invRows.rows
  await attachInvoiceItems(pool, invoices)
  const payRows = await pool.query(
    `
      SELECT p.id, p.amount, p.payment_date, p.created_at, p.payment_method, p.invoice_id, p.notes, p.settled_at, b.name AS barn_name
      FROM payments p
      LEFT JOIN barns b ON b.id = p.barn_id
      WHERE p.client_id = $1
        AND ($2::date IS NULL OR p.payment_date::date >= $2::date)
        AND ($3::date IS NULL OR p.payment_date::date <= $3::date)
    `,
    [clientId, fromD, toD]
  )
  const { rows, closingBalance } = buildAccountStatementRows(opening, invoices, payRows.rows)
  return { opening_balance: opening, closing_balance: closingBalance, rows }
}

export async function getAccountStatementBarn(barnId, from, to) {
  const fromD = normalizeStmtDate(from)
  const toD = normalizeStmtDate(to)
  const b = await pool.query('SELECT initial_debt FROM barns WHERE id = $1', [barnId])
  const initialDebt = Number(b.rows[0]?.initial_debt ?? 0)
  const beforeInvoices = await pool.query(
    `
      SELECT total_amount
      FROM invoices
      WHERE barn_id = $1
        AND ($2::date IS NULL OR created_at::date < $2::date)
        AND COALESCE(invoice_lifecycle,'active') != 'cancelled'
    `,
    [barnId, fromD]
  )
  const beforePayments = await pool.query(
    `
      SELECT amount, payment_method
      FROM payments
      WHERE barn_id = $1
        AND ($2::date IS NULL OR payment_date::date < $2::date)
    `,
    [barnId, fromD]
  )
  const netBefore =
    beforeInvoices.rows.reduce((a, i) => a + Number(i.total_amount || 0), 0) -
    beforePayments.rows.reduce((a, p) => a + (paymentAmountTowardArJs(p) ? Number(p.amount || 0) : 0), 0)
  const opening = initialDebt + netBefore
  const invRows = await pool.query(
    `
      SELECT i.id, i.total_amount, i.paid_amount, i.remaining_amount, i.status, i.created_at, b.name AS barn_name
      FROM invoices i
      LEFT JOIN barns b ON b.id = i.barn_id
      WHERE i.barn_id = $1
        AND ($2::date IS NULL OR i.created_at::date >= $2::date)
        AND ($3::date IS NULL OR i.created_at::date <= $3::date)
        AND COALESCE(i.invoice_lifecycle,'active') != 'cancelled'
    `,
    [barnId, fromD, toD]
  )
  const invoices = invRows.rows
  await attachInvoiceItems(pool, invoices)
  const payRows = await pool.query(
    `
      SELECT p.id, p.amount, p.payment_date, p.created_at, p.payment_method, p.invoice_id, p.notes, p.settled_at, b.name AS barn_name
      FROM payments p
      LEFT JOIN barns b ON b.id = p.barn_id
      WHERE p.barn_id = $1
        AND ($2::date IS NULL OR p.payment_date::date >= $2::date)
        AND ($3::date IS NULL OR p.payment_date::date <= $3::date)
    `,
    [barnId, fromD, toD]
  )
  const { rows, closingBalance } = buildAccountStatementRows(opening, invoices, payRows.rows)
  return { opening_balance: opening, closing_balance: closingBalance, rows }
}

export async function getClientBillingCycles(clientId) {
  const r = await pool.query('SELECT * FROM client_billing_cycles WHERE client_id = $1 ORDER BY id DESC', [clientId])
  return r.rows
}

export async function getOpenBillingCycle(clientId) {
  const r = await pool.query(
    'SELECT * FROM client_billing_cycles WHERE client_id = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1',
    [clientId]
  )
  return r.rows[0] ?? null
}

export async function getBillingCycleById(cycleId) {
  const r = await pool.query('SELECT * FROM client_billing_cycles WHERE id = $1', [cycleId])
  return r.rows[0] ?? null
}

export async function startClientBillingCycle(clientId, { started_at, carry_in } = {}) {
  const ex = await getOpenBillingCycle(clientId)
  if (ex) throw new Error('يوجد دورة محاسبية مفتوحة بالفعل')
  const c = await getClientById(clientId)
  if (!c) throw new Error('العميل غير موجود')
  const start = normalizeStmtDate(started_at) || nowIso().slice(0, 10)
  let carry = carry_in
  if (carry === undefined || carry === null) carry = (await getClientBalance(clientId)) ?? 0
  else carry = Number(carry) || 0
  const ins = await pool.query(
    `
      INSERT INTO client_billing_cycles (client_id, started_at, ended_at, carry_in, created_at)
      VALUES ($1, $2::date, NULL, $3, NOW())
      RETURNING *
    `,
    [clientId, start, carry]
  )
  return ins.rows[0]
}

export async function endClientBillingCycle(clientId, { ended_at } = {}) {
  const cycle = await getOpenBillingCycle(clientId)
  if (!cycle) throw new Error('لا توجد دورة محاسبية مفتوحة')
  const end = normalizeStmtDate(ended_at) || nowIso().slice(0, 10)
  const stmt = await getAccountStatementForCycle(cycle.id)
  const closing = Number(stmt?.closing_balance ?? 0)
  const upd = await pool.query(
    `
      UPDATE client_billing_cycles
      SET ended_at = $1::date, carryover_out = $2, closed_at = NOW()
      WHERE id = $3
      RETURNING *
    `,
    [end, closing, cycle.id]
  )
  return upd.rows[0]
}

export async function getAccountStatementForCycle(cycleId) {
  const cycle = await getBillingCycleById(cycleId)
  if (!cycle) return null
  const opening = Number(cycle.carry_in ?? 0)
  const invRows = await pool.query(
    `
      SELECT i.id, i.total_amount, i.paid_amount, i.remaining_amount, i.status, i.created_at, b.name AS barn_name
      FROM invoices i
      LEFT JOIN barns b ON b.id = i.barn_id
      WHERE i.billing_cycle_id = $1
        AND COALESCE(i.invoice_lifecycle,'active') != 'cancelled'
      ORDER BY i.created_at ASC
    `,
    [cycleId]
  )
  const invoices = invRows.rows
  await attachInvoiceItems(pool, invoices)
  const payRows = await pool.query(
    `
      SELECT p.id, p.amount, p.payment_date, p.created_at, p.payment_method, p.invoice_id, p.notes, p.settled_at, b.name AS barn_name
      FROM payments p
      LEFT JOIN barns b ON b.id = p.barn_id
      WHERE p.billing_cycle_id = $1
      ORDER BY p.payment_date ASC, p.created_at ASC
    `,
    [cycleId]
  )
  const { rows, closingBalance } = buildAccountStatementRows(opening, invoices, payRows.rows)
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

export async function getAccountStatementAfterCycle(clientId, cycleId) {
  const cycle = await pool
    .query('SELECT * FROM client_billing_cycles WHERE id = $1 AND client_id = $2', [cycleId, clientId])
    .then((r) => r.rows[0] ?? null)
  if (!cycle?.ended_at) return null
  const fromD = addOneCalendarDay(cycle.ended_at)
  if (!fromD) return null
  const toD = normalizeStmtDate(nowIso().slice(0, 10)) || nowIso().slice(0, 10)
  const inner = await getAccountStatementClient(clientId, fromD, toD)
  return { ...inner, after_cycle: { cycle_id: cycle.id, cycle_ended_at: cycle.ended_at, from: fromD, to: toD } }
}

export async function getBarnBillingCycles(barnId) {
  const r = await pool.query('SELECT * FROM barn_billing_cycles WHERE barn_id = $1 ORDER BY id DESC', [barnId])
  return r.rows
}

export async function getOpenBarnBillingCycle(barnId) {
  const r = await pool.query(
    'SELECT * FROM barn_billing_cycles WHERE barn_id = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1',
    [barnId]
  )
  return r.rows[0] ?? null
}

export async function startBarnBillingCycle(barnId, { started_at, carry_in } = {}) {
  const ex = await getOpenBarnBillingCycle(barnId)
  if (ex) throw new Error('يوجد دورة محاسبية مفتوحة لهذا العنبر')
  const b = await getBarnById(barnId)
  if (!b) throw new Error('العنبر غير موجود')
  const start = normalizeStmtDate(started_at) || nowIso().slice(0, 10)
  let carry = carry_in
  if (carry === undefined || carry === null) carry = 0
  else carry = Number(carry) || 0
  const ins = await pool.query(
    `
      INSERT INTO barn_billing_cycles (barn_id, started_at, ended_at, carry_in, created_at)
      VALUES ($1, $2::date, NULL, $3, NOW())
      RETURNING *
    `,
    [barnId, start, carry]
  )
  return ins.rows[0]
}

export async function endBarnBillingCycle(barnId, { ended_at } = {}) {
  const cycle = await getOpenBarnBillingCycle(barnId)
  if (!cycle) throw new Error('لا توجد دورة محاسبية مفتوحة')
  const end = normalizeStmtDate(ended_at) || nowIso().slice(0, 10)
  const stmt = await getAccountStatementForBarnCycle(cycle.id)
  const closing = Number(stmt?.closing_balance ?? 0)
  const upd = await pool.query(
    `
      UPDATE barn_billing_cycles
      SET ended_at = $1::date, carryover_out = $2, closed_at = NOW()
      WHERE id = $3
      RETURNING *
    `,
    [end, closing, cycle.id]
  )
  return upd.rows[0]
}

export async function getAccountStatementForBarnCycle(cycleId) {
  const cycle = await pool
    .query('SELECT * FROM barn_billing_cycles WHERE id = $1', [cycleId])
    .then((r) => r.rows[0] ?? null)
  if (!cycle) return null
  const opening = Number(cycle.carry_in ?? 0)
  const invRows = await pool.query(
    `
      SELECT i.id, i.total_amount, i.paid_amount, i.remaining_amount, i.status, i.created_at, b.name AS barn_name
      FROM invoices i
      LEFT JOIN barns b ON b.id = i.barn_id
      WHERE i.barn_billing_cycle_id = $1
        AND COALESCE(i.invoice_lifecycle,'active') != 'cancelled'
      ORDER BY i.created_at ASC
    `,
    [cycleId]
  )
  const invoices = invRows.rows
  await attachInvoiceItems(pool, invoices)
  const payRows = await pool.query(
    `
      SELECT p.id, p.amount, p.payment_date, p.created_at, p.payment_method, p.invoice_id, p.notes, p.settled_at, b.name AS barn_name
      FROM payments p
      LEFT JOIN barns b ON b.id = p.barn_id
      WHERE p.barn_billing_cycle_id = $1
      ORDER BY p.payment_date ASC, p.created_at ASC
    `,
    [cycleId]
  )
  const { rows, closingBalance } = buildAccountStatementRows(opening, invoices, payRows.rows)
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

export async function getAccountStatementAfterBarnCycle(barnId, cycleId) {
  const cycle = await pool
    .query('SELECT * FROM barn_billing_cycles WHERE id = $1 AND barn_id = $2', [cycleId, barnId])
    .then((r) => r.rows[0] ?? null)
  if (!cycle?.ended_at) return null
  const fromD = addOneCalendarDay(cycle.ended_at)
  if (!fromD) return null
  const toD = normalizeStmtDate(nowIso().slice(0, 10)) || nowIso().slice(0, 10)
  const inner = await getAccountStatementBarn(barnId, fromD, toD)
  return { ...inner, after_cycle: { cycle_id: cycle.id, cycle_ended_at: cycle.ended_at, from: fromD, to: toD } }
}

export async function getSalesByCategory(from, to) {
  const fromD = normalizeStmtDate(from)
  const toD = normalizeStmtDate(to)
  const r = await pool.query(
    `
      SELECT
        COALESCE(p.category, 'غير محددة') AS category,
        COALESCE(SUM(ii.total_price),0) AS total_sales,
        COALESCE(SUM(ii.quantity),0) AS total_quantity
      FROM invoice_items ii
      JOIN invoices inv ON inv.id = ii.invoice_id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE COALESCE(inv.invoice_lifecycle,'active') != 'cancelled'
        AND ($1::date IS NULL OR inv.created_at::date >= $1::date)
        AND ($2::date IS NULL OR inv.created_at::date <= $2::date)
      GROUP BY COALESCE(p.category, 'غير محددة')
      ORDER BY total_sales DESC
    `,
    [fromD, toD]
  )
  return r.rows
}

export async function getTopProducts(from, to, limit = 10, warehouseId = null) {
  const fromD = normalizeStmtDate(from)
  const toD = normalizeStmtDate(to)
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 500)
  const wid = warehouseId != null && warehouseId !== '' ? Number(warehouseId) : null
  const r = await pool.query(
    `
      SELECT
        COALESCE(ii.product_id, 0) AS product_id,
        COALESCE(p.name, ii.product_name) AS name,
        COALESCE(SUM(ii.total_price),0) AS total_sales,
        COALESCE(SUM(ii.quantity),0) AS total_quantity
      FROM invoice_items ii
      JOIN invoices inv ON inv.id = ii.invoice_id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE COALESCE(inv.invoice_lifecycle,'active') != 'cancelled'
        AND ($1::date IS NULL OR inv.created_at::date >= $1::date)
        AND ($2::date IS NULL OR inv.created_at::date <= $2::date)
        AND ($3::bigint IS NULL OR inv.warehouse_id = $3::bigint)
      GROUP BY COALESCE(ii.product_id, 0), COALESCE(p.name, ii.product_name)
      ORDER BY total_sales DESC
      LIMIT $4
    `,
    [fromD, toD, Number.isFinite(wid) ? wid : null, lim]
  )
  return r.rows
}

export async function getDailyInvoiceTotals(days = 30) {
  const n = Math.min(Math.max(1, Number(days) || 30), 90)
  const r = await pool.query(
    `
      WITH RECURSIVE seq(i) AS (
        SELECT 0
        UNION ALL
        SELECT i + 1 FROM seq WHERE i < $1 - 1
      )
      SELECT
        (CURRENT_DATE - (($1 - 1 - seq.i) * INTERVAL '1 day'))::date AS day,
        COALESCE((
          SELECT SUM(total_amount) FROM invoices
          WHERE created_at::date = (CURRENT_DATE - (($1 - 1 - seq.i) * INTERVAL '1 day'))::date
            AND COALESCE(invoice_lifecycle,'active') != 'cancelled'
        ),0) AS total_sales,
        COALESCE((
          SELECT COUNT(*) FROM invoices
          WHERE created_at::date = (CURRENT_DATE - (($1 - 1 - seq.i) * INTERVAL '1 day'))::date
            AND COALESCE(invoice_lifecycle,'active') != 'cancelled'
        ),0)::int AS invoice_count
      FROM seq
      ORDER BY day ASC
    `,
    [n]
  )
  return r.rows
}

export async function getDailyInvoiceTotalsForRange(fromIso, toIso) {
  if (!fromIso || !toIso) return []
  const start = fromIso <= toIso ? fromIso : toIso
  const end = fromIso <= toIso ? toIso : fromIso
  const r = await pool.query(
    `
      WITH RECURSIVE days(d) AS (
        SELECT $1::date
        UNION ALL
        SELECT (d + INTERVAL '1 day')::date FROM days WHERE d < $2::date
      )
      SELECT
        days.d AS day,
        COALESCE((
          SELECT SUM(total_amount) FROM invoices
          WHERE created_at::date = days.d
            AND COALESCE(invoice_lifecycle,'active') != 'cancelled'
        ),0) AS total_sales,
        COALESCE((
          SELECT COUNT(*) FROM invoices
          WHERE created_at::date = days.d
            AND COALESCE(invoice_lifecycle,'active') != 'cancelled'
        ),0)::int AS invoice_count
      FROM days
      ORDER BY day ASC
    `,
    [start, end]
  )
  return r.rows
}

/**
 * @param {number | { limit?: number; payment_method?: string; warehouse_id?: number; from?: string; to?: string; unpaid_only?: boolean }} [limitOrOpts]
 */
export async function getInvoices(limitOrOpts = 50) {
  const opts = typeof limitOrOpts === 'number' ? { limit: limitOrOpts } : limitOrOpts || {}
  const limit = Math.min(Number(opts.limit) || 50, 200)
  const params = []
  let i = 1
  let sql = `
      SELECT *
      FROM invoices
      WHERE COALESCE(invoice_lifecycle, 'active') != 'cancelled'
  `
  if (opts.unpaid_only) {
    sql += ' AND COALESCE(remaining_amount, 0) > 0'
  }
  if (opts.payment_method) {
    const pm = String(opts.payment_method)
    if (pm === 'آجل' || pm === 'credit' || pm === 'deferred') {
      sql += ` AND COALESCE(payment_method, '') IN ('آجل', 'credit', 'deferred')`
    } else {
      sql += ` AND payment_method = $${i++}`
      params.push(pm)
    }
  }
  if (opts.warehouse_id != null && Number.isFinite(Number(opts.warehouse_id))) {
    sql += ` AND warehouse_id = $${i++}`
    params.push(Number(opts.warehouse_id))
  }
  if (opts.from && /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from).slice(0, 10))) {
    sql += ` AND created_at::date >= $${i++}::date`
    params.push(String(opts.from).slice(0, 10))
  }
  if (opts.to && /^\d{4}-\d{2}-\d{2}$/.test(String(opts.to).slice(0, 10))) {
    sql += ` AND created_at::date <= $${i++}::date`
    params.push(String(opts.to).slice(0, 10))
  }
  if (opts.client_id != null && Number.isFinite(Number(opts.client_id))) {
    sql += ` AND client_id = $${i++}`
    params.push(Number(opts.client_id))
  }
  if (opts.barn_id != null && Number.isFinite(Number(opts.barn_id))) {
    sql += ` AND barn_id = $${i++}`
    params.push(Number(opts.barn_id))
  }
  sql += ` ORDER BY id DESC LIMIT $${i}`
  params.push(limit)
  const r = await pool.query(sql, params)
  const out = []
  for (const inv of r.rows) {
    const items = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [inv.id])
    out.push({ ...inv, items: items.rows })
  }
  return out
}

export async function getInvoiceById(id) {
  const inv = await pool.query(
    `
    SELECT
      inv.*,
      wh.name_ar AS warehouse_name_ar,
      (
        COALESCE((SELECT c0.initial_debt FROM clients c0 WHERE c0.id = inv.client_id), 0) +
        COALESCE((
          SELECT SUM(i2.total_amount) FROM invoices i2
          WHERE i2.client_id = inv.client_id
            AND COALESCE(i2.invoice_lifecycle, 'active') != 'cancelled'
            AND (i2.created_at, i2.id) <= (COALESCE(inv.created_at, inv.updated_at, NOW()), inv.id)
        ), 0) -
        COALESCE((
          SELECT SUM(py.amount) FROM payments py
          WHERE py.client_id = inv.client_id
            AND COALESCE(py.payment_method, '') NOT IN ('deferred', 'آجل', 'credit')
            AND py.created_at <= COALESCE(inv.created_at, inv.updated_at, NOW())
        ), 0)
      )::float8 AS client_balance_after,
      (
        COALESCE((SELECT c0.initial_debt FROM clients c0 WHERE c0.id = inv.client_id), 0) +
        COALESCE((
          SELECT SUM(i2.total_amount) FROM invoices i2
          WHERE i2.client_id = inv.client_id
            AND COALESCE(i2.invoice_lifecycle, 'active') != 'cancelled'
            AND (i2.created_at, i2.id) < (COALESCE(inv.created_at, inv.updated_at, NOW()), inv.id)
        ), 0) -
        COALESCE((
          SELECT SUM(py.amount) FROM payments py
          WHERE py.client_id = inv.client_id
            AND COALESCE(py.payment_method, '') NOT IN ('deferred', 'آجل', 'credit')
            AND py.created_at < COALESCE(inv.created_at, inv.updated_at, NOW())
        ), 0)
      )::float8 AS client_balance_before,
      (
        CASE
          WHEN inv.barn_id IS NULL THEN NULL
          ELSE (
            COALESCE((SELECT br.initial_debt FROM barns br WHERE br.id = inv.barn_id), 0) +
            COALESCE((
              SELECT SUM(i2.total_amount) FROM invoices i2
              WHERE i2.barn_id = inv.barn_id
                AND COALESCE(i2.invoice_lifecycle, 'active') != 'cancelled'
                AND (i2.created_at, i2.id) <= (COALESCE(inv.created_at, inv.updated_at, NOW()), inv.id)
            ), 0) -
            COALESCE((
              SELECT SUM(py.amount) FROM payments py
              WHERE py.barn_id = inv.barn_id
                AND COALESCE(py.payment_method, '') NOT IN ('deferred', 'آجل', 'credit')
                AND py.created_at <= COALESCE(inv.created_at, inv.updated_at, NOW())
            ), 0)
          )::float8
        END
      ) AS barn_balance_after,
      (
        CASE
          WHEN inv.barn_id IS NULL THEN NULL
          ELSE (
            COALESCE((SELECT br.initial_debt FROM barns br WHERE br.id = inv.barn_id), 0) +
            COALESCE((
              SELECT SUM(i2.total_amount) FROM invoices i2
              WHERE i2.barn_id = inv.barn_id
                AND COALESCE(i2.invoice_lifecycle, 'active') != 'cancelled'
                AND (i2.created_at, i2.id) < (COALESCE(inv.created_at, inv.updated_at, NOW()), inv.id)
            ), 0) -
            COALESCE((
              SELECT SUM(py.amount) FROM payments py
              WHERE py.barn_id = inv.barn_id
                AND COALESCE(py.payment_method, '') NOT IN ('deferred', 'آجل', 'credit')
                AND py.created_at < COALESCE(inv.created_at, inv.updated_at, NOW())
            ), 0)
          )::float8
        END
      ) AS barn_balance_before
    FROM invoices inv
    LEFT JOIN warehouses wh ON wh.id = inv.warehouse_id
    WHERE inv.id = $1
    LIMIT 1
    `,
    [id]
  )
  const row = inv.rows[0]
  if (!row) return null
  const items = await pool.query(
    `
      SELECT ii.*, p.unit_type AS product_unit_type
      FROM invoice_items ii
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE ii.invoice_id = $1
    `,
    [id]
  )
  return { ...row, items: items.rows }
}

/** GET /payments/:id — same snapshot fields as Supabase Edge */
export async function getPaymentById(id) {
  const out = await pool.query(
    `
    SELECT
      p.*,
      c.name AS client_name,
      b.name AS barn_name,
      (
        COALESCE((SELECT c0.initial_debt FROM clients c0 WHERE c0.id = p.client_id), 0) +
        COALESCE((
          SELECT SUM(i.total_amount) FROM invoices i
          WHERE i.client_id = p.client_id
            AND COALESCE(i.invoice_lifecycle, 'active') != 'cancelled'
            AND i.created_at <= COALESCE(p.created_at, p.payment_date::timestamp)
        ), 0) -
        COALESCE((
          SELECT SUM(py.amount) FROM payments py
          WHERE py.client_id = p.client_id
            AND COALESCE(py.payment_method, '') NOT IN ('deferred', 'آجل', 'credit')
            AND (
              py.created_at < COALESCE(p.created_at, p.payment_date::timestamp)
              OR (
                py.created_at = COALESCE(p.created_at, p.payment_date::timestamp)
                AND py.id <= p.id
              )
            )
        ), 0)
      )::float8 AS client_balance_after,
      (
        CASE
          WHEN COALESCE(p.payment_method, '') IN ('deferred', 'آجل', 'credit') THEN
            (
              COALESCE((SELECT c0.initial_debt FROM clients c0 WHERE c0.id = p.client_id), 0) +
              COALESCE((
                SELECT SUM(i.total_amount) FROM invoices i
                WHERE i.client_id = p.client_id
                  AND COALESCE(i.invoice_lifecycle, 'active') != 'cancelled'
                  AND i.created_at <= COALESCE(p.created_at, p.payment_date::timestamp)
              ), 0) -
              COALESCE((
                SELECT SUM(py.amount) FROM payments py
                WHERE py.client_id = p.client_id
                  AND COALESCE(py.payment_method, '') NOT IN ('deferred', 'آجل', 'credit')
                  AND (
                    py.created_at < COALESCE(p.created_at, p.payment_date::timestamp)
                    OR (
                      py.created_at = COALESCE(p.created_at, p.payment_date::timestamp)
                      AND py.id <= p.id
                    )
                  )
              ), 0)
            )::float8
          ELSE
            (
              COALESCE((SELECT c0.initial_debt FROM clients c0 WHERE c0.id = p.client_id), 0) +
              COALESCE((
                SELECT SUM(i.total_amount) FROM invoices i
                WHERE i.client_id = p.client_id
                  AND COALESCE(i.invoice_lifecycle, 'active') != 'cancelled'
                  AND i.created_at <= COALESCE(p.created_at, p.payment_date::timestamp)
              ), 0) -
              COALESCE((
                SELECT SUM(py.amount) FROM payments py
                WHERE py.client_id = p.client_id
                  AND COALESCE(py.payment_method, '') NOT IN ('deferred', 'آجل', 'credit')
                  AND (
                    py.created_at < COALESCE(p.created_at, p.payment_date::timestamp)
                    OR (
                      py.created_at = COALESCE(p.created_at, p.payment_date::timestamp)
                      AND py.id < p.id
                    )
                  )
              ), 0)
            )::float8
        END
      ) AS client_balance_before,
      (
        CASE
          WHEN COALESCE(p.barn_id, pinv.barn_id) IS NULL THEN NULL
          ELSE (
            COALESCE((SELECT br.initial_debt FROM barns br WHERE br.id = COALESCE(p.barn_id, pinv.barn_id)), 0) +
            COALESCE((
              SELECT SUM(i.total_amount) FROM invoices i
              WHERE i.barn_id = COALESCE(p.barn_id, pinv.barn_id)
                AND COALESCE(i.invoice_lifecycle, 'active') != 'cancelled'
                AND i.created_at <= COALESCE(p.created_at, p.payment_date::timestamp)
            ), 0) -
            COALESCE((
              SELECT SUM(py.amount) FROM payments py
              WHERE py.barn_id = COALESCE(p.barn_id, pinv.barn_id)
                AND COALESCE(py.payment_method, '') NOT IN ('deferred', 'آجل', 'credit')
                AND (
                  py.created_at < COALESCE(p.created_at, p.payment_date::timestamp)
                  OR (
                    py.created_at = COALESCE(p.created_at, p.payment_date::timestamp)
                    AND py.id <= p.id
                  )
                )
            ), 0)
          )::float8
        END
      ) AS barn_balance_after,
      (
        CASE
          WHEN COALESCE(p.barn_id, pinv.barn_id) IS NULL THEN NULL
          WHEN COALESCE(p.payment_method, '') IN ('deferred', 'آجل', 'credit') THEN
            (
              COALESCE((SELECT br.initial_debt FROM barns br WHERE br.id = COALESCE(p.barn_id, pinv.barn_id)), 0) +
              COALESCE((
                SELECT SUM(i.total_amount) FROM invoices i
                WHERE i.barn_id = COALESCE(p.barn_id, pinv.barn_id)
                  AND COALESCE(i.invoice_lifecycle, 'active') != 'cancelled'
                  AND i.created_at <= COALESCE(p.created_at, p.payment_date::timestamp)
              ), 0) -
              COALESCE((
                SELECT SUM(py.amount) FROM payments py
                WHERE py.barn_id = COALESCE(p.barn_id, pinv.barn_id)
                  AND COALESCE(py.payment_method, '') NOT IN ('deferred', 'آجل', 'credit')
                  AND (
                    py.created_at < COALESCE(p.created_at, p.payment_date::timestamp)
                    OR (
                      py.created_at = COALESCE(p.created_at, p.payment_date::timestamp)
                      AND py.id <= p.id
                    )
                  )
              ), 0)
            )::float8
          ELSE
            (
              COALESCE((SELECT br.initial_debt FROM barns br WHERE br.id = COALESCE(p.barn_id, pinv.barn_id)), 0) +
              COALESCE((
                SELECT SUM(i.total_amount) FROM invoices i
                WHERE i.barn_id = COALESCE(p.barn_id, pinv.barn_id)
                  AND COALESCE(i.invoice_lifecycle, 'active') != 'cancelled'
                  AND i.created_at <= COALESCE(p.created_at, p.payment_date::timestamp)
              ), 0) -
              COALESCE((
                SELECT SUM(py.amount) FROM payments py
                WHERE py.barn_id = COALESCE(p.barn_id, pinv.barn_id)
                  AND COALESCE(py.payment_method, '') NOT IN ('deferred', 'آجل', 'credit')
                  AND (
                    py.created_at < COALESCE(p.created_at, p.payment_date::timestamp)
                    OR (
                      py.created_at = COALESCE(p.created_at, p.payment_date::timestamp)
                      AND py.id < p.id
                    )
                  )
              ), 0)
            )::float8
        END
      ) AS barn_balance_before
    FROM payments p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN barns b ON b.id = p.barn_id
    LEFT JOIN invoices pinv ON pinv.id = p.invoice_id
    WHERE p.id = $1
    LIMIT 1
    `,
    [id]
  )
  return out.rows[0] ?? null
}

export async function updateInvoice(id, data) {
  const inv = await pool.query('SELECT * FROM invoices WHERE id = $1', [id])
  if (!inv.rows[0]) return null
  if (String(inv.rows[0].invoice_lifecycle || 'active') === 'cancelled') {
    throw new Error('الفاتورة ملغاة ولا يمكن تعديلها')
  }
  const allowed = ['paid_amount', 'remaining_amount', 'status', 'notes']
  const sets = []
  const vals = []
  let i = 1
  for (const k of allowed) {
    if (data[k] !== undefined) {
      sets.push(`${k} = $${i++}`)
      vals.push(data[k])
    }
  }
  if (!sets.length) return getInvoiceById(id)
  vals.push(id)
  await pool.query(`UPDATE invoices SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals)
  return getInvoiceById(id)
}

async function syncWarehouseStockFromBatchesWithClient(q, productId, warehouseId) {
  const totalRow = await q.query(
    `
      SELECT COALESCE(SUM(
        CASE WHEN COALESCE(unit_type, 'piece') = 'bulk'
          THEN COALESCE(kg_remaining, 0)
          ELSE COALESCE(quantity, 0)
        END
      ), 0) AS total
      FROM product_batches
      WHERE product_id = $1 AND warehouse_id = $2
    `,
    [productId, warehouseId]
  )
  const total = Number(totalRow.rows[0]?.total ?? 0)
  await q.query(
    `
      INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (product_id, warehouse_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
    `,
    [productId, warehouseId, total]
  )
}

async function upsertProductStockWithClient(q, productId, warehouseId, quantityDelta) {
  await upsertBatchWithClient(q, productId, warehouseId, '9999-12-31', quantityDelta)
}

export async function syncWarehouseStockFromBatches(productId, warehouseId) {
  await syncWarehouseStockFromBatchesWithClient(pool, productId, warehouseId)
}

export async function upsertProductStock(productId, warehouseId, quantityDelta) {
  await upsertProductStockWithClient(pool, productId, warehouseId, quantityDelta)
}

async function upsertBatchWithClient(
  q,
  productId,
  warehouseId,
  expiryDate,
  qtyDelta,
  prices = {},
  bulkDetails = null
) {
  const normalizedExpiry = expiryDate || '9999-12-31'
  const pp = prices.purchase_price ?? null
  const selectExisting = await q.query(
    `
      SELECT id, quantity, kg_remaining, bag_count, kg_per_bag
      FROM product_batches
      WHERE product_id = $1
        AND warehouse_id = $2
        AND COALESCE(purchase_price, -1) = COALESCE($3, -1)
        AND expiry_date = $4::date
      ORDER BY id
      LIMIT 1
    `,
    [productId, warehouseId, pp, normalizedExpiry]
  )
  const existing = selectExisting.rows[0]
  let batchId
  if (existing) {
    if (bulkDetails && bulkDetails.unit_type === 'bulk') {
      const bc = Number(bulkDetails.bag_count ?? 0)
      const kpb = Number(bulkDetails.kg_per_bag ?? 0)
      const kgAdd = bc * kpb
      await q.query(
        `
          UPDATE product_batches
          SET quantity = GREATEST(0, COALESCE(quantity,0) + $1),
              bag_count = COALESCE(bag_count,0) + $2,
              kg_per_bag = COALESCE(kg_per_bag, $3),
              kg_remaining = COALESCE(kg_remaining,0) + $4,
              selling_price = COALESCE($5, selling_price),
              updated_at = NOW()
          WHERE id = $6
        `,
        [qtyDelta, bc, kpb || null, kgAdd, prices.selling_price ?? null, existing.id]
      )
    } else {
      await q.query(
        `
          UPDATE product_batches
          SET quantity = GREATEST(0, COALESCE(quantity,0) + $1),
              selling_price = COALESCE($2, selling_price),
              updated_at = NOW()
          WHERE id = $3
        `,
        [qtyDelta, prices.selling_price ?? null, existing.id]
      )
    }
    batchId = existing.id
  } else {
    const isBulk = bulkDetails && bulkDetails.unit_type === 'bulk'
    const bc = isBulk ? Number(bulkDetails.bag_count ?? 0) : null
    const kpb = isBulk ? Number(bulkDetails.kg_per_bag ?? 0) : null
    const kg = isBulk ? bc * kpb : null
    const ins = await q.query(
      `
        INSERT INTO product_batches
        (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price, unit_type, bag_count, kg_per_bag, kg_remaining, source, created_at, updated_at)
        VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, 'supplier_purchase', NOW(), NOW())
        RETURNING id
      `,
      [
        productId,
        warehouseId,
        normalizedExpiry,
        Math.max(0, Number(qtyDelta ?? 0)),
        pp,
        prices.selling_price ?? null,
        isBulk ? 'bulk' : 'piece',
        bc,
        kpb,
        kg,
      ]
    )
    batchId = ins.rows[0].id
  }

  if (bulkDetails && bulkDetails.unit_type === 'bulk' && Number(bulkDetails.bag_count ?? 0) > 0) {
    const bc = Math.max(0, Number(bulkDetails.bag_count ?? 0))
    const kpb = Math.max(0, Number(bulkDetails.kg_per_bag ?? 0))
    const expVal = normalizedExpiry === '9999-12-31' ? null : normalizedExpiry
    const currentCountRow = await q.query('SELECT COUNT(*)::int AS c FROM bag_instances WHERE batch_id = $1', [
      batchId,
    ])
    const currentCount = Number(currentCountRow.rows[0]?.c ?? 0)
    for (let idx = 0; idx < bc; idx += 1) {
      await q.query(
        `
          INSERT INTO bag_instances
          (batch_id, product_id, warehouse_id, bag_number, kg_total, kg_remaining, status, expiry_date, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'sealed', $7::date, NOW())
        `,
        [batchId, productId, warehouseId, currentCount + idx + 1, kpb, kpb, expVal]
      )
    }
    const open = await q.query(
      "SELECT id FROM bag_instances WHERE product_id = $1 AND warehouse_id = $2 AND status = 'open' LIMIT 1",
      [productId, warehouseId]
    )
    if (!open.rows[0]) {
      await q.query(
        `
          UPDATE bag_instances
          SET status = 'open', opened_at = NOW()
          WHERE id = (
            SELECT id FROM bag_instances
            WHERE product_id = $1 AND warehouse_id = $2 AND status = 'sealed'
            ORDER BY expiry_date ASC NULLS LAST, id ASC
            LIMIT 1
          )
        `,
        [productId, warehouseId]
      )
    }
  }

  await syncWarehouseStockFromBatchesWithClient(q, productId, warehouseId)
}

export async function upsertBatch(productId, warehouseId, expiryDate, qtyDelta, prices = {}, bulkDetails = null) {
  await upsertBatchWithClient(pool, productId, warehouseId, expiryDate, qtyDelta, prices, bulkDetails)
}

export async function createSupplierReceipt(data) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const items = Array.isArray(data.items) ? data.items : []
    const totalAmount = items.reduce((sum, it) => {
      const q = Number(it.quantity ?? 0)
      const up = Number(it.unit_price ?? 0)
      if (it.unit_type === 'bulk') {
        const kpb = Number(it.kg_per_bag ?? 0)
        return sum + q * kpb * up
      }
      return sum + q * up
    }, 0)
    const warehouseId = Number(data.warehouse_id ?? 1)
    const insPurchase = await client.query(
      `
        INSERT INTO supplier_purchases
        (supplier_id, warehouse_id, total_amount, notes, created_at, created_by)
        VALUES ($1, $2, $3, $4, NOW(), NULL)
        RETURNING id
      `,
      [data.supplier_id, warehouseId, totalAmount, data.notes ?? null]
    )
    const purchaseId = insPurchase.rows[0].id

    for (const it of items) {
      const expiryDate = it.expiry_date || null
      const qty = Number(it.quantity ?? 0)
      const unitPrice = Number(it.unit_price ?? 0)
      const kpb = Number(it.kg_per_bag ?? 0)
      const totalPrice = it.unit_type === 'bulk' ? qty * kpb * unitPrice : qty * unitPrice

      await client.query(
        `
          INSERT INTO supplier_purchase_items
          (supplier_purchase_id, product_id, quantity, unit_price, total_price, created_at, expiry_date, unit_type, kg_per_bag)
          VALUES ($1, $2, $3, $4, $5, NOW(), $6::date, $7, $8)
        `,
        [purchaseId, it.product_id, qty, unitPrice, totalPrice, expiryDate, it.unit_type || 'piece', kpb || null]
      )

      const purchasePrice = unitPrice > 0 ? unitPrice : null
      let sellingPriceForBatch = null
      if (purchasePrice != null) {
        const rawSp = it.selling_price
        if (rawSp !== undefined && rawSp !== null && String(rawSp).trim() !== '') {
          const n = Number(rawSp)
          if (Number.isFinite(n) && n > 0) sellingPriceForBatch = n
        }
        if (sellingPriceForBatch == null) {
          const markupRaw = await getSetting('default_markup_percent')
          const markupPct = Number.parseFloat(markupRaw || '0')
          sellingPriceForBatch =
            markupPct > 0
              ? Math.round(purchasePrice * (1 + markupPct / 100) * 100) / 100
              : purchasePrice
        }
        await client.query(
          'UPDATE products SET purchase_price = $1, selling_price = $2, updated_at = NOW() WHERE id = $3',
          [purchasePrice, sellingPriceForBatch, it.product_id]
        )
      }

      const batchPrices = { purchase_price: purchasePrice, selling_price: sellingPriceForBatch }
      const batchExpiry = expiryDate || '9999-12-31'
      const distribution = it.distribution || {}
      if (Object.keys(distribution).length > 0) {
        for (const [wh, q] of Object.entries(distribution)) {
          const whId = Number(wh)
          const qq = Number(q || 0)
          const bulkDetails =
            it.unit_type === 'bulk'
              ? { unit_type: 'bulk', bag_count: qq, kg_per_bag: Number(it.kg_per_bag ?? 0) }
              : null
          await upsertBatchWithClient(
            client,
            it.product_id,
            whId,
            batchExpiry,
            qq,
            batchPrices,
            bulkDetails
          )
        }
      } else {
        const bulkDetails =
          it.unit_type === 'bulk'
            ? { unit_type: 'bulk', bag_count: qty, kg_per_bag: Number(it.kg_per_bag ?? 0) }
            : null
        await upsertBatchWithClient(
          client,
          it.product_id,
          warehouseId,
          batchExpiry,
          qty,
          batchPrices,
          bulkDetails
        )
      }
    }

    await client.query('COMMIT')
    const out = await pool.query('SELECT * FROM supplier_purchases WHERE id = $1', [purchaseId])
    return out.rows[0] ?? null
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

async function reverseRoutedPaymentWithClient(q, paymentRow, invoiceId) {
  const method = String(paymentRow.payment_method || '')
  if (method === 'deferred' || method === 'historical_invoice_paid') return
  if (method === 'cash') {
    await q.query("DELETE FROM safe_transactions WHERE reference_type = 'payment' AND reference_id = $1", [
      paymentRow.id,
    ])
  } else if (method === 'vodafone_cash' || method === 'instapay') {
    await q.query(
      "DELETE FROM wallet_transactions WHERE reference_type = 'payment' AND reference_id = $1",
      [paymentRow.id]
    )
  }
  if (method === 'historical_invoice_paid' && Number(paymentRow.amount ?? 0) > 0) {
    await q.query(
      `
        INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
        VALUES ('adjustment_out', $1, 'invoice_cancel', $2, $3, NOW(), NULL)
      `,
      [Number(paymentRow.amount ?? 0), invoiceId, `إلغاء فاتورة #${invoiceId} (مدفوع ترحيل)`]
    )
  }
}

async function reverseInvoiceItemWithClient(q, invoiceItemId) {
  const itemQ = await q.query(
    `
      SELECT ii.*, i.warehouse_id AS invoice_warehouse_id, p.unit_type AS product_unit_type
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE ii.id = $1
    `,
    [invoiceItemId]
  )
  const item = itemQ.rows[0]
  if (!item) return
  const unitType = item.product_unit_type || 'piece'
  const whId = item.batch_warehouse_id ?? item.invoice_warehouse_id
  if (!item.product_id || !whId) return

  if (unitType === 'bulk') {
    const bagAllocs = await q.query(
      'SELECT id, bag_id, amount_kg FROM invoice_item_bags WHERE invoice_item_id = $1 ORDER BY id DESC',
      [invoiceItemId]
    )
    for (const al of bagAllocs.rows) {
      await q.query(
        `
          UPDATE bag_instances
          SET kg_remaining = COALESCE(kg_remaining,0) + $1,
              status = CASE WHEN status = 'empty' AND COALESCE(kg_remaining,0) + $1 > 0.001 THEN 'open' ELSE status END
          WHERE id = $2
        `,
        [Number(al.amount_kg ?? 0), al.bag_id]
      )
    }
    await q.query(
      `
        UPDATE product_batches pb
        SET kg_remaining = COALESCE((
          SELECT SUM(bi.kg_remaining) FROM bag_instances bi WHERE bi.batch_id = pb.id
        ),0), updated_at = NOW()
        WHERE pb.id IN (
          SELECT b.batch_id
          FROM bag_instances b
          INNER JOIN invoice_item_bags iib ON iib.bag_id = b.id
          WHERE iib.invoice_item_id = $1
        )
      `,
      [invoiceItemId]
    )
    await q.query('DELETE FROM invoice_item_bags WHERE invoice_item_id = $1', [invoiceItemId])
    await syncWarehouseStockFromBatchesWithClient(q, item.product_id, whId)
    return
  }
  const batchAllocs = await q.query(
    'SELECT id, batch_id, quantity FROM invoice_item_batches WHERE invoice_item_id = $1 ORDER BY id DESC',
    [invoiceItemId]
  )
  if (batchAllocs.rows.length > 0) {
    for (const al of batchAllocs.rows) {
      await q.query(
        'UPDATE product_batches SET quantity = COALESCE(quantity,0) + $1, updated_at = NOW() WHERE id = $2',
        [Number(al.quantity ?? 0), al.batch_id]
      )
    }
    await q.query('DELETE FROM invoice_item_batches WHERE invoice_item_id = $1', [invoiceItemId])
    await syncWarehouseStockFromBatchesWithClient(q, item.product_id, whId)
  } else {
    await upsertBatchWithClient(q, item.product_id, whId, '9999-12-31', Number(item.quantity ?? 0))
  }
}

export async function cancelInvoice(id) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const invQ = await client.query('SELECT * FROM invoices WHERE id = $1', [id])
    const inv = invQ.rows[0]
    if (!inv) {
      await client.query('COMMIT')
      return null
    }
    if (String(inv.invoice_lifecycle || 'active') === 'cancelled') {
      throw new Error('الفاتورة ملغاة مسبقاً')
    }

    const itemIds = await client.query('SELECT id FROM invoice_items WHERE invoice_id = $1', [id])
    for (const r of itemIds.rows) {
      await reverseInvoiceItemWithClient(client, r.id)
    }

    const linkedPayments = await client.query('SELECT * FROM payments WHERE invoice_id = $1', [id])
    for (const p of linkedPayments.rows) {
      await reverseRoutedPaymentWithClient(client, p, id)
    }
    await client.query('DELETE FROM payments WHERE invoice_id = $1', [id])

    const paid = Number(inv.paid_amount ?? 0)
    const pm = String(inv.payment_method || 'cash')
    if (paid > 0 && pm === 'cash' && linkedPayments.rows.length === 0) {
      await client.query(
        `
          INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
          VALUES ('adjustment_out', $1, 'invoice_cancel', $2, $3, NOW(), NULL)
        `,
        [paid, id, `إلغاء فاتورة #${id}`]
      )
    }

    await client.query(
      'UPDATE clients SET total_profit = GREATEST(0, COALESCE(total_profit,0) - $1) WHERE id = $2',
      [Number(inv.profit_amount ?? 0), inv.client_id]
    )
    if (inv.barn_id) {
      await client.query(
        `
          UPDATE barns
          SET total_invoices = GREATEST(0, COALESCE(total_invoices,0) - 1),
              total_profit = GREATEST(0, COALESCE(total_profit,0) - $1)
          WHERE id = $2
        `,
        [Number(inv.profit_amount ?? 0), inv.barn_id]
      )
    }

    await client.query(
      `
        UPDATE invoices
        SET invoice_lifecycle = 'cancelled',
            profit_amount = 0,
            paid_amount = 0,
            remaining_amount = 0,
            status = 'معلق',
            updated_at = NOW()
        WHERE id = $1
      `,
      [id]
    )
    await client.query('COMMIT')
    return getInvoiceById(id)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function deleteInvoice(id) {
  return cancelInvoice(id)
}

function assertInvoiceEditableRow(inv) {
  if (String(inv?.invoice_lifecycle || 'active') === 'cancelled') {
    throw new Error('الفاتورة ملغاة ولا يمكن تعديلها')
  }
}

async function recalcInvoiceFinancialsWithClient(q, invoiceId) {
  const invQ = await q.query('SELECT * FROM invoices WHERE id = $1', [invoiceId])
  const inv = invQ.rows[0]
  if (!inv) return null
  const oldProfit = Number(inv.profit_amount ?? 0)
  const itemsQ = await q.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [invoiceId])
  const items = itemsQ.rows
  const subtotal = items.reduce((a, i) => a + Number(i.total_price ?? 0), 0)
  const discountAmount = Math.max(0, Number(inv.discount_amount ?? 0))
  const total = Math.max(0, subtotal - discountAmount)
  let paid = Math.max(0, Number(inv.paid_amount ?? 0))
  if (paid > total) paid = total
  const remaining = Math.max(0, total - paid)
  let status = 'معلق'
  if (total > 0 && paid >= total) status = 'مدفوعة'
  else if (paid > 0) status = 'جزئي'

  let totalCost = 0
  for (const it of items) {
    let pp = it.unit_purchase_price
    if (pp == null && it.product_id) {
      const p = await q.query('SELECT purchase_price FROM products WHERE id = $1', [it.product_id])
      pp = p.rows[0]?.purchase_price ?? 0
    }
    totalCost += (Number(it.quantity) || 0) * Number(pp ?? 0)
  }
  const newProfit = Math.max(0, total - totalCost)
  await q.query(
    `
      UPDATE invoices
      SET total_amount = $1, paid_amount = $2, remaining_amount = $3, profit_amount = $4, status = $5, updated_at = NOW()
      WHERE id = $6
    `,
    [total, paid, remaining, newProfit, status, invoiceId]
  )
  await q.query(
    'UPDATE clients SET total_profit = GREATEST(0, COALESCE(total_profit,0) - $1 + $2) WHERE id = $3',
    [oldProfit, newProfit, inv.client_id]
  )
  if (inv.barn_id) {
    await q.query(
      'UPDATE barns SET total_profit = GREATEST(0, COALESCE(total_profit,0) - $1 + $2) WHERE id = $3',
      [oldProfit, newProfit, inv.barn_id]
    )
  }
}

export async function deleteInvoiceItem(invoiceId, itemId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const invQ = await client.query('SELECT * FROM invoices WHERE id = $1', [invoiceId])
    const inv = invQ.rows[0]
    if (!inv) throw new Error('الفاتورة غير موجودة')
    assertInvoiceEditableRow(inv)

    const itemQ = await client.query('SELECT * FROM invoice_items WHERE id = $1 AND invoice_id = $2', [
      itemId,
      invoiceId,
    ])
    const item = itemQ.rows[0]
    if (!item) throw new Error('الصنف غير موجود في هذه الفاتورة')
    const leftQ = await client.query('SELECT COUNT(*)::int AS c FROM invoice_items WHERE invoice_id = $1', [
      invoiceId,
    ])
    if (Number(leftQ.rows[0]?.c ?? 0) <= 1) {
      throw new Error('لا يمكن حذف آخر صنف — ألغِ الفاتورة أو أضف صنفاً آخر أولاً')
    }

    await reverseInvoiceItemWithClient(client, itemId)
    await client.query('DELETE FROM invoice_items WHERE id = $1', [itemId])
    await recalcInvoiceFinancialsWithClient(client, invoiceId)
    await client.query('COMMIT')
    return getInvoiceById(invoiceId)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function returnPartialInvoiceItem(invoiceId, itemId, returnedQuantity, notes) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const invQ = await client.query('SELECT * FROM invoices WHERE id = $1', [invoiceId])
    const inv = invQ.rows[0]
    if (!inv) throw new Error('الفاتورة غير موجودة')
    assertInvoiceEditableRow(inv)

    const itemQ = await client.query(
      `
        SELECT ii.*, i.warehouse_id AS invoice_warehouse_id, p.unit_type AS product_unit_type
        FROM invoice_items ii
        INNER JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN products p ON p.id = ii.product_id
        WHERE ii.id = $1 AND ii.invoice_id = $2
      `,
      [itemId, invoiceId]
    )
    const item = itemQ.rows[0]
    if (!item) throw new Error('الصنف غير موجود في هذه الفاتورة')
    const ret = Number(returnedQuantity)
    const lineQty = Number(item.quantity ?? 0)
    if (!Number.isFinite(ret) || ret <= 0 || ret > lineQty + 0.0001) {
      throw new Error('كمية الإرجاع غير صالحة')
    }

    const unitType = item.product_unit_type || 'piece'
    const whId = item.batch_warehouse_id ?? item.invoice_warehouse_id
    if (!item.product_id || !whId) throw new Error('بيانات المخزون غير مكتملة')

    if (unitType === 'bulk') {
      const bagAllocs = await client.query(
        'SELECT id, bag_id, amount_kg FROM invoice_item_bags WHERE invoice_item_id = $1 ORDER BY id DESC',
        [itemId]
      )
      let left = ret
      for (const al of bagAllocs.rows) {
        if (left <= 0.0001) break
        const used = Number(al.amount_kg ?? 0)
        const take = Math.min(left, used)
        if (take <= 0) continue
        await client.query(
          `
            UPDATE bag_instances
            SET kg_remaining = COALESCE(kg_remaining,0) + $1,
                status = CASE WHEN status = 'empty' AND COALESCE(kg_remaining,0) + $1 > 0.001 THEN 'open' ELSE status END
            WHERE id = $2
          `,
          [take, al.bag_id]
        )
        const newAmt = used - take
        if (newAmt <= 0.001) {
          await client.query('DELETE FROM invoice_item_bags WHERE id = $1', [al.id])
        } else {
          await client.query('UPDATE invoice_item_bags SET amount_kg = $1 WHERE id = $2', [newAmt, al.id])
        }
        left -= take
      }
      if (left > 0.001) throw new Error('تعذر مطابقة أرصدة الشكاير للإرجاع')

      await client.query(
        `
          UPDATE product_batches pb
          SET kg_remaining = COALESCE((
            SELECT SUM(bi.kg_remaining) FROM bag_instances bi WHERE bi.batch_id = pb.id
          ),0), updated_at = NOW()
          WHERE pb.product_id = $1 AND pb.warehouse_id = $2
        `,
        [item.product_id, whId]
      )
      await syncWarehouseStockFromBatchesWithClient(client, item.product_id, whId)
    } else {
      const batchAllocs = await client.query(
        'SELECT id, batch_id, quantity FROM invoice_item_batches WHERE invoice_item_id = $1 ORDER BY id DESC',
        [itemId]
      )
      if (batchAllocs.rows.length > 0) {
        let left = ret
        for (const al of batchAllocs.rows) {
          if (left <= 0.0001) break
          const used = Number(al.quantity ?? 0)
          const take = Math.min(left, used)
          if (take <= 0) continue
          await client.query(
            'UPDATE product_batches SET quantity = COALESCE(quantity,0) + $1, updated_at = NOW() WHERE id = $2',
            [take, al.batch_id]
          )
          const newQ = used - take
          if (newQ <= 0.001) {
            await client.query('DELETE FROM invoice_item_batches WHERE id = $1', [al.id])
          } else {
            await client.query('UPDATE invoice_item_batches SET quantity = $1 WHERE id = $2', [newQ, al.id])
          }
          left -= take
        }
        if (left > 0.001) throw new Error('تعذر مطابقة الدُفعات للإرجاع')
        await syncWarehouseStockFromBatchesWithClient(client, item.product_id, whId)
      } else {
        await upsertProductStockWithClient(client, item.product_id, whId, ret)
      }
    }

    const newQty = lineQty - ret
    const unitPrice = Number(item.unit_price ?? 0)
    const newTotal = Math.max(0, unitPrice * newQty)
    await client.query('UPDATE invoice_items SET quantity = $1, total_price = $2 WHERE id = $3', [
      newQty,
      newTotal,
      itemId,
    ])

    const rd = await client.query(
      `
        INSERT INTO return_documents (invoice_id, client_id, barn_id, notes, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING id
      `,
      [invoiceId, inv.client_id ?? null, inv.barn_id ?? null, notes ?? null]
    )
    await client.query(
      `
        INSERT INTO return_items (return_document_id, invoice_item_id, batch_id, bag_instance_id, returned_quantity, notes, return_date)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `,
      [rd.rows[0].id, itemId, item.batch_id ?? null, item.sold_from_bag_id ?? null, ret, notes ?? null]
    )

    await recalcInvoiceFinancialsWithClient(client, invoiceId)
    await client.query('COMMIT')
    return getInvoiceById(invoiceId)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

async function allocatePieceBatchesFefo(q, productId, warehouseId, totalQty) {
  const rows = await q.query(
    `
      SELECT pb.id, pb.quantity, pb.expiry_date, pb.selling_price
      FROM product_batches pb
      JOIN products p ON p.id = pb.product_id
      WHERE pb.product_id = $1
        AND pb.warehouse_id = $2
        AND COALESCE(p.unit_type, 'piece') != 'bulk'
        AND COALESCE(pb.quantity,0) > 0
      ORDER BY pb.expiry_date ASC, pb.id ASC
    `,
    [productId, warehouseId]
  )
  const totalAvail = rows.rows.reduce((s, r) => s + Number(r.quantity ?? 0), 0)
  if (totalAvail + 0.0001 < totalQty) {
    throw new Error(`الكمية المتاحة في الدُفعات غير كافية للمنتج (مطلوب: ${totalQty}، متاح: ${totalAvail})`)
  }
  const out = []
  let rem = totalQty
  for (const r of rows.rows) {
    if (rem <= 0.0001) break
    const take = Math.min(rem, Number(r.quantity ?? 0))
    if (take > 0) {
      out.push({ batch_id: r.id, quantity: take })
      rem -= take
    }
  }
  return out
}

async function allocateBulkBagsFefo(q, productId, warehouseId, totalKilos) {
  const rows = await q.query(
    `
      SELECT pb.id, pb.kg_remaining, pb.expiry_date, pb.selling_price
      FROM product_batches pb
      JOIN products p ON p.id = pb.product_id
      WHERE pb.product_id = $1
        AND pb.warehouse_id = $2
        AND p.unit_type = 'bulk'
        AND COALESCE(pb.kg_remaining,0) > 0
      ORDER BY pb.expiry_date ASC, pb.id ASC
    `,
    [productId, warehouseId]
  )
  const totalAvail = rows.rows.reduce((s, r) => s + Number(r.kg_remaining ?? 0), 0)
  if (totalAvail + 0.0001 < totalKilos) {
    throw new Error(`الوزن المتاح غير كافٍ للمنتج (مطلوب: ${totalKilos} كيلو، متاح: ${totalAvail} كيلو)`)
  }
  const out = []
  let rem = totalKilos
  for (const r of rows.rows) {
    if (rem <= 0.0001) break
    const take = Math.min(rem, Number(r.kg_remaining ?? 0))
    if (take > 0) {
      out.push({ bag_id: r.id, batch_id: r.batch_id, amount_kg: take })
      rem -= take
    }
  }
  return out
}

async function allocateFromSpecificBag(q, bagId, productId, warehouseId, totalKilos) {
  const row = await q.query(
    `
      SELECT id, batch_id, kg_remaining, status
      FROM bag_instances
      WHERE id = $1 AND product_id = $2 AND warehouse_id = $3
    `,
    [bagId, productId, warehouseId]
  )
  const bag = row.rows[0]
  if (!bag) throw new Error('الشكارة غير موجودة أو لا تطابق المخزن')
  if (!['open', 'sealed'].includes(String(bag.status))) throw new Error('هذه الشكارة غير متاحة للبيع')
  const avail = Number(bag.kg_remaining ?? 0)
  if (avail <= 0) throw new Error('لا يوجد وزن متبقٍ في هذه الشكارة')
  if (totalKilos > avail + 0.001) throw new Error(`الكمية تتجاوز المتبقي في الشكارة (متاح: ${avail} كجم)`)
  return [{ bag_id: bag.id, batch_id: bag.batch_id, amount_kg: totalKilos }]
}

async function routePaymentWithClient(q, paymentRow) {
  const method = String(paymentRow.payment_method || '')
  const amount = Number(paymentRow.amount ?? 0)
  if (method === 'deferred' || method === 'historical_invoice_paid') return
  if (method === 'cash') {
    await q.query(
      `
        INSERT INTO safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
        VALUES ('customer_payment_in', $1, 'payment', $2, NULL, NOW(), NULL)
      `,
      [amount, paymentRow.id]
    )
  } else if (method === 'vodafone_cash' || method === 'instapay') {
    await q.query(
      `
        INSERT INTO wallet_transactions (type, amount, wallet_id, reference_type, reference_id, notes, created_at, created_by)
        VALUES ('invoice_payment_in', $1, $2, 'payment', $3, NULL, NOW(), NULL)
      `,
      [amount, paymentRow.wallet_id ?? null, paymentRow.id]
    )
  }
}

async function insertPaymentWithRouting(q, payload) {
  const paymentDate = payload.payment_date || nowIso().slice(0, 10)
  const ins = await q.query(
    `
      INSERT INTO payments
      (client_id, barn_id, amount, payment_method, notes, payment_date, created_at, created_by, billing_cycle_id, barn_billing_cycle_id, invoice_id, wallet_id, settled_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NULL,$7,$8,$9,$10,$11)
      RETURNING *
    `,
    [
      payload.client_id,
      payload.barn_id ?? null,
      payload.amount ?? 0,
      payload.payment_method || 'cash',
      payload.notes ?? null,
      paymentDate,
      payload.billing_cycle_id ?? null,
      payload.barn_billing_cycle_id ?? null,
      payload.invoice_id ?? null,
      payload.wallet_id ?? null,
      payload.settled_at ?? null,
    ]
  )
  const row = ins.rows[0]
  await routePaymentWithClient(q, row)
  return row
}

export async function createInvoice(data) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const t = nowIso()
    const items = Array.isArray(data.items) ? data.items : []
    const subtotal = items.reduce((a, i) => a + Number(i.total_price || 0), 0)
    const discountAmount = Math.max(0, Number(data.discount_amount ?? 0))
    const total = Math.max(0, subtotal - discountAmount)
    let paid = Math.max(0, Number(data.paid_amount ?? 0))
    if (paid > total) paid = total
    const remaining = Math.max(0, total - paid)
    if (remaining > 0 && data.register_deferred !== true && paid > 0) {
      throw new Error('المبلغ المدفوع أقل من إجمالي الفاتورة.\nيرجى إدخال المبلغ المتبقي أو تسجيله كآجل')
    }
    let status = 'معلق'
    if (total > 0 && paid >= total) status = 'مدفوعة'
    else if (paid > 0) status = 'جزئي'
    const invoicePaymentMethod =
      remaining > 0 ? 'آجل' : data.immediate_payment_method || data.payment_method || 'cash'

    const pids = [...new Set(items.map((i) => i.product_id).filter(Boolean))]
    const pMap = {}
    const utMap = {}
    if (pids.length) {
      const r = await client.query('SELECT id, purchase_price, unit_type FROM products WHERE id = ANY($1)', [
        pids,
      ])
      for (const row of r.rows) {
        pMap[row.id] = Number(row.purchase_price ?? 0)
        utMap[row.id] = row.unit_type || 'piece'
      }
    }
    const totalCost = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(pMap[i.product_id] ?? 0), 0)
    const profit = Math.max(0, total - totalCost)

    let billingCycleId = null
    if (data.client_id) {
      const oc = await client.query(
        'SELECT id FROM client_billing_cycles WHERE client_id = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1',
        [data.client_id]
      )
      billingCycleId = oc.rows[0]?.id ?? null
    }
    let barnBillingCycleId = null
    if (data.barn_id) {
      const ob = await client.query(
        'SELECT id FROM barn_billing_cycles WHERE barn_id = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1',
        [data.barn_id]
      )
      barnBillingCycleId = ob.rows[0]?.id ?? null
    }
    const dueDate =
      data.due_date != null && String(data.due_date).trim() !== ''
        ? String(data.due_date).trim().slice(0, 10)
        : null
    const insInv = await client.query(
      `
        INSERT INTO invoices
        (client_id, barn_id, warehouse_id, customer_name, total_amount, paid_amount, remaining_amount, profit_amount, payment_method, status, notes, discount_amount, created_at, created_by, billing_cycle_id, barn_billing_cycle_id, due_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NULL,$13,$14,$15)
        RETURNING id
      `,
      [
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
        billingCycleId,
        barnBillingCycleId,
        dueDate,
      ]
    )
    const invoiceId = insInv.rows[0].id
    const bulkNotifications = []

    for (const it of items) {
      const qty = Number(it.quantity ?? 0)
      const dispQtyRaw = it.display_quantity != null ? Number(it.display_quantity) : qty
      const dispU = it.display_unit === 'gram' ? 'gram' : 'kg'
      const insItem = await client.query(
        `
          INSERT INTO invoice_items
          (invoice_id, product_id, product_name, quantity, unit_price, total_price, batch_id, display_quantity, display_unit, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
          RETURNING id
        `,
        [
          invoiceId,
          it.product_id,
          it.product_name || '',
          qty,
          Number(it.unit_price ?? 0),
          Number(it.total_price ?? 0),
          it.batch_id ?? null,
          dispQtyRaw,
          dispU,
        ]
      )
      const itemId = insItem.rows[0].id
      if (qty > 0 && it.product_id) {
        if (utMap[it.product_id] === 'bulk') {
          const allocs = it.bag_id
            ? await allocateFromSpecificBag(client, it.bag_id, it.product_id, data.warehouse_id, qty)
            : await allocateBulkBagsFefo(client, it.product_id, data.warehouse_id, qty)
          for (const al of allocs) {
            await client.query(
              'INSERT INTO invoice_item_bags (invoice_item_id, bag_id, amount_kg) VALUES ($1,$2,$3)',
              [itemId, al.bag_id, al.amount_kg]
            )
            await client.query(
              'UPDATE product_batches SET kg_remaining = GREATEST(0, COALESCE(kg_remaining,0) - $1), updated_at = NOW() WHERE id = $2',
              [al.amount_kg, al.batch_id]
            )
            await client.query(
              "UPDATE bag_instances SET kg_remaining = GREATEST(0, COALESCE(kg_remaining,0) - $1), status = CASE WHEN COALESCE(kg_remaining,0) - $1 <= 0.001 THEN 'empty' ELSE status END WHERE id = $2",
              [al.amount_kg, al.bag_id]
            )
          }
          const open = await client.query(
            "SELECT id FROM bag_instances WHERE product_id = $1 AND warehouse_id = $2 AND status = 'open' LIMIT 1",
            [it.product_id, data.warehouse_id]
          )
          if (!open.rows[0]) {
            const ur = await client.query(
              `
                UPDATE bag_instances SET status = 'open', opened_at = NOW()
                WHERE id = (
                  SELECT id FROM bag_instances
                  WHERE product_id = $1 AND warehouse_id = $2 AND status = 'sealed'
                  ORDER BY expiry_date ASC NULLS LAST, id ASC
                  LIMIT 1
                )
                RETURNING id
              `,
              [it.product_id, data.warehouse_id]
            )
            if (ur.rows[0]) {
              bulkNotifications.push({
                type: 'bag_auto_opened',
                product_id: it.product_id,
                product_name: it.product_name || '',
              })
            }
          }
          await syncWarehouseStockFromBatchesWithClient(client, it.product_id, data.warehouse_id)
        } else {
          if (it.batch_id) {
            const b = await client.query('SELECT quantity FROM product_batches WHERE id = $1', [it.batch_id])
            const avail = Number(b.rows[0]?.quantity ?? 0)
            if (avail + 0.0001 < qty) {
              throw new Error(`الكمية المطلوبة تتجاوز المخزون المتاح في هذه الدفعة (متاح: ${avail})`)
            }
            await client.query(
              'UPDATE product_batches SET quantity = GREATEST(0, COALESCE(quantity,0) - $1), updated_at = NOW() WHERE id = $2',
              [qty, it.batch_id]
            )
            await client.query(
              'INSERT INTO invoice_item_batches (invoice_item_id, batch_id, quantity) VALUES ($1,$2,$3)',
              [itemId, it.batch_id, qty]
            )
            await syncWarehouseStockFromBatchesWithClient(client, it.product_id, data.warehouse_id)
          } else {
            const allocs = await allocatePieceBatchesFefo(client, it.product_id, data.warehouse_id, qty)
            for (const al of allocs) {
              await client.query(
                'INSERT INTO invoice_item_batches (invoice_item_id, batch_id, quantity) VALUES ($1,$2,$3)',
                [itemId, al.batch_id, al.quantity]
              )
              await client.query(
                'UPDATE product_batches SET quantity = GREATEST(0, COALESCE(quantity,0) - $1), updated_at = NOW() WHERE id = $2',
                [al.quantity, al.batch_id]
              )
            }
            await syncWarehouseStockFromBatchesWithClient(client, it.product_id, data.warehouse_id)
          }
        }
      }
    }

    await client.query('UPDATE clients SET total_profit = COALESCE(total_profit,0) + $1 WHERE id = $2', [
      profit,
      data.client_id,
    ])
    if (data.barn_id) {
      await client.query(
        'UPDATE barns SET total_invoices = COALESCE(total_invoices,0) + 1, total_profit = COALESCE(total_profit,0) + $1 WHERE id = $2',
        [profit, data.barn_id]
      )
    }

    const immediate = data.immediate_payment_method ||
      (['cash', 'vodafone_cash', 'instapay'].includes(data.payment_method) ? data.payment_method : 'cash')
    if (paid > 0) {
      await insertPaymentWithRouting(client, {
        client_id: data.client_id,
        barn_id: data.barn_id ?? null,
        amount: paid,
        payment_method: immediate,
        notes: `دفعة فاتورة #${invoiceId}`,
        payment_date: t.slice(0, 10),
        billing_cycle_id: billingCycleId,
        barn_billing_cycle_id: barnBillingCycleId,
        invoice_id: invoiceId,
        wallet_id: data.wallet_id ?? null,
      })
    }
    if (remaining > 0 && (data.register_deferred === true || paid === 0)) {
      await insertPaymentWithRouting(client, {
        client_id: data.client_id,
        barn_id: data.barn_id ?? null,
        amount: remaining,
        payment_method: 'deferred',
        notes: `آجل فاتورة #${invoiceId}`,
        payment_date: t.slice(0, 10),
        billing_cycle_id: billingCycleId,
        barn_billing_cycle_id: barnBillingCycleId,
        invoice_id: invoiceId,
      })
    }

    await client.query('COMMIT')
    const out = await getInvoiceById(invoiceId)
    return { ...out, bulk_notifications: bulkNotifications }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function replaceInvoice(id, data) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const invQ = await client.query('SELECT * FROM invoices WHERE id = $1', [id])
    const inv = invQ.rows[0]
    if (!inv) return null
    assertInvoiceEditableRow(inv)

    const items = Array.isArray(data.items) ? data.items : []
    if (!items.length) throw new Error('أضف صنفاً واحداً على الأقل')

    const warehouseId = inv.warehouse_id
    const clientId = inv.client_id
    const barnId = inv.barn_id
    const oldProfit = Number(inv.profit_amount ?? 0)

    const oldItems = await client.query('SELECT id FROM invoice_items WHERE invoice_id = $1', [id])
    for (const it of oldItems.rows) {
      await reverseInvoiceItemWithClient(client, it.id)
    }
    await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id])

    const oldPayments = await client.query('SELECT * FROM payments WHERE invoice_id = $1', [id])
    for (const p of oldPayments.rows) {
      await reverseRoutedPaymentWithClient(client, p, id)
    }
    await client.query('DELETE FROM payments WHERE invoice_id = $1', [id])

    await client.query(
      'UPDATE clients SET total_profit = GREATEST(0, COALESCE(total_profit,0) - $1) WHERE id = $2',
      [oldProfit, clientId]
    )
    if (barnId) {
      await client.query(
        'UPDATE barns SET total_profit = GREATEST(0, COALESCE(total_profit,0) - $1) WHERE id = $2',
        [oldProfit, barnId]
      )
    }

    const subtotal = items.reduce((a, i) => a + Number(i.total_price || 0), 0)
    const discountAmount = Math.max(
      0,
      data.discount_amount !== undefined ? Number(data.discount_amount) : Number(inv.discount_amount ?? 0)
    )
    const total = Math.max(0, subtotal - discountAmount)
    let paid = Math.max(
      0,
      Number(data.paid_amount !== undefined ? data.paid_amount : inv.paid_amount ?? 0)
    )
    if (paid > total) paid = total
    const remaining = Math.max(0, total - paid)
    let registerDeferred = data.register_deferred
    if (registerDeferred === undefined) registerDeferred = remaining > 0
    if (remaining > 0 && paid === 0) registerDeferred = true
    if (remaining > 0 && registerDeferred !== true) {
      throw new Error('المبلغ المدفوع أقل من إجمالي الفاتورة.\nيرجى إدخال المبلغ المتبقي أو تسجيله كآجل')
    }
    let status = 'معلق'
    if (total > 0 && paid >= total) status = 'مدفوعة'
    else if (paid > 0) status = 'جزئي'

    const pids = [...new Set(items.map((i) => i.product_id).filter(Boolean))]
    const pMap = {}
    const utMap = {}
    if (pids.length) {
      const r = await client.query('SELECT id, purchase_price, unit_type FROM products WHERE id = ANY($1)', [
        pids,
      ])
      for (const row of r.rows) {
        pMap[row.id] = Number(row.purchase_price ?? 0)
        utMap[row.id] = row.unit_type || 'piece'
      }
    }
    const totalCost = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(pMap[i.product_id] ?? 0), 0)
    const profit = Math.max(0, total - totalCost)

    const imm =
      data.immediate_payment_method ||
      (['cash', 'vodafone_cash', 'instapay'].includes(data.payment_method) ? data.payment_method : null) ||
      (['cash', 'vodafone_cash', 'instapay'].includes(inv.payment_method) ? inv.payment_method : null) ||
      'cash'
    const paymentMethod = remaining > 0 ? 'آجل' : imm
    const customerName = data.customer_name != null ? String(data.customer_name) : inv.customer_name || ''
    const notes = data.notes !== undefined ? data.notes : inv.notes
    const dueDate =
      data.due_date !== undefined
        ? data.due_date != null && String(data.due_date).trim() !== ''
          ? String(data.due_date).trim().slice(0, 10)
          : null
        : inv.due_date ?? null

    await client.query(
      `
        UPDATE invoices
        SET customer_name = $1, total_amount = $2, paid_amount = $3, remaining_amount = $4,
            profit_amount = $5, payment_method = $6, status = $7, notes = $8, discount_amount = $9, due_date = $10::date, updated_at = NOW()
        WHERE id = $11
      `,
      [customerName, total, paid, remaining, profit, paymentMethod, status, notes ?? null, discountAmount, dueDate, id]
    )

    const bulkNotifications = []
    for (const it of items) {
      const qty = Number(it.quantity ?? 0)
      const dispQtyRaw = it.display_quantity != null ? Number(it.display_quantity) : qty
      const dispU = it.display_unit === 'gram' ? 'gram' : 'kg'
      const insItem = await client.query(
        `
          INSERT INTO invoice_items
          (invoice_id, product_id, product_name, quantity, unit_price, total_price, batch_id, display_quantity, display_unit, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
          RETURNING id
        `,
        [id, it.product_id, it.product_name || '', qty, Number(it.unit_price ?? 0), Number(it.total_price ?? 0), it.batch_id ?? null, dispQtyRaw, dispU]
      )
      const itemId = insItem.rows[0].id
      if (qty > 0 && it.product_id) {
        if (utMap[it.product_id] === 'bulk') {
          const allocs = it.bag_id
            ? await allocateFromSpecificBag(client, it.bag_id, it.product_id, warehouseId, qty)
            : await allocateBulkBagsFefo(client, it.product_id, warehouseId, qty)
          for (const al of allocs) {
            await client.query('INSERT INTO invoice_item_bags (invoice_item_id, bag_id, amount_kg) VALUES ($1,$2,$3)', [
              itemId,
              al.bag_id,
              al.amount_kg,
            ])
            await client.query(
              'UPDATE product_batches SET kg_remaining = GREATEST(0, COALESCE(kg_remaining,0) - $1), updated_at = NOW() WHERE id = $2',
              [al.amount_kg, al.batch_id]
            )
            await client.query(
              "UPDATE bag_instances SET kg_remaining = GREATEST(0, COALESCE(kg_remaining,0) - $1), status = CASE WHEN COALESCE(kg_remaining,0) - $1 <= 0.001 THEN 'empty' ELSE status END WHERE id = $2",
              [al.amount_kg, al.bag_id]
            )
          }
          const open = await client.query(
            "SELECT id FROM bag_instances WHERE product_id = $1 AND warehouse_id = $2 AND status = 'open' LIMIT 1",
            [it.product_id, warehouseId]
          )
          if (!open.rows[0]) {
            const ur = await client.query(
              `
                UPDATE bag_instances SET status = 'open', opened_at = NOW()
                WHERE id = (
                  SELECT id FROM bag_instances
                  WHERE product_id = $1 AND warehouse_id = $2 AND status = 'sealed'
                  ORDER BY expiry_date ASC NULLS LAST, id ASC
                  LIMIT 1
                )
                RETURNING id
              `,
              [it.product_id, warehouseId]
            )
            if (ur.rows[0]) {
              bulkNotifications.push({ type: 'bag_auto_opened', product_id: it.product_id, product_name: it.product_name || '' })
            }
          }
          await syncWarehouseStockFromBatchesWithClient(client, it.product_id, warehouseId)
        } else if (it.batch_id) {
          const b = await client.query('SELECT quantity FROM product_batches WHERE id = $1', [it.batch_id])
          const avail = Number(b.rows[0]?.quantity ?? 0)
          if (avail + 0.0001 < qty) {
            throw new Error(`الكمية المطلوبة تتجاوز المخزون المتاح في هذه الدفعة (متاح: ${avail})`)
          }
          await client.query(
            'UPDATE product_batches SET quantity = GREATEST(0, COALESCE(quantity,0) - $1), updated_at = NOW() WHERE id = $2',
            [qty, it.batch_id]
          )
          await client.query('INSERT INTO invoice_item_batches (invoice_item_id, batch_id, quantity) VALUES ($1,$2,$3)', [
            itemId,
            it.batch_id,
            qty,
          ])
          await syncWarehouseStockFromBatchesWithClient(client, it.product_id, warehouseId)
        } else {
          const allocs = await allocatePieceBatchesFefo(client, it.product_id, warehouseId, qty)
          for (const al of allocs) {
            await client.query('INSERT INTO invoice_item_batches (invoice_item_id, batch_id, quantity) VALUES ($1,$2,$3)', [
              itemId,
              al.batch_id,
              al.quantity,
            ])
            await client.query(
              'UPDATE product_batches SET quantity = GREATEST(0, COALESCE(quantity,0) - $1), updated_at = NOW() WHERE id = $2',
              [al.quantity, al.batch_id]
            )
          }
          await syncWarehouseStockFromBatchesWithClient(client, it.product_id, warehouseId)
        }
      }
    }

    await client.query('UPDATE clients SET total_profit = COALESCE(total_profit,0) + $1 WHERE id = $2', [profit, clientId])
    if (barnId) {
      await client.query('UPDATE barns SET total_profit = COALESCE(total_profit,0) + $1 WHERE id = $2', [profit, barnId])
    }

    if (paid > 0) {
      await insertPaymentWithRouting(client, {
        client_id: clientId,
        barn_id: barnId ?? null,
        amount: paid,
        payment_method: imm,
        notes: `دفعة فاتورة #${id}`,
        payment_date: nowIso().slice(0, 10),
        barn_billing_cycle_id: inv.barn_billing_cycle_id ?? null,
        invoice_id: id,
        wallet_id: data.wallet_id ?? null,
      })
    }
    if (remaining > 0 && registerDeferred === true) {
      await insertPaymentWithRouting(client, {
        client_id: clientId,
        barn_id: barnId ?? null,
        amount: remaining,
        payment_method: 'deferred',
        notes: `آجل فاتورة #${id}`,
        payment_date: nowIso().slice(0, 10),
        barn_billing_cycle_id: inv.barn_billing_cycle_id ?? null,
        invoice_id: id,
      })
    }

    await client.query('COMMIT')
    const out = await getInvoiceById(id)
    return { ...out, bulk_notifications: bulkNotifications }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function routePayment(paymentRow, dbClient) {
  await routePaymentWithClient(dbClient || pool, paymentRow)
}

export async function removeDuplicateProducts() {
  const before = await getProductCount()
  const dupRows = await pool.query(
    `
      SELECT p.id
      FROM products p
      WHERE EXISTS (
        SELECT 1 FROM products p2
        WHERE p2.name = p.name AND p2.id < p.id
      )
    `
  )
  const ids = dupRows.rows.map((r) => r.id)
  if (ids.length > 0) {
    await pool.query('DELETE FROM product_warehouse_stock WHERE product_id = ANY($1)', [ids])
    await pool.query('DELETE FROM products WHERE id = ANY($1)', [ids])
  }
  const after = await getProductCount()
  return before - after
}

export async function allocateBatchesFEFO(productId, warehouseId, totalQty) {
  return allocatePieceBatchesFefo(pool, productId, warehouseId, totalQty)
}

export async function allocateBagsFEFO(productId, warehouseId, totalKilos) {
  return allocateBulkBagsFefo(pool, productId, warehouseId, totalKilos)
}

export async function allocateKilosFromSpecificBag(bagId, productId, warehouseId, totalKilos) {
  return allocateFromSpecificBag(pool, bagId, productId, warehouseId, totalKilos)
}

export async function recalculateWarehouseStock(productId, warehouseId) {
  await syncWarehouseStockFromBatches(productId, warehouseId)
}

export async function reverseInvoiceItem(invoiceItemId, dbClient) {
  await reverseInvoiceItemWithClient(dbClient || pool, invoiceItemId)
}

export async function healthcheckPg() {
  const r = await pool.query('SELECT NOW() AS now')
  return r.rows[0]?.now ?? nowIso()
}

/**
 * Transfer inventory between warehouses (e.g. اجهور → شبرا).
 * Validates stock, deducts from source batches (LIFO: newest batch first),
 * creates matching batches in the target warehouse, and updates product_warehouse_stock.
 */
export async function createInventoryTransfer(data) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const fromWh = Number(data.from_warehouse_id)
    const toWh = Number(data.to_warehouse_id)
    const items = Array.isArray(data.items) ? data.items : []

    for (const it of items) {
      const pid = Number(it.product_id)
      const qty = Number(it.quantity ?? 0)
      if (!Number.isFinite(pid) || !Number.isFinite(qty) || qty <= 0) {
        throw new Error(`كمية غير صالحة للمنتج #${pid}`)
      }
      // Validate stock
      const stockRow = await client.query(
        'SELECT COALESCE(quantity, 0) AS qty FROM product_warehouse_stock WHERE product_id = $1 AND warehouse_id = $2',
        [pid, fromWh]
      )
      const available = Number(stockRow.rows[0]?.qty ?? 0)
      if (qty > available) {
        const pNameRow = await client.query('SELECT name FROM products WHERE id = $1', [pid])
        const name = pNameRow.rows[0]?.name ?? `#${pid}`
        throw new Error(`الكمية المطلوبة (${qty}) للمنتج «${name}» أكبر من المتاح (${available})`)
      }

      // ── Deduct from source batches (LIFO: newest batch first by id DESC) ──
      const batchRes = await client.query(
        `SELECT * FROM product_batches
         WHERE product_id = $1 AND warehouse_id = $2 AND COALESCE(quantity, 0) > 0
         ORDER BY id DESC`,
        [pid, fromWh]
      )
      let remaining = qty
      for (const batch of batchRes.rows) {
        if (remaining <= 0) break
        const batchQty = Number(batch.quantity ?? 0)
        const take = Math.min(remaining, batchQty)
        if (take <= 0) continue

        // Subtract from source batch
        await client.query(
          'UPDATE product_batches SET quantity = GREATEST(0, quantity - $1), updated_at = NOW() WHERE id = $2',
          [take, batch.id]
        )

        // Create or update matching batch in target warehouse
        const existingTarget = await client.query(
          `SELECT id FROM product_batches
           WHERE product_id = $1 AND warehouse_id = $2 AND expiry_date = $3
             AND COALESCE(purchase_price, 0) = COALESCE($4::numeric, 0)
             AND COALESCE(selling_price, 0) = COALESCE($5::numeric, 0)
           LIMIT 1`,
          [pid, toWh, batch.expiry_date, batch.purchase_price, batch.selling_price]
        )

        if (existingTarget.rows.length > 0) {
          await client.query(
            'UPDATE product_batches SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2',
            [take, existingTarget.rows[0].id]
          )
        } else {
          await client.query(
            `INSERT INTO product_batches
             (product_id, warehouse_id, expiry_date, quantity, purchase_price, selling_price,
              unit_type, bag_count, kg_per_bag, kg_remaining, source, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, NULL, 'transfer', NOW(), NOW())`,
            [
              pid, toWh, batch.expiry_date, take,
              batch.purchase_price ?? null, batch.selling_price ?? null,
              batch.unit_type ?? 'piece', batch.kg_per_bag ?? null,
            ]
          )
        }
        remaining -= take
      }

      // ── Update product_warehouse_stock for both warehouses ──
      // Subtract from source
      await client.query(
        `UPDATE product_warehouse_stock
         SET quantity = GREATEST(0, quantity - $1), updated_at = NOW()
         WHERE product_id = $2 AND warehouse_id = $3`,
        [qty, pid, fromWh]
      )
      // Add to target (upsert)
      await client.query(
        `INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (product_id, warehouse_id) DO UPDATE
         SET quantity = product_warehouse_stock.quantity + EXCLUDED.quantity, updated_at = NOW()`,
        [pid, toWh, qty]
      )
    }

    // ── Persist transfer log ──
    const trRes = await client.query(
      'INSERT INTO inventory_transfers (from_warehouse_id, to_warehouse_id, notes, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id',
      [fromWh, toWh, data.notes ?? null]
    )
    const transferId = trRes.rows[0].id
    for (const it of items) {
      const pid = Number(it.product_id)
      const qty = Number(it.quantity ?? 0)
      const pRow = await client.query('SELECT name FROM products WHERE id = $1', [pid])
      await client.query(
        'INSERT INTO inventory_transfer_items (transfer_id, product_id, product_name, quantity) VALUES ($1, $2, $3, $4)',
        [transferId, pid, pRow.rows[0]?.name ?? `#${pid}`, qty]
      )
    }

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/**
 * List transfer history. Returns transfers with their items, newest first.
 */
export async function getInventoryTransfers(limit = 50) {
  const transfers = await pool.query(`
    SELECT t.*,
      wf.name_ar AS from_warehouse_name,
      wt.name_ar AS to_warehouse_name
    FROM inventory_transfers t
    LEFT JOIN warehouses wf ON wf.id = t.from_warehouse_id
    LEFT JOIN warehouses wt ON wt.id = t.to_warehouse_id
    ORDER BY t.id DESC
    LIMIT $1
  `, [Math.min(limit, 200)])

  if (transfers.rows.length === 0) return []

  const ids = transfers.rows.map((t) => t.id)
  const itemRes = await pool.query(
    `SELECT * FROM inventory_transfer_items WHERE transfer_id = ANY($1) ORDER BY id`,
    [ids]
  )

  const itemsByTransfer = {}
  for (const item of itemRes.rows) {
    if (!itemsByTransfer[item.transfer_id]) itemsByTransfer[item.transfer_id] = []
    itemsByTransfer[item.transfer_id].push(item)
  }

  return transfers.rows.map((t) => ({
    ...t,
    items: itemsByTransfer[t.id] ?? [],
  }))
}
