import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DB_URL,
});

async function run() {
  try {
    console.log("Detecting stock cache mismatches...");

    // 1. Find existing rows where pws.quantity differs from batch sum
    const mismatchedRes = await pool.query(`
      SELECT 
        pws.product_id, 
        pws.warehouse_id, 
        pws.quantity AS stock_qty,
        COALESCE(pb_sum.total, 0) AS batch_sum
      FROM product_warehouse_stock pws
      LEFT JOIN (
        SELECT 
          product_id, 
          warehouse_id, 
          SUM(
            CASE WHEN COALESCE(unit_type, 'piece') = 'bulk'
              THEN COALESCE(kg_remaining, 0)
              ELSE COALESCE(quantity, 0)
            END
          ) AS total
        FROM product_batches
        GROUP BY product_id, warehouse_id
      ) pb_sum ON pb_sum.product_id = pws.product_id AND pb_sum.warehouse_id = pws.warehouse_id
      WHERE pws.quantity <> COALESCE(pb_sum.total, 0)
    `);

    // 2. Find batches with no corresponding pws row
    const missingRes = await pool.query(`
      SELECT DISTINCT product_id, warehouse_id
      FROM product_batches pb
      WHERE NOT EXISTS (
        SELECT 1 FROM product_warehouse_stock pws
        WHERE pws.product_id = pb.product_id AND pws.warehouse_id = pb.warehouse_id
      )
    `);

    const mismatches = mismatchedRes.rows;
    const missing = missingRes.rows;

    console.log(`Found ${mismatches.length} mismatched and ${missing.length} missing stock records.`);

    let updated = 0;

    // 3. Process mismatches
    for (const row of mismatches) {
      console.log(`Syncing mismatched Product #${row.product_id} in Warehouse #${row.warehouse_id}: Cache=${row.stock_qty}, BatchesSum=${row.batch_sum}`);
      await pool.query(`
        INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (product_id, warehouse_id)
        DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
      `, [row.product_id, row.warehouse_id, row.batch_sum]);
      updated++;
    }

    // 4. Process missing
    for (const row of missing) {
      // Calculate total
      const totalRow = await pool.query(`
        SELECT COALESCE(SUM(
          CASE WHEN COALESCE(unit_type, 'piece') = 'bulk'
            THEN COALESCE(kg_remaining, 0)
            ELSE COALESCE(quantity, 0)
          END
        ), 0) AS total
        FROM product_batches
        WHERE product_id = $1 AND warehouse_id = $2
      `, [row.product_id, row.warehouse_id]);
      const total = Number(totalRow.rows[0]?.total ?? 0);

      console.log(`Syncing missing stock row for Product #${row.product_id} in Warehouse #${row.warehouse_id} with total ${total}`);
      await pool.query(`
        INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (product_id, warehouse_id)
        DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()
      `, [row.product_id, row.warehouse_id, total]);
      updated++;
    }

    console.log(`Synchronization complete. Updated ${updated} records.`);
  } catch (err) {
    console.error("Error during synchronization:", err);
  } finally {
    await pool.end();
  }
}

run();
