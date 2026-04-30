-- Transfer log: records every inventory transfer between warehouses.
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES inventory_transfers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer
  ON inventory_transfer_items (transfer_id);
