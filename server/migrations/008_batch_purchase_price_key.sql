-- Include purchase_price in the batch merge/uniqueness key.
-- Two receipts for the same product+warehouse+expiry but different prices
-- must create separate batches.

-- Drop old index that only covered (product_id, warehouse_id, expiry_date).
DROP INDEX IF EXISTS idx_product_batches_lookup;

-- New covering index that includes purchase_price.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_batches_merge_key
  ON product_batches (product_id, warehouse_id, purchase_price, expiry_date);
