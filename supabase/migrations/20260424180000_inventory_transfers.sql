-- Transfer log: records every inventory transfer between warehouses.
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id SERIAL PRIMARY KEY,
  from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_transfer_items (
  id SERIAL PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES inventory_transfers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer
  ON inventory_transfer_items (transfer_id);
