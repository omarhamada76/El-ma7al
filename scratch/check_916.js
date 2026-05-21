import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DB_URL
});

async function run() {
  try {
    const res = await pool.query("SELECT * FROM product_batches WHERE unit_type = 'bulk' LIMIT 5");
    console.log("Bulk batches:");
    console.table(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
