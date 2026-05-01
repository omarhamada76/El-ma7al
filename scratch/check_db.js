import pg from 'pg';
const { Pool } = pg;

async function checkImages() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/vet_pharmacy'
  });

  try {
    const res = await pool.query('SELECT id, name, image_url FROM products WHERE image_url IS NOT NULL LIMIT 10');
    console.log('Products with images:');
    console.log(JSON.stringify(res.rows, null, 2));
    
    const count = await pool.query('SELECT COUNT(*) FROM products WHERE image_url IS NOT NULL AND image_url != \'\'');
    console.log('Total products with non-empty image_url:', count.rows[0].count);

    const sample = await pool.query('SELECT * FROM products LIMIT 1');
    console.log('Columns in products table:', Object.keys(sample.rows[0]));
  } catch (err) {
    console.error('Error checking images:', err);
  } finally {
    await pool.end();
  }
}

checkImages();
