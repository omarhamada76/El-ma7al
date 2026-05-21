import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DB_URL,
});

async function run() {
  try {
    const res = await pool.query('SELECT id, email, display_name, role, is_active FROM users');
    console.log("Users in Postgres:");
    console.table(res.rows);
  } catch (err) {
    console.error("Error querying users:", err);
  } finally {
    await pool.end();
  }
}

run();
