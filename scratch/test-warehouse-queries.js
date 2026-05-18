import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const pool = new pg.Pool({
  connectionString: process.env.DB_URL
})

async function run() {
  const client = await pool.connect()
  try {
    console.log('--- WAREHOUSE 1 DIRECT DB QUERY BENCHMARK ---')
    
    // Test 1: product_warehouse_stock count
    const t0 = performance.now()
    const resStock = await client.query(
      `select p.id, p.name, s.quantity as stock
       from product_warehouse_stock s
       join products p on p.id = s.product_id
       where s.warehouse_id = $1 and s.quantity > 0
       order by p.id desc`,
      [1]
    )
    const t1 = performance.now()
    console.log(`Stock query took: ${(t1 - t0).toFixed(2)}ms. Returned ${resStock.rows.length} rows.`)
    
    // Test 2: product_batches count
    const t2 = performance.now()
    const resBatches = await client.query(
      `select * from product_batches 
       where warehouse_id = $1 
       and (quantity > 0 or kg_remaining > 0)
       order by id desc`,
      [1]
    )
    const t3 = performance.now()
    console.log(`Batches query took: ${(t3 - t2).toFixed(2)}ms. Returned ${resBatches.rows.length} rows.`)
    
    if (resBatches.rows.length > 0) {
      console.log('Sample Batch Row Size:', JSON.stringify(resBatches.rows[0]).length, 'chars')
      const totalJsonLength = JSON.stringify(resBatches.rows).length
      console.log('Total Batches JSON size:', (totalJsonLength / 1024).toFixed(2), 'KB')
    }

    if (resStock.rows.length > 0) {
      const totalStockJsonLength = JSON.stringify(resStock.rows).length
      console.log('Total Stock JSON size:', (totalStockJsonLength / 1024).toFixed(2), 'KB')
    }

  } catch (err) {
    console.error('Error during query:', err)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
