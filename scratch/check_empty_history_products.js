import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DB_URL || process.env.SUPABASE_DB_URL;
const client = new Client({ connectionString });

async function run() {
  try {
    await client.connect();
    console.log('Connected to database.');

    // Query to find products that have batches (stock/quantity) but 0 history records
    const res = await client.query(`
      SELECT p.id, p.name, 
             (SELECT COUNT(*) FROM product_batches pb WHERE pb.product_id = p.id) as batch_count,
             (SELECT SUM(quantity) FROM product_warehouse_stock pws WHERE pws.product_id = p.id) as total_stock
      FROM products p
      WHERE 
        (SELECT COUNT(*) FROM product_batches pb WHERE pb.product_id = p.id) > 0
        AND NOT EXISTS (
          -- Union query check
          SELECT 1 FROM supplier_purchase_items spi WHERE spi.product_id = p.id
          UNION
          SELECT 1 FROM invoice_items ii WHERE ii.product_id = p.id
          UNION
          SELECT 1 FROM inventory_transfer_items ti WHERE ti.product_id = p.id
          UNION
          SELECT 1 FROM return_items ri JOIN invoice_items ii ON ii.id = ri.invoice_item_id WHERE ii.product_id = p.id
          UNION
          SELECT 1 FROM inventory_adjustments ia WHERE ia.product_id = p.id
          UNION
          SELECT 1 FROM product_batches pb WHERE pb.product_id = p.id AND pb.source IN ('initial_stock', 'manual_adjustment')
        )
      LIMIT 30
    `);

    console.log('Products that have batches but ZERO history records in the UNION query:');
    console.log('Total count found:', res.rows.length);
    console.table(res.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
