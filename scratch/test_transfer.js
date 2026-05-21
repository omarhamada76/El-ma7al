import pg from 'pg';
import dotenv from 'dotenv';
import { createInventoryTransfer } from '../server/pgdb.js';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DB_URL,
});

async function printState(productId) {
  console.log(`\n=== STATE FOR PRODUCT #${productId} ===`);
  
  // 1. Warehouse Stock Cache
  const stockRes = await pool.query(
    'SELECT warehouse_id, quantity FROM product_warehouse_stock WHERE product_id = $1 ORDER BY warehouse_id',
    [productId]
  );
  console.log("Warehouse Stock Cache:");
  console.table(stockRes.rows);

  // 2. Product Batches
  const batchesRes = await pool.query(
    'SELECT id, warehouse_id, expiry_date, quantity, kg_remaining, bag_count FROM product_batches WHERE product_id = $1 ORDER BY warehouse_id, id',
    [productId]
  );
  console.log("Product Batches:");
  console.table(batchesRes.rows);

  // 3. Bag Instances
  const bagsRes = await pool.query(
    "SELECT id, batch_id, warehouse_id, status, kg_total, kg_remaining FROM bag_instances WHERE product_id = $1 AND status IN ('open', 'sealed') ORDER BY warehouse_id, id",
    [productId]
  );
  console.log("Bag Instances:");
  console.table(bagsRes.rows);
}

async function run() {
  try {
    // Find a bulk product that has stock in warehouse 1 (Aghour)
    const pRes = await pool.query(`
      SELECT p.id, p.name, pws.quantity 
      FROM products p
      JOIN product_warehouse_stock pws ON pws.product_id = p.id
      WHERE p.unit_type = 'bulk' AND pws.warehouse_id = 1 AND pws.quantity > 10
      LIMIT 1
    `);
    
    if (pRes.rows.length === 0) {
      console.log("No bulk product found with stock > 10 in warehouse 1.");
      return;
    }

    const prod = pRes.rows[0];
    const pid = prod.id;
    console.log(`Selected Product: "${prod.name}" (ID: ${pid}), current stock in Wh 1: ${prod.quantity} kg.`);

    await printState(pid);

    // Perform Transfer from Warehouse 1 to 2
    console.log("\n>>> Performing transfer of 5.5 kg from Wh 1 (Aghour) to Wh 2 (Shobra)...");
    await createInventoryTransfer({
      from_warehouse_id: 1,
      to_warehouse_id: 2,
      notes: "Test bulk transfer 1",
      items: [
        { product_id: pid, quantity: 5.5 }
      ]
    });

    console.log("Transfer successful! State after transfer 1:");
    await printState(pid);

    // Perform Transfer Back from Warehouse 2 to 1
    console.log("\n>>> Performing transfer of 5.5 kg back from Wh 2 (Shobra) to Wh 1 (Aghour)...");
    await createInventoryTransfer({
      from_warehouse_id: 2,
      to_warehouse_id: 1,
      notes: "Test bulk transfer 2 (reverse)",
      items: [
        { product_id: pid, quantity: 5.5 }
      ]
    });

    console.log("Reverse transfer successful! State after transfer 2 (should be back to initial):");
    await printState(pid);

  } catch (err) {
    console.error("Error during test transfer:", err);
  } finally {
    await pool.end();
  }
}

run();
