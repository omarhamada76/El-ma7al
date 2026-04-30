import Database from 'better-sqlite3'
import pg from 'pg'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const TABLE_ORDER = [
  'warehouses',
  'users',
  'products',
  'product_warehouse_stock',
  'product_batches',
  'bag_instances',
  'clients',
  'barns',
  'suppliers',
  'client_billing_cycles',
  'barn_billing_cycles',
  'invoices',
  'invoice_items',
  'payments',
  'safe_transactions',
  'digital_wallets',
  'wallet_transactions',
  'supplier_purchases',
  'supplier_purchase_items',
  'supplier_payments',
  'return_documents',
  'return_items',
  'settings',
  'app_settings',
  'categories',
  'invoice_item_batches',
  'invoice_item_bags',
]

const BOOLEAN_COLUMNS = new Map([
  ['users', new Set(['is_active'])],
  ['warehouses', new Set(['is_active'])],
  ['clients', new Set(['favorite', 'pinned'])],
  ['suppliers', new Set(['is_active'])],
])

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

function sqliteHasTable(db, tableName) {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName)
  return !!row
}

function sqliteCols(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((c) => c.name)
}

function pgColsByTable(pgClient, tableName) {
  return pgClient
    .query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `,
      [tableName]
    )
    .then((r) => r.rows.map((x) => x.column_name))
}

function transformRow(tableName, row) {
  const out = { ...row }
  const boolCols = BOOLEAN_COLUMNS.get(tableName)
  if (boolCols) {
    for (const key of boolCols) {
      if (key in out && out[key] !== null && out[key] !== undefined) {
        out[key] = Number(out[key]) === 1
      }
    }
  }
  return out
}

async function insertRows(pgClient, tableName, rows, allowedCols) {
  if (!rows.length || !allowedCols.length) return
  const colsSql = allowedCols.map(quoteIdent).join(', ')
  let skipped = 0

  // Legacy SQLite snapshots can contain orphan child rows that violate Postgres FKs.
  // We skip these rows during migration so the rest of the dataset can be reconciled.
  let validProductIds = null
  if (tableName === 'supplier_purchase_items' && allowedCols.includes('product_id')) {
    const idRows = await pgClient.query('SELECT id FROM products')
    validProductIds = new Set(idRows.rows.map((r) => Number(r.id)))
  }

  for (const row of rows) {
    if (validProductIds) {
      const pid = Number(row.product_id)
      if (Number.isFinite(pid) && !validProductIds.has(pid)) {
        skipped += 1
        continue
      }
    }
    const values = allowedCols.map((c) => (row[c] === undefined ? null : row[c]))
    const params = values.map((_, i) => `$${i + 1}`).join(', ')
    await pgClient.query(
      `INSERT INTO ${quoteIdent(tableName)} (${colsSql}) VALUES (${params}) ON CONFLICT DO NOTHING`,
      values
    )
  }

  if (skipped > 0) {
    console.log(`[warn] ${tableName}: skipped ${skipped} row(s) due to unresolved foreign keys`)
  }
}

async function setTableSequence(pgClient, tableName) {
  const res = await pgClient.query(
    `SELECT pg_get_serial_sequence($1, 'id') AS seq_name`,
    [`public.${tableName}`]
  )
  const seqName = res.rows?.[0]?.seq_name
  if (!seqName) return
  await pgClient.query(
    `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${quoteIdent(tableName)}), 0) + 1, false)`,
    [seqName]
  )
}

async function main() {
  if (!process.env.DB_URL) {
    throw new Error('DB_URL is required in environment')
  }

  const sqlite = new Database('data/vet-pharmacy.sqlite', { readonly: true })
  const pgClient = new pg.Client({ connectionString: process.env.DB_URL })
  await pgClient.connect()

  const mismatches = []

  try {
    for (const tableName of TABLE_ORDER) {
      if (!sqliteHasTable(sqlite, tableName)) {
        console.log(`[skip] sqlite table missing: ${tableName}`)
        continue
      }

      const pgCols = await pgColsByTable(pgClient, tableName)
      if (!pgCols.length) {
        console.log(`[skip] postgres table missing: ${tableName}`)
        continue
      }

      const allRows = sqlite.prepare(`SELECT * FROM ${tableName}`).all()
      const sqliteColumns = new Set(sqliteCols(sqlite, tableName))
      const commonCols = pgCols.filter((c) => sqliteColumns.has(c))
      const rows = allRows.map((r) => transformRow(tableName, r))

      await insertRows(pgClient, tableName, rows, commonCols)
      if (pgCols.includes('id')) {
        await setTableSequence(pgClient, tableName)
      }

      const pgCount = Number(
        (await pgClient.query(`SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(tableName)}`)).rows[0].c
      )
      const sqliteCount = allRows.length
      const ok = sqliteCount === pgCount
      console.log(`[${ok ? 'ok' : 'mismatch'}] ${tableName}: sqlite=${sqliteCount}, pg=${pgCount}`)
      if (!ok) mismatches.push({ table: tableName, sqlite: sqliteCount, pg: pgCount })
    }

    const sqliteSafe = Number(
      sqlite
        .prepare(
          `SELECT COALESCE(SUM(
            CASE
              WHEN type IN ('initial','customer_payment_in','adjustment_in') THEN amount
              ELSE -amount
            END
          ), 0) AS s FROM safe_transactions`
        )
        .get()?.s ?? 0
    )
    const pgSafe = Number(
      (
        await pgClient.query(
          `SELECT COALESCE(SUM(
            CASE
              WHEN type IN ('initial','customer_payment_in','adjustment_in') THEN amount
              ELSE -amount
            END
          ), 0) AS s FROM safe_transactions`
        )
      ).rows[0].s ?? 0
    )
    console.log(`[balance] safe sqlite=${sqliteSafe.toFixed(4)} pg=${pgSafe.toFixed(4)}`)
    if (Math.abs(sqliteSafe - pgSafe) > 0.0001) {
      mismatches.push({ table: 'safe_balance', sqlite: sqliteSafe, pg: pgSafe })
    }

    const sqliteClientDebt = Number(
      sqlite
        .prepare(
          `
          SELECT
            COALESCE((SELECT SUM(initial_debt) FROM clients),0) +
            COALESCE((SELECT SUM(total_amount) FROM invoices WHERE COALESCE(invoice_lifecycle,'active') != 'cancelled'),0) -
            COALESCE((SELECT SUM(CASE WHEN COALESCE(payment_method,'') IN ('deferred','آجل','credit') THEN 0 ELSE amount END) FROM payments),0)
            AS s
        `
        )
        .get()?.s ?? 0
    )
    const pgClientDebt = Number(
      (
        await pgClient.query(
          `
          SELECT
            COALESCE((SELECT SUM(initial_debt) FROM clients),0) +
            COALESCE((SELECT SUM(total_amount) FROM invoices WHERE COALESCE(invoice_lifecycle,'active') != 'cancelled'),0) -
            COALESCE((SELECT SUM(CASE WHEN COALESCE(payment_method,'') IN ('deferred','آجل','credit') THEN 0 ELSE amount END) FROM payments),0)
            AS s
        `
        )
      ).rows[0].s ?? 0
    )
    console.log(`[balance] client_debt sqlite=${sqliteClientDebt.toFixed(4)} pg=${pgClientDebt.toFixed(4)}`)
    if (Math.abs(sqliteClientDebt - pgClientDebt) > 0.0001) {
      mismatches.push({ table: 'client_debt', sqlite: sqliteClientDebt, pg: pgClientDebt })
    }

    // Rehash all user passwords to PBKDF2
    console.log('Rehashing user passwords to PBKDF2...')
    const users = await pgClient.query('SELECT id, email FROM users')
    for (const user of users.rows) {
      const tempPassword = 'TempPass123!'
      const salt = crypto.randomBytes(16)
      const hash = crypto.pbkdf2Sync(tempPassword, salt, 100000, 32, 'sha256')
      const saltHex = salt.toString('hex')
      const hashHex = hash.toString('hex')
      const pbkdf2Hash = `pbkdf2:${saltHex}:${hashHex}`
      await pgClient.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [pbkdf2Hash, user.id]
      )
      console.log(`Reset password for ${user.email} → TempPass123!`)
    }
    console.log('All passwords reset to TempPass123!')
    console.log('IMPORTANT: Log in and change all passwords immediately.')

    if (mismatches.length) {
      console.error('\nMIGRATION COMPLETED WITH MISMATCHES:')
      for (const m of mismatches) {
        console.error(`- ${m.table}: sqlite=${m.sqlite}, pg=${m.pg}`)
      }
      process.exitCode = 1
      return
    }

    console.log('\nMigration completed successfully with matching counts and balances.')
  } finally {
    await pgClient.end()
    sqlite.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
