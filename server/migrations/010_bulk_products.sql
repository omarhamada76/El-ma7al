-- Phase 10: Bulk/Weight Products Schema

-- Extend Products
ALTER TABLE products ADD COLUMN unit_type TEXT NOT NULL DEFAULT 'piece';
ALTER TABLE products ADD COLUMN bag_weight_kg REAL;

-- Extend Product Batches for Bulk Data
ALTER TABLE product_batches ADD COLUMN unit_type TEXT DEFAULT 'piece';
ALTER TABLE product_batches ADD COLUMN bag_count INTEGER;
ALTER TABLE product_batches ADD COLUMN kg_per_bag REAL;
ALTER TABLE product_batches ADD COLUMN kg_remaining REAL;

-- Track individual bag instances
CREATE TABLE IF NOT EXISTS bag_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES product_batches(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  bag_number INTEGER NOT NULL,
  kg_total REAL NOT NULL,
  kg_remaining REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'sealed', -- 'sealed' | 'open' | 'empty'
  expiry_date TEXT,
  opened_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Extend Invoice Items for traceability (optional usage)
ALTER TABLE invoice_items ADD COLUMN sold_from_bag_id INTEGER REFERENCES bag_instances(id) ON DELETE SET NULL;
