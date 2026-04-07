-- Phase 13: invoice cancellation (lifecycle separate from payment status `status`)
ALTER TABLE invoices ADD COLUMN invoice_lifecycle TEXT DEFAULT 'active';

-- Snapshot on line items for returns if batch is later deleted/changed
ALTER TABLE invoice_items ADD COLUMN unit_purchase_price REAL;
ALTER TABLE invoice_items ADD COLUMN unit_selling_price REAL;
ALTER TABLE invoice_items ADD COLUMN batch_expiry_date TEXT;
ALTER TABLE invoice_items ADD COLUMN batch_warehouse_id INTEGER;

-- Audit trail for partial returns
CREATE TABLE IF NOT EXISTS return_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id),
  batch_id INTEGER,
  bag_instance_id INTEGER,
  returned_quantity REAL NOT NULL,
  return_date TEXT DEFAULT (datetime('now')),
  notes TEXT
);

-- Used by bulk sales; ensure table exists on fresh installs
CREATE TABLE IF NOT EXISTS invoice_item_bags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
  bag_id INTEGER NOT NULL REFERENCES bag_instances(id),
  amount_kg REAL NOT NULL
);
