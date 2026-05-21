import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DB_URL,
});

async function run() {
  try {
    const passwordHash = bcrypt.hashSync('123456', 12);
    const res = await pool.query(
      "UPDATE users SET password_hash = $1 WHERE email = 'admin@elm7l.com'",
      [passwordHash]
    );
    console.log("Password reset response:", res.rowCount);
  } catch (err) {
    console.error("Error resetting password:", err);
  } finally {
    await pool.end();
  }
}

run();
