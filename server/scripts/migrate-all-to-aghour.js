import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg
const connectionString = process.env.DB_URL || process.env.SUPABASE_DB_URL

if (!connectionString) {
  console.error('DB_URL or SUPABASE_DB_URL is required')
  process.exit(1)
}

const pool = new Pool({ connectionString })

async function migrate() {
  console.log('Starting migration to set all products/records to Warehouse ID 1 (Aghour)...')

  try {
    // 1. Move all batches to warehouse 1
    console.log('Updating product_batches...')
    await pool.query('UPDATE product_batches SET warehouse_id = 1')

    // 2. Move all bag instances to warehouse 1
    console.log('Updating bag_instances...')
    await pool.query('UPDATE bag_instances SET warehouse_id = 1')

    // 3. Move all supplier purchases to warehouse 1
    console.log('Updating supplier_purchases...')
    await pool.query('UPDATE supplier_purchases SET warehouse_id = 1')

    // 4. Move all invoices to warehouse 1
    console.log('Updating invoices...')
    await pool.query('UPDATE invoices SET warehouse_id = 1')

    // 5. Rebuild product_warehouse_stock
    console.log('Rebuilding product_warehouse_stock...')
    
    // First, clear existing stock records
    await pool.query('DELETE FROM product_warehouse_stock')

    // Then, insert summed stock from batches for each product into warehouse 1
    await pool.query(`
      INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
      SELECT 
        product_id, 
        1 as warehouse_id, 
        SUM(CASE WHEN unit_type = 'bulk' THEN kg_remaining ELSE quantity END) as quantity,
        NOW() as updated_at
      FROM product_batches
      GROUP BY product_id
    `)

    // 6. If there are products with NO batches, ensure they have a 0-stock record in warehouse 1
    // so they are visible in the Aghour list.
    await pool.query(`
      INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
      SELECT p.id, 1, 0, NOW()
      FROM products p
      LEFT JOIN product_warehouse_stock pws ON pws.product_id = p.id AND pws.warehouse_id = 1
      WHERE pws.product_id IS NULL
    `)

    console.log('Migration completed successfully!')
  } catch (err) {
    console.error('Migration failed:', err)
  } finally {
    await pool.end()
  }
}

migrate()
