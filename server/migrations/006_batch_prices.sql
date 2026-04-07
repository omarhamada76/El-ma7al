-- Per-batch purchase and selling prices.
-- Each batch tracks the price it was bought at and the price it should sell for.

ALTER TABLE product_batches ADD COLUMN purchase_price REAL;
ALTER TABLE product_batches ADD COLUMN selling_price REAL;

-- Seed existing batches with the product-level prices.
UPDATE product_batches SET
  purchase_price = (SELECT purchase_price FROM products WHERE id = product_batches.product_id),
  selling_price  = (SELECT selling_price  FROM products WHERE id = product_batches.product_id);
