const pg = require('pg');
require('dotenv').config();

const pool = new pg.Pool({
  connectionString: process.env.DB_URL,
});

async function testSearch() {
  try {
    // 1. Get a batch ID and product name to test with
    const { rows: testData } = await pool.query(`
      SELECT p.name, pb.id as batch_id 
      FROM products p 
      JOIN product_batches pb ON p.id = pb.product_id 
      LIMIT 1;
    `);

    if (testData.length === 0) {
      console.log('No test data found.');
      return;
    }

    const { name, batch_id } = testData[0];
    console.log(`Testing with product: "${name}", batch_id: ${batch_id}`);

    // 2. Import the logic from pgdb.js (mocking it if necessary, but better to test the SQL)
    // We'll just run the SQL logic directly to verify it works as intended
    
    const searchStr = String(batch_id).padStart(4, '0');
    const num = parseInt(searchStr, 10);
    const isNum = !isNaN(num) && /^\d+$/.test(searchStr);

    console.log(`Searching for: "${searchStr}" (isNum: ${isNum}, num: ${num})`);

    const query = `
      SELECT p.id, p.name 
      FROM products p
      WHERE (LOWER(p.name) LIKE $1 OR LOWER(COALESCE(p.barcode, '')) LIKE $1)
      OR p.id = $2
      OR EXISTS (SELECT 1 FROM product_batches pb WHERE pb.product_id = p.id AND pb.id = $2)
      OR EXISTS (SELECT 1 FROM bag_instances bi WHERE bi.product_id = p.id AND bi.id = $2)
    `;

    const { rows: results } = await pool.query(query, [`%${searchStr}%`, num]);

    console.log(`Found ${results.length} products:`);
    results.forEach(r => console.log(` - [${r.id}] ${r.name}`));

    const foundMatch = results.some(r => r.name === name);
    if (foundMatch) {
      console.log('✅ SUCCESS: Found the expected product by batch ID!');
    } else {
      console.log('❌ FAILURE: Could not find the product by batch ID.');
    }

  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    await pool.end();
  }
}

testSearch();
