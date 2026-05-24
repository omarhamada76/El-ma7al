-- Create inventory_adjustments table
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  batch_id BIGINT REFERENCES product_batches(id) ON DELETE SET NULL,
  old_quantity NUMERIC(12,4),
  new_quantity NUMERIC(12,4),
  quantity_delta NUMERIC(12,4) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;

-- Allow full access to service_role (the Node backend connection)
CREATE POLICY "service_role_full_access" ON inventory_adjustments 
  FOR ALL 
  TO service_role 
  USING (true) 
  WITH CHECK (true);

-- Also allow authenticated/anon reads if they query directly
CREATE POLICY "authenticated_reads" ON inventory_adjustments 
  FOR SELECT 
  TO authenticated, anon 
  USING (true);
