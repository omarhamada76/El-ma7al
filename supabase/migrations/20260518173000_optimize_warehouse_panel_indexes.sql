-- Optimize warehouse-specific product and batch queries
CREATE INDEX IF NOT EXISTS "idx_product_batches_wh_active_qty_kg" 
ON "public"."product_batches" ("warehouse_id") 
WHERE ("quantity" > 0 OR "kg_remaining" > 0);

CREATE INDEX IF NOT EXISTS "idx_product_warehouse_stock_wh_active_qty" 
ON "public"."product_warehouse_stock" ("warehouse_id") 
WHERE ("quantity" > 0);
