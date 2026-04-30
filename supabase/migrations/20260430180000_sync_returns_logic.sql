-- Fix return_partial_invoice_item to match the Node server logic:
-- 1. Handle partial stock returns correctly (don't delete allocations for remaining quantity)
-- 2. Recalculate invoice totals after return

CREATE OR REPLACE FUNCTION "public"."recalc_invoice_financials"("p_invoice_id" bigint) RETURNS void
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_total numeric;
  v_profit numeric;
  v_disc numeric;
  v_paid numeric;
  v_final_total numeric;
  v_remaining numeric;
begin
  -- Calculate total and profit from items
  select 
    coalesce(sum(total_price), 0),
    coalesce(sum(total_price - (coalesce(unit_purchase_price, 0) * quantity)), 0)
  into v_total, v_profit
  from invoice_items
  where invoice_id = p_invoice_id;

  -- Get discount and paid amount
  select coalesce(discount_amount, 0), coalesce(paid_amount, 0)
  into v_disc, v_paid
  from invoices
  where id = p_invoice_id;

  v_final_total := greatest(0, v_total - v_disc);
  v_remaining := greatest(0, v_final_total - v_paid);

  update invoices
  set total_amount = v_final_total,
      profit_amount = v_profit,
      remaining_amount = v_remaining,
      updated_at = now()
  where id = p_invoice_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."return_partial_invoice_item"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_invoice_id bigint := nullif(payload->>'invoice_id','')::bigint;
  v_item_id bigint := nullif(payload->>'item_id','')::bigint;
  v_ret numeric := coalesce((payload->>'returned_quantity')::numeric, (payload->>'quantity')::numeric);
  v_notes text := payload->>'notes';
  v_item record;
  v_line_qty numeric;
  v_wh bigint;
  v_al record;
  v_take numeric;
  v_left numeric;
begin
  if v_invoice_id is null or v_item_id is null then
    raise exception 'invoice_id و item_id مطلوبان';
  end if;

  select ii.*, p.unit_type as product_unit_type, i.warehouse_id as invoice_warehouse_id
  into v_item
  from invoice_items ii
  join invoices i on i.id = ii.invoice_id
  left join products p on p.id = ii.product_id
  where ii.id = v_item_id and ii.invoice_id = v_invoice_id;

  if v_item is null then
    raise exception 'الصنف غير موجود في هذه الفاتورة';
  end if;

  v_line_qty := coalesce(v_item.quantity, 0);
  if v_ret is null or v_ret <= 0 or v_ret > v_line_qty + 0.0001 then
    raise exception 'كمية الإرجاع غير صالحة';
  end if;

  v_wh := coalesce(v_item.batch_warehouse_id, v_item.invoice_warehouse_id);
  if v_item.product_id is null or v_wh is null then
    raise exception 'بيانات المخزون غير مكتملة';
  end if;

  v_left := v_ret;

  -- 1. Handle stock returns (Bulk)
  if coalesce(v_item.product_unit_type, 'piece') = 'bulk' then
    for v_al in 
      select id, bag_id, amount_kg 
      from invoice_item_bags 
      where invoice_item_id = v_item_id 
      order by id desc
    loop
      exit when v_left <= 0.0001;
      v_take := least(v_left, v_al.amount_kg);
      if v_take <= 0 then continue; end if;

      update bag_instances
      set kg_remaining = coalesce(kg_remaining, 0) + v_take,
          status = case when status = 'empty' and coalesce(kg_remaining, 0) + v_take > 0.001 then 'open' else status end
      where id = v_al.bag_id;

      if (v_al.amount_kg - v_take) <= 0.001 then
        delete from invoice_item_bags where id = v_al.id;
      else
        update invoice_item_bags set amount_kg = amount_kg - v_take where id = v_al.id;
      end if;
      v_left := v_left - v_take;
    end loop;

    -- Sync batch kg_remaining
    update product_batches pb
    set kg_remaining = coalesce((
      select sum(bi.kg_remaining) from bag_instances bi where bi.batch_id = pb.id
    ), 0), updated_at = now()
    where pb.product_id = v_item.product_id and pb.warehouse_id = v_wh;

  -- 1. Handle stock returns (Piece)
  else
    for v_al in 
      select id, batch_id, quantity 
      from invoice_item_batches 
      where invoice_item_id = v_item_id 
      order by id desc
    loop
      exit when v_left <= 0.0001;
      v_take := least(v_left, v_al.quantity);
      if v_take <= 0 then continue; end if;

      update product_batches
      set quantity = coalesce(quantity, 0) + v_take, updated_at = now()
      where id = v_al.batch_id;

      if (v_al.quantity - v_take) <= 0.001 then
        delete from invoice_item_batches where id = v_al.id;
      else
        update invoice_item_batches set quantity = quantity - v_take where id = v_al.id;
      end if;
      v_left := v_left - v_take;
    end loop;
  end if;

  -- Sync warehouse stock
  insert into product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
  values (
    v_item.product_id,
    v_wh,
    coalesce((select sum(coalesce(pb.quantity, 0)) from product_batches pb where pb.product_id = v_item.product_id and pb.warehouse_id = v_wh), 0),
    now()
  )
  on conflict (product_id, warehouse_id)
  do update set quantity = excluded.quantity, updated_at = now();

  -- 2. Update line quantity
  update invoice_items
  set quantity = greatest(0, v_line_qty - v_ret),
      total_price = greatest(0, coalesce(unit_price, 0) * greatest(0, v_line_qty - v_ret))
  where id = v_item_id;

  -- 3. Record return
  insert into return_documents (invoice_id, client_id, barn_id, notes, created_at)
  select i.id, i.client_id, i.barn_id, v_notes, now()
  from invoices i where i.id = v_invoice_id;

  insert into return_items (return_document_id, invoice_item_id, batch_id, bag_instance_id, returned_quantity, notes, return_date)
  values ((select max(id) from return_documents where invoice_id = v_invoice_id), v_item_id, v_item.batch_id, v_item.sold_from_bag_id, v_ret, v_notes, now());

  -- 4. Recalculate financials
  perform public.recalc_invoice_financials(v_invoice_id);

  return jsonb_build_object('ok', true, 'data', to_jsonb((select i from invoices i where i.id = v_invoice_id)));
end;
$$;

-- Add indexes for better performance on new filters
CREATE INDEX IF NOT EXISTS "idx_invoices_client_id" ON "public"."invoices" USING "btree" ("client_id");
CREATE INDEX IF NOT EXISTS "idx_invoices_barn_id" ON "public"."invoices" USING "btree" ("barn_id");

GRANT ALL ON FUNCTION "public"."recalc_invoice_financials"("p_invoice_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."recalc_invoice_financials"("p_invoice_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_invoice_financials"("p_invoice_id" bigint) TO "service_role";

GRANT ALL ON FUNCTION "public"."return_partial_invoice_item"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."return_partial_invoice_item"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."return_partial_invoice_item"("payload" "jsonb") TO "service_role";
