import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DB_URL });

async function checkStock() {
  const res = await pool.query(`
    SELECT COUNT(*)::int as c
    FROM products p
    WHERE p.is_active = true
      AND p.id IN (SELECT product_id FROM product_warehouse_stock WHERE warehouse_id = 1)
  `);
  console.log("Products in warehouse 1:", res.rows[0].c);

  const resAll = await pool.query(`
    SELECT COUNT(*)::int as c
    FROM products p
    WHERE p.is_active = true
  `);
  console.log("Total active products:", resAll.rows[0].c);
  
  process.exit(0);
}
checkStock();
