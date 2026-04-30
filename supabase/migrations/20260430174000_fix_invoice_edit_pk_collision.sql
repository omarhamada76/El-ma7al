-- Fix foreign keys to allow ID updates (ON UPDATE CASCADE)
ALTER TABLE "public"."invoice_items" DROP CONSTRAINT IF EXISTS "invoice_items_invoice_id_fkey";
ALTER TABLE "public"."invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."payments" DROP CONSTRAINT IF EXISTS "payments_invoice_id_fkey";
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON UPDATE CASCADE;

ALTER TABLE "public"."return_documents" DROP CONSTRAINT IF EXISTS "return_documents_invoice_id_fkey";
ALTER TABLE "public"."return_documents" ADD CONSTRAINT "return_documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON UPDATE CASCADE;

-- Update replace_invoice function to handle PK collision
CREATE OR REPLACE FUNCTION "public"."replace_invoice"("id" bigint, "payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  inv record;
  res jsonb;
  new_id bigint;
  original_created_at timestamptz;
  original_created_by text;
begin
  -- 1. Get original metadata
  select created_at, created_by into original_created_at, original_created_by 
  from public.invoices where invoices.id = replace_invoice.id;
  
  if original_created_at is null then
    return jsonb_build_object('ok', false, 'error', 'الفاتورة غير موجودة');
  end if;

  -- 2. Cancel the old one (reverse stock, payments, etc.)
  -- This handles all the complex stock reversal logic
  perform public.cancel_invoice(replace_invoice.id);

  -- 3. Vacate the original ID by moving the cancelled record to a temporary negative ID
  -- This avoids "duplicate key value violates unique constraint"
  update public.invoices 
  set id = -replace_invoice.id 
  where invoices.id = replace_invoice.id;

  -- 4. Create the new invoice using the standard create_invoice logic
  -- We inject original client/barn/warehouse if not in payload to ensure consistency
  res := public.create_invoice(payload || jsonb_build_object(
    'client_id', (select client_id from invoices where invoices.id = -replace_invoice.id),
    'barn_id', (select barn_id from invoices where invoices.id = -replace_invoice.id),
    'warehouse_id', (select warehouse_id from invoices where invoices.id = -replace_invoice.id)
  ));

  if not (res->>'ok')::boolean then
    -- If creation fails, rollback happens automatically as this is a function call
    return res;
  end if;

  new_id := (res->'data'->>'id')::bigint;

  -- 5. Assign the original ID and metadata to the new record
  -- This triggers ON UPDATE CASCADE for invoice_items, payments, etc.
  update public.invoices
  set id = replace_invoice.id,
      created_at = original_created_at,
      created_by = original_created_by,
      updated_at = now()
  where invoices.id = new_id;

  -- 6. Update non-foreign-key references in transactions
  update public.safe_transactions 
  set reference_id = replace_invoice.id 
  where reference_id = new_id and reference_type in ('payment', 'invoice_cancel');

  update public.wallet_transactions 
  set reference_id = replace_invoice.id 
  where reference_id = new_id and reference_type in ('payment', 'invoice_cancel');

  -- 7. Clean up the temporary cancelled record
  -- We don't need it anymore as the new record replaces it completely
  delete from public.invoices where invoices.id = -replace_invoice.id;

  return jsonb_build_object('ok', true, 'data', to_jsonb((select i from invoices i where i.id = replace_invoice.id)));
end;
$$;
