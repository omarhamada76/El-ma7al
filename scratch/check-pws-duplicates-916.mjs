import pg from 'pg'

const pid = 916
const wid = 1
const pool = new pg.Pool({ connectionString: process.env.DB_URL || process.env.SUPABASE_DB_URL })

const rows = await pool.query(
  `select ctid, product_id, warehouse_id, quantity, updated_at
   from product_warehouse_stock
   where product_id=$1 and warehouse_id=$2
   order by updated_at desc nulls last`,
  [pid, wid]
)

const idx = await pool.query(
  `SELECT indexname, indexdef
   FROM pg_indexes
   WHERE schemaname='public' AND tablename='product_warehouse_stock'
   ORDER BY indexname`
)

console.log(JSON.stringify({
  rows: rows.rows,
  row_count: rows.rows.length,
  indexes: idx.rows,
}, null, 2))

await pool.end()
