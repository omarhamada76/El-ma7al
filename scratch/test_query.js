import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DB_URL || process.env.SUPABASE_DB_URL;
const client = new Client({ connectionString });

const queryStr = `
    SELECT
      date,
      type,
      entity_name,
      warehouse_name,
      quantity,
      price,
      reference_id,
      notes
    FROM (
      -- 1. Purchases (inbound from suppliers)
      SELECT
        spi.created_at AS date,
        'purchase' AS type,
        s.name AS entity_name,
        w.name_ar AS warehouse_name,
        (CASE WHEN spi.unit_type = 'bulk' THEN spi.quantity * COALESCE(spi.kg_per_bag, 0) ELSE spi.quantity END)::float AS quantity,
        spi.unit_price::float AS price,
        sp.id::text AS reference_id,
        sp.notes AS notes
      FROM supplier_purchase_items spi
      JOIN supplier_purchases sp ON sp.id = spi.supplier_purchase_id
      LEFT JOIN suppliers s ON s.id = sp.supplier_id
      LEFT JOIN warehouses w ON w.id = sp.warehouse_id
      WHERE spi.product_id = $1

      UNION ALL

      -- 2. Sales (outbound to clients)
      SELECT
        ii.created_at AS date,
        'sale' AS type,
        COALESCE(c.name, i.customer_name) AS entity_name,
        w.name_ar AS warehouse_name,
        -ii.quantity::float AS quantity,
        ii.unit_price::float AS price,
        i.id::text AS reference_id,
        i.notes AS notes
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN warehouses w ON w.id = i.warehouse_id
      WHERE ii.product_id = $1 AND COALESCE(i.invoice_lifecycle, 'active') != 'cancelled'

      UNION ALL

      -- 3. Transfers Out (outgoing from source warehouse)
      SELECT
        t.created_at AS date,
        'transfer_out' AS type,
        w_to.name_ar AS entity_name,
        w_from.name_ar AS warehouse_name,
        -ti.quantity::float AS quantity,
        NULL::float AS price,
        t.id::text AS reference_id,
        t.notes AS notes
      FROM inventory_transfer_items ti
      JOIN inventory_transfers t ON t.id = ti.transfer_id
      LEFT JOIN warehouses w_from ON w_from.id = t.from_warehouse_id
      LEFT JOIN warehouses w_to ON w_to.id = t.to_warehouse_id
      WHERE ti.product_id = $1

      UNION ALL

      -- 4. Transfers In (incoming to destination warehouse)
      SELECT
        t.created_at AS date,
        'transfer_in' AS type,
        w_from.name_ar AS entity_name,
        w_to.name_ar AS warehouse_name,
        ti.quantity::float AS quantity,
        NULL::float AS price,
        t.id::text AS reference_id,
        t.notes AS notes
      FROM inventory_transfer_items ti
      JOIN inventory_transfers t ON t.id = ti.transfer_id
      LEFT JOIN warehouses w_from ON w_from.id = t.from_warehouse_id
      LEFT JOIN warehouses w_to ON w_to.id = t.to_warehouse_id
      WHERE ti.product_id = $1

      UNION ALL

      -- 5. Returns (inbound from clients)
      SELECT
        ri.return_date AS date,
        'return' AS type,
        COALESCE(c.name, i.customer_name) AS entity_name,
        w.name_ar AS warehouse_name,
        ri.returned_quantity::float AS quantity,
        NULL::float AS price,
        rd.invoice_id::text AS reference_id,
        ri.notes AS notes
      FROM return_items ri
      JOIN return_documents rd ON rd.id = ri.return_document_id
      LEFT JOIN invoices i ON i.id = rd.invoice_id
      LEFT JOIN clients c ON c.id = rd.client_id
      LEFT JOIN warehouses w ON w.id = i.warehouse_id
      JOIN invoice_items ii ON ii.id = ri.invoice_item_id
      WHERE ii.product_id = $1

      UNION ALL

      -- 6. Manual Adjustments
      SELECT
        ia.created_at AS date,
        'adjustment' AS type,
        NULL AS entity_name,
        w.name_ar AS warehouse_name,
        ia.quantity_delta::float AS quantity,
        NULL::float AS price,
        NULL AS reference_id,
        ia.reason AS notes
      FROM inventory_adjustments ia
      LEFT JOIN warehouses w ON w.id = ia.warehouse_id
      WHERE ia.product_id = $1

      UNION ALL

      -- 7. Legacy Manual/Initial Batches (fallback)
      SELECT
        pb.created_at AS date,
        'adjustment' AS type,
        NULL AS entity_name,
        w.name_ar AS warehouse_name,
        (CASE WHEN pb.unit_type = 'bulk' THEN pb.kg_remaining ELSE pb.quantity END)::float AS quantity,
        pb.purchase_price::float AS price,
        pb.id::text AS reference_id,
        'رصيد أول المدة / دفعة يدوية: ' || COALESCE(pb.source, 'manual_adjustment') AS notes
      FROM product_batches pb
      LEFT JOIN warehouses w ON w.id = pb.warehouse_id
      WHERE pb.product_id = $1 AND pb.source IN ('initial_stock', 'manual_adjustment')
        AND NOT EXISTS (
          SELECT 1 FROM inventory_adjustments ia WHERE ia.batch_id = pb.id
        )
    ) AS combined_history
    ORDER BY date DESC
`;

async function run() {
  try {
    await client.connect();
    const productId = process.argv[2] ? parseInt(process.argv[2], 10) : 281;
    console.log(`Running UNION query with product ID ${productId}...`);
    const res = await client.query(queryStr, [productId]);
    console.log('Query ran successfully!');
    console.log('Rows found:', res.rows.length);
    if (res.rows.length > 0) {
      console.log('First row example:', res.rows[0]);
      console.log('All rows:');
      console.table(res.rows);
    }
  } catch (err) {
    console.error('UNION query error:', err);
  } finally {
    await client.end();
  }
}

run();
