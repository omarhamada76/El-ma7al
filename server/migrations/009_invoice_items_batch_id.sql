-- Add batch_id to invoice_items so each line item can reference a specific batch.
-- Nullable for backward compatibility with legacy invoice items.
ALTER TABLE invoice_items ADD COLUMN batch_id INTEGER REFERENCES product_batches(id);
