import pg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const pool = new pg.Pool({
  connectionString: process.env.DB_URL
})

async function run() {
  const client = await pool.connect()
  try {
    const res = await client.query(`
      select 
        count(*) as total_products,
        count(case when image_url is not null and image_url != '' then 1 end) as products_with_images,
        coalesce(sum(length(image_url)), 0) as total_image_bytes,
        coalesce(avg(length(image_url)), 0) as avg_image_bytes
      from products
    `)
    console.log('Database image statistics:', res.rows[0])

    const res2 = await client.query(`
      select 
        count(*) as total_stock_rows,
        coalesce(sum(length(p.image_url)), 0) as total_stock_image_bytes
      from product_warehouse_stock s
      join products p on p.id = s.product_id
      where s.quantity > 0
    `)
    console.log('Active stock image statistics:', res2.rows[0])

  } finally {
    client.release()
    await pool.end()
  }
}

run()
