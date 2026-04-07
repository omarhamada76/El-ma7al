-- Batch-level expiry tracking: each (product, warehouse, expiry_date) triple has its own quantity.
-- product_warehouse_stock remains as a denormalized total for fast reads.

CREATE TABLE IF NOT EXISTS product_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  expiry_date TEXT NOT NULL,
  quantity REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_batches_lookup
  ON product_batches (product_id, warehouse_id, expiry_date);

-- Tracks which batches were deducted for each invoice line (for edit/delete restore).
CREATE TABLE IF NOT EXISTS invoice_item_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id),
  batch_id INTEGER NOT NULL REFERENCES product_batches(id),
  quantity REAL NOT NULL DEFAULT 0
);

-- Add expiry_date to supplier receipt line items.
ALTER TABLE supplier_purchase_items ADD COLUMN expiry_date TEXT;

-- Seed legacy batches: for every existing stock row with quantity > 0,
-- create a batch with sentinel expiry '9999-12-31' (sorts last in FEFO).
INSERT INTO product_batches (product_id, warehouse_id, expiry_date, quantity, created_at, updated_at)
SELECT product_id, warehouse_id, '9999-12-31', quantity, updated_at, updated_at
FROM product_warehouse_stock
WHERE quantity > 0;
