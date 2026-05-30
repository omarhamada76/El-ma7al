import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DB_URL || process.env.SUPABASE_DB_URL;
const client = new Client({ connectionString });

async function run() {
  try {
    await client.connect();
    console.log('Connected.');

    const res = await client.query('SELECT DISTINCT source FROM product_batches');
    console.log('Distinct sources in product_batches:');
    console.table(res.rows);

    const countRes = await client.query('SELECT source, COUNT(*) FROM product_batches GROUP BY source');
    console.log('Counts per source:');
    console.table(countRes.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
