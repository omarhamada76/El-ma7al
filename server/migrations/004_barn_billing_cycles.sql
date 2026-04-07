-- Barn-level billing cycles (العنابر). Invoices/payments for a barn tag to the open barn cycle.

CREATE TABLE IF NOT EXISTS barn_billing_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barn_id INTEGER NOT NULL REFERENCES barns(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  carry_in REAL NOT NULL DEFAULT 0,
  carryover_out REAL,
  closed_at TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE invoices ADD COLUMN barn_billing_cycle_id INTEGER REFERENCES barn_billing_cycles(id);
ALTER TABLE payments ADD COLUMN barn_billing_cycle_id INTEGER REFERENCES barn_billing_cycles(id);
