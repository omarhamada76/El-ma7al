-- Deferred (آجل) invoice payments, wallet routing, invoice due_date (overdue seed).

ALTER TABLE invoices ADD COLUMN due_date TEXT;

ALTER TABLE payments ADD COLUMN invoice_id INTEGER REFERENCES invoices(id);
ALTER TABLE payments ADD COLUMN wallet_id INTEGER;
ALTER TABLE payments ADD COLUMN settled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_deferred_per_invoice
ON payments(invoice_id)
WHERE payment_method = 'deferred' AND invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  wallet_id INTEGER,
  reference_type TEXT,
  reference_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

-- Backfill: invoices that already have paid_amount on the row but no linked payment lines
INSERT INTO payments (
  client_id, barn_id, amount, payment_method, notes, payment_date, created_at, created_by,
  billing_cycle_id, barn_billing_cycle_id, invoice_id, wallet_id, settled_at
)
SELECT
  i.client_id,
  i.barn_id,
  i.paid_amount,
  'historical_invoice_paid',
  'ترحيل: مدفوع مسجّل على الفاتورة قبل ربط الدفعات',
  substr(i.created_at, 1, 10),
  i.created_at,
  NULL,
  i.billing_cycle_id,
  i.barn_billing_cycle_id,
  i.id,
  NULL,
  NULL
FROM invoices i
WHERE (COALESCE(i.invoice_lifecycle, 'active') != 'cancelled')
  AND COALESCE(i.paid_amount, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id);

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('client_debt_alert_threshold_egp', '5000');
