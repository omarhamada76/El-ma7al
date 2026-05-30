import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260523000100_supplier_purchase_items_bulk.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const { Client } = pg;
const connectionString = process.env.DB_URL || process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('Error: DB_URL or SUPABASE_DB_URL must be set.');
  process.exit(1);
}

const client = new Client({ connectionString });

async function run() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL database...');
    console.log('Running schema migration...');
    await client.query(sql);
    console.log('Schema migration applied successfully!');
  } catch (err) {
    console.error('Error applying schema migration:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
