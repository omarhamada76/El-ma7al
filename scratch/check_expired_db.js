import pg from 'pg';
const { Pool } = pg;

async function checkExpired() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/vet_pharmacy'
  });

  try {
    const res = await pool.query(`
      SELECT p.id, p.name, p.expiry_date
      FROM products p
      WHERE p.expiry_date < CURRENT_DATE
      LIMIT 5
    `);
    console.log('Expired products (main):', res.rows);

    const batches = await pool.query(`
      SELECT pb.product_id, p.name, pb.expiry_date, pb.quantity, pb.kg_remaining
      FROM product_batches pb
      JOIN products p ON p.id = pb.product_id
      WHERE pb.expiry_date < CURRENT_DATE
        AND pb.expiry_date != '9999-12-31'
        AND (
          (COALESCE(pb.unit_type, 'piece') = 'bulk' AND COALESCE(pb.kg_remaining, 0) > 0)
          OR (COALESCE(pb.unit_type, 'piece') != 'bulk' AND COALESCE(pb.quantity, 0) > 0)
        )
      LIMIT 5
    `);
    console.log('Expired products (batches):', batches.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkExpired();
