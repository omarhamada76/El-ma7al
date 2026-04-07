-- Client billing cycles: period-based accounting; invoices/payments tag to open cycle.

CREATE TABLE IF NOT EXISTS client_billing_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  carry_in REAL NOT NULL DEFAULT 0,
  carryover_out REAL,
  closed_at TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE invoices ADD COLUMN billing_cycle_id INTEGER REFERENCES client_billing_cycles(id);
ALTER TABLE payments ADD COLUMN billing_cycle_id INTEGER REFERENCES client_billing_cycles(id);
