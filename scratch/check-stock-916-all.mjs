import * as db from '../server/pgdb.js'
import pg from 'pg'

const pid = 916
const wid = 1
const pool = new pg.Pool({ connectionString: process.env.DB_URL || process.env.SUPABASE_DB_URL })

const qBatchRows = `
  select id, warehouse_id, expiry_date, quantity, unit_type, kg_remaining, updated_at
  from product_batches
  where product_id=$1 and warehouse_id=$2
  order by id
`

const qBatchSum = `
  select coalesce(sum(case when coalesce(unit_type,'piece')='bulk' then coalesce(kg_remaining,0) else coalesce(quantity,0) end),0) as batch_sum
  from product_batches
  where product_id=$1 and warehouse_id=$2
`

const qPws = `
  select coalesce(quantity,0) as pws_qty, updated_at
  from product_warehouse_stock
  where product_id=$1 and warehouse_id=$2
`

const [rows, sum, pws] = await Promise.all([
  pool.query(qBatchRows, [pid, wid]),
  pool.query(qBatchSum, [pid, wid]),
  pool.query(qPws, [pid, wid]),
])

const list = await db.getProducts('', '', 500, 0, wid, false, false, false, false, false)
const row = list.find((x) => Number(x.id) === pid)

console.log(JSON.stringify({
  pid,
  wid,
  batch_rows: rows.rows,
  batch_sum: Number(sum.rows[0]?.batch_sum ?? 0),
  pws_row: pws.rows[0] ?? null,
  list_row: row ? {
    id: Number(row.id),
    warehouse_stock: Number(row.warehouse_stock ?? 0),
    batch_total_quantity: Number(row.batch_total_quantity ?? 0),
  } : null,
}, null, 2))

await pool.end()
