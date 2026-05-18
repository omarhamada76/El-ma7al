import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const pool = new pg.Pool({
  connectionString: process.env.DB_URL
})

async function run() {
  const client = await pool.connect()
  try {
    console.log('--- TABLES COUNT ---')
    const res = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM invoices) AS invoice_count,
        (SELECT COUNT(*) FROM invoice_items) AS invoice_items_count
    `)
    console.table(res.rows)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
