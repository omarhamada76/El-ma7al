const pg = require('pg');
require('dotenv').config({ path: '.env.local' });
const client = new pg.Client({ connectionString: process.env.DB_URL });
client.connect().then(async () => {
  const res = await client.query('SELECT id, name_ar, barcode FROM products WHERE length(barcode) < 10');
  console.log('Short Barcodes:', res.rows);
  await client.end();
}).catch(console.error);
