-- Distinguish batch origin for reporting; allow multiple batches with same (warehouse, expiry, purchase_price).
-- Values: 'supplier_purchase' | 'initial_stock' | 'manual_adjustment'

ALTER TABLE product_batches ADD COLUMN source TEXT DEFAULT 'supplier_purchase';

DROP INDEX IF EXISTS idx_product_batches_merge_key;

CREATE INDEX IF NOT EXISTS idx_product_batches_lookup
  ON product_batches (product_id, warehouse_id, purchase_price, expiry_date);
