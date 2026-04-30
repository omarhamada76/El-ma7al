-- Fix: Add bulk support to supplier purchase items history
ALTER TABLE supplier_purchase_items ADD COLUMN unit_type TEXT DEFAULT 'piece';
ALTER TABLE supplier_purchase_items ADD COLUMN kg_per_bag REAL;
ALTER TABLE supplier_purchase_items ADD COLUMN expiry_date DATE; -- Ensure expiry_date is explicitly defined if not already present from previous migrations.
