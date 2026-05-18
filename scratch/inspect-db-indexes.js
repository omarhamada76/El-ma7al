import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const pool = new pg.Pool({
  connectionString: process.env.DB_URL
})

async function run() {
  const client = await pool.connect()
  try {
    console.log('--- DB INDEX INSPECTION ---')
    
    const indexes = await client.query(`
      SELECT
          t.relname as table_name,
          i.relname as index_name,
          a.attname as column_name
      FROM
          pg_class t,
          pg_class i,
          pg_index ix,
          pg_attribute a
      WHERE
          t.oid = ix.indrelid
          AND i.oid = ix.indexrelid
          AND a.attrelid = t.oid
          AND a.attnum = ANY(ix.indkey)
          AND t.relname IN ('product_warehouse_stock', 'product_batches')
      ORDER BY
          t.relname,
          i.relname;
    `)
    console.log('Active indexes on product_warehouse_stock and product_batches:')
    console.table(indexes.rows)

    const tableSizes = await client.query(`
      SELECT 
        relname AS table_name, 
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
        pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
        pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_size,
        reltuples AS row_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('products', 'product_warehouse_stock', 'product_batches')
    `)
    console.log('Table Sizes:')
    console.table(tableSizes.rows)

  } catch (err) {
    console.error('Error during index query:', err)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
