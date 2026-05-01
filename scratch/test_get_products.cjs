const pg = require('pg');
const pool = new pg.Pool({
  connectionString: "postgresql://postgres.durlemdvxspirzgdywwk:GG7G10%23%23ggg@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"
});

async function testQuery() {
  try {
    const query = `
      SELECT p.*,
        ba.purchase_price_min, ba.purchase_price_max, ba.selling_price_min, ba.selling_price_max, ba.batch_total_quantity,
        bgi.bulk_bag_count, bgi.bulk_open_bag_low
      FROM products p
      LEFT JOIN (
        SELECT product_id,
          MIN(purchase_price) as purchase_price_min,
          MAX(purchase_price) as purchase_price_max,
          MIN(selling_price) as selling_price_min,
          MAX(selling_price) as selling_price_max,
          SUM(CASE WHEN unit_type = 'bulk' THEN kg_remaining ELSE quantity END) as batch_total_quantity
        FROM product_batches
        GROUP BY product_id
      ) ba ON ba.product_id = p.id
      LEFT JOIN (
        SELECT bi.product_id,
          COUNT(*) as bulk_bag_count,
          MAX(CASE WHEN bi.status = 'open' AND bi.kg_total > 0.001 AND (bi.kg_remaining / bi.kg_total) < 0.2 THEN 1 ELSE 0 END) as bulk_open_bag_low
        FROM bag_instances bi
        WHERE bi.status != 'empty'
        GROUP BY bi.product_id
      ) bgi ON bgi.product_id = p.id
      ORDER BY p.id DESC
      LIMIT 1
    `;
    const res = await pool.query(query);
    console.log('Keys in first row:', Object.keys(res.rows[0]));
    console.log('image_url:', res.rows[0].image_url);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

testQuery();
