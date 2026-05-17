-- Add indexes to optimize warehouse-specific queries
CREATE INDEX IF NOT EXISTS "idx_product_warehouse_stock_warehouse_id" ON "public"."product_warehouse_stock" ("warehouse_id");
CREATE INDEX IF NOT EXISTS "idx_product_batches_warehouse_id_qty" ON "public"."product_batches" ("warehouse_id", "quantity") WHERE "quantity" > 0;
CREATE INDEX IF NOT EXISTS "idx_invoice_items_invoice_id" ON "public"."invoice_items" ("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_invoices_created_at" ON "public"."invoices" ("created_at");
