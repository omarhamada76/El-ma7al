import * as db from '../server/pgdb.js'
import pg from 'pg'

const pid = 916
const wid = 1
const pool = new pg.Pool({ connectionString: process.env.DB_URL || process.env.SUPABASE_DB_URL })

const before = await pool.query('select coalesce(quantity,0) as q from product_warehouse_stock where product_id=$1 and warehouse_id=$2', [pid, wid])
await db.syncWarehouseStockFromBatches(pid, wid)
const after = await pool.query('select coalesce(quantity,0) as q from product_warehouse_stock where product_id=$1 and warehouse_id=$2', [pid, wid])

console.log(JSON.stringify({ before: Number(before.rows[0]?.q ?? 0), after: Number(after.rows[0]?.q ?? 0) }, null, 2))
await pool.end()
