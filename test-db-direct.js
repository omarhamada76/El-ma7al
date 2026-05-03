import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const pool = new pg.Pool({
  connectionString: process.env.DB_URL
})

async function run() {
  const client = await pool.connect()
  try {
    const res = await client.query('SELECT id, name, barcode FROM products WHERE barcode IS NOT NULL LIMIT 10')
    console.log('Products with barcodes:', res.rows)
    
    const res2 = await client.query("SELECT id, name, barcode FROM products WHERE barcode LIKE '%56%' OR barcode LIKE '%418%'")
    console.log('Matching products:', res2.rows)

    const res3 = await client.query("SELECT id, product_id, warehouse_id, quantity FROM product_batches WHERE id IN (56, 418, 560, 4180)")
    console.log('Matching batches:', res3.rows)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
