import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DB_URL
});

async function run() {
  try {
    const resStock = await pool.query(`
      SELECT s.product_id, p.name, s.warehouse_id, s.quantity AS stock_qty,
             COALESCE(b.batch_sum, 0) AS batch_sum
      FROM product_warehouse_stock s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN (
        SELECT product_id, warehouse_id, SUM(
          CASE WHEN COALESCE(unit_type, 'piece') = 'bulk'
            THEN COALESCE(kg_remaining, 0)
            ELSE COALESCE(quantity, 0)
          END
        ) AS batch_sum
        FROM product_batches
        GROUP BY product_id, warehouse_id
      ) b ON b.product_id = s.product_id AND b.warehouse_id = s.warehouse_id
      WHERE s.quantity != COALESCE(b.batch_sum, 0)
    `);

    console.log("Mismatches found:", resStock.rows.length);
    console.log(JSON.stringify(resStock.rows, null, 2));

    // Also let's print all batches and stock for the products that have mismatch
    {
      const pId = 916;
      console.log(`\nDetail for product ID ${pId}:`);
      
      const batches = await pool.query('SELECT * FROM product_batches WHERE product_id = $1', [pId]);
      console.log("Batches:", JSON.stringify(batches.rows, null, 2));
      
      const stock = await pool.query('SELECT * FROM product_warehouse_stock WHERE product_id = $1', [pId]);
      console.log("Warehouse Stock:", JSON.stringify(stock.rows, null, 2));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
