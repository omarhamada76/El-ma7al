import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg
const connectionString = process.env.DB_URL || process.env.SUPABASE_DB_URL

if (!connectionString) {
  console.error('DB_URL or SUPABASE_DB_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString })

async function zeroInventory() {
  console.log('Starting task: Resetting all inventory quantities to zero...')

  try {
    // 1. Reset product_batches
    console.log('Zeroing product_batches...')
    await pool.query(`
      UPDATE product_batches 
      SET quantity = 0, 
          kg_remaining = 0, 
          bag_count = 0, 
          updated_at = NOW()
    `)

    // 2. Reset bag_instances
    console.log('Zeroing bag_instances...')
    await pool.query(`
      UPDATE bag_instances 
      SET kg_remaining = 0, 
          status = 'empty'
    `)

    // 3. Reset product_warehouse_stock
    console.log('Zeroing product_warehouse_stock...')
    await pool.query(`
      UPDATE product_warehouse_stock 
      SET quantity = 0, 
          updated_at = NOW()
    `)

    console.log('All inventory quantities have been successfully set to zero!')
  } catch (err) {
    console.error('Failed to zero inventory:', err)
  } finally {
    await pool.end()
  }
}

zeroInventory()
