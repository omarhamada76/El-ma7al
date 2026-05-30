import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DB_URL || process.env.SUPABASE_DB_URL;
const client = new Client({ connectionString });

async function run() {
  try {
    await client.connect();
    console.log('Connected to database.');

    // Count products
    const prodRes = await client.query('SELECT id, name FROM products LIMIT 20');
    console.log('Sample products:');
    console.table(prodRes.rows);

    // Let's count rows in each history table
    const tables = [
      'supplier_purchase_items',
      'invoice_items',
      'inventory_transfer_items',
      'return_items',
      'inventory_adjustments',
      'product_batches'
    ];

    for (const table of tables) {
      const res = await client.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`Table ${table} has ${res.rows[0].count} rows.`);
    }

    // Find products that have items in any of these tables
    const summaryQuery = `
      SELECT product_id, count(*), 'supplier_purchase_items' as source FROM supplier_purchase_items GROUP BY product_id
      UNION ALL
      SELECT product_id, count(*), 'invoice_items' as source FROM invoice_items GROUP BY product_id
      UNION ALL
      SELECT product_id, count(*), 'inventory_transfer_items' as source FROM inventory_transfer_items GROUP BY product_id
      UNION ALL
      -- return_items joins invoice_items to get product_id
      SELECT ii.product_id, count(*), 'return_items' as source FROM return_items ri JOIN invoice_items ii ON ii.id = ri.invoice_item_id GROUP BY ii.product_id
      UNION ALL
      SELECT product_id, count(*), 'inventory_adjustments' as source FROM inventory_adjustments GROUP BY product_id
      UNION ALL
      SELECT product_id, count(*), 'product_batches' as source FROM product_batches WHERE source IN ('initial_stock', 'manual_adjustment') GROUP BY product_id
    `;
    
    const summaryRes = await client.query(`
      SELECT product_id, SUM(count) as total_records FROM (
        ${summaryQuery}
      ) AS t
      GROUP BY product_id
      ORDER BY total_records DESC
      LIMIT 20
    `);
    console.log('Products with history records:');
    console.table(summaryRes.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}
run();
