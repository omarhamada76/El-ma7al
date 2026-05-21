import * as db from '../server/pgdb.js'
import pg from 'pg'

const batchId = 1073
const pid = 916
const wid = 1
const pool = new pg.Pool({ connectionString: process.env.DB_URL || process.env.SUPABASE_DB_URL })

async function pws() {
  const r = await pool.query('select quantity, updated_at from product_warehouse_stock where product_id=$1 and warehouse_id=$2', [pid, wid])
  return r.rows[0] || null
}

async function batch() {
  const r = await pool.query('select id, quantity, updated_at from product_batches where id=$1', [batchId])
  return r.rows[0] || null
}

const before = { batch: await batch(), pws: await pws() }
await db.updateProductBatch(batchId, { quantity: 6 })
const afterSame = { batch: await batch(), pws: await pws() }
await db.updateProductBatch(batchId, { quantity: 5 })
const afterFive = { batch: await batch(), pws: await pws() }
await db.updateProductBatch(batchId, { quantity: 6 })
const restored = { batch: await batch(), pws: await pws() }

console.log(JSON.stringify({ before, afterSame, afterFive, restored }, null, 2))
await pool.end()
