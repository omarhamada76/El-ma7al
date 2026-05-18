import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const pool = new pg.Pool({
  connectionString: process.env.DB_URL
})

async function run() {
  const client = await pool.connect()
  try {
    const colRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'products'")
    const columns = colRes.rows.map(r => r.column_name)
    // console.log('Columns in products:', columns)

    const totalRes = await client.query('SELECT COUNT(*) FROM products')
    console.log('Total products:', totalRes.rows[0].count)

    if (columns.includes('is_active')) {
      const activeRes = await client.query('SELECT COUNT(*) FROM products WHERE is_active = true')
      console.log('Active products:', activeRes.rows[0].count)
      
      const archivedRes = await client.query('SELECT COUNT(*) FROM products WHERE is_active = false')
      console.log('Archived products:', archivedRes.rows[0].count)
    }
  } catch (err) {
    console.error('Error executing query', err.stack)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
