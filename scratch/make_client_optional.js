import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('Running migration: ALTER TABLE public.invoices ALTER COLUMN client_id DROP NOT NULL;');
    await client.query('ALTER TABLE public.invoices ALTER COLUMN client_id DROP NOT NULL;');
    
    console.log('Running migration: ALTER TABLE public.payments ALTER COLUMN client_id DROP NOT NULL;');
    await client.query('ALTER TABLE public.payments ALTER COLUMN client_id DROP NOT NULL;');
    
    console.log('Migration successful.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
