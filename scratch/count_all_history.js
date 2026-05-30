import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DB_URL || process.env.SUPABASE_DB_URL;
const client = new Client({ connectionString });

async function run() {
  try {
    await client.connect();
    
    const totalProducts = await client.query('SELECT COUNT(*) FROM products');
    console.log('Total products in database:', totalProducts.rows[0].count);

    const productsWithBatches = await client.query('SELECT COUNT(DISTINCT product_id) FROM product_batches');
    console.log('Products with at least one batch:', productsWithBatches.rows[0].count);

    // Let's count how many products have at least one history row
    const historyCheck = await client.query(`
      SELECT COUNT(DISTINCT p.id) FROM products p
      WHERE EXISTS (
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
    `);
    console.log('Products with at least one history record:', historyCheck.rows[0].count);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
