-- Phase 19: bulk alerts (kg), invoice line display unit (grams vs kg)

ALTER TABLE products ADD COLUMN alert_level_kg REAL;

ALTER TABLE invoice_items ADD COLUMN display_quantity REAL;
ALTER TABLE invoice_items ADD COLUMN display_unit TEXT DEFAULT 'kg';
