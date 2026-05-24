-- Add missing unit_type and kg_per_bag columns to supplier_purchase_items to support bulk products
ALTER TABLE supplier_purchase_items ADD COLUMN IF NOT EXISTS unit_type TEXT DEFAULT 'piece';
ALTER TABLE supplier_purchase_items ADD COLUMN IF NOT EXISTS kg_per_bag NUMERIC(12,4);
