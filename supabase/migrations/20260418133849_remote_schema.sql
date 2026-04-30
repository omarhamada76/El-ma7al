


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."auto_open_next_bag"("product_id" bigint, "warehouse_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_bag_id bigint;
begin
  select id into v_bag_id
  from bag_instances
  where bag_instances.product_id = auto_open_next_bag.product_id
    and bag_instances.warehouse_id = auto_open_next_bag.warehouse_id
    and status = 'open'
  order by id asc
  limit 1;

  if v_bag_id is null then
    update bag_instances bi
    set status = 'open', opened_at = now()
    where bi.id = (
      select id
      from bag_instances
      where product_id = auto_open_next_bag.product_id
        and warehouse_id = auto_open_next_bag.warehouse_id
        and status = 'sealed'
      order by expiry_date asc nulls last, id asc
      limit 1
    )
    returning bi.id into v_bag_id;
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('opened_bag_id', v_bag_id));
end;
$$;


ALTER FUNCTION "public"."auto_open_next_bag"("product_id" bigint, "warehouse_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_invoice"("id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  inv record;
  r record;
  p record;
  linked_count int;
begin
  select * into inv from invoices where invoices.id = cancel_invoice.id;
  if inv is null then
    return jsonb_build_object('ok', true, 'data', null);
  end if;

  if coalesce(inv.invoice_lifecycle, 'active') = 'cancelled' then
    raise exception 'الفاتورة ملغاة مسبقاً';
  end if;

  for r in select ii.id from invoice_items ii where ii.invoice_id = cancel_invoice.id loop
    perform public.reverse_invoice_item(r.id);
  end loop;

  linked_count := 0;
  for p in select pay.* from payments pay where pay.invoice_id = cancel_invoice.id loop
    linked_count := linked_count + 1;
    if coalesce(p.payment_method,'') = 'cash' then
      delete from safe_transactions where reference_type = 'payment' and reference_id = p.id;
    elsif coalesce(p.payment_method,'') in ('vodafone_cash', 'instapay') then
      delete from wallet_transactions where reference_type = 'payment' and reference_id = p.id;
    end if;
  end loop;

  delete from payments where payments.invoice_id = cancel_invoice.id;

  if coalesce(inv.paid_amount,0) > 0 and coalesce(inv.payment_method,'cash') = 'cash' and linked_count = 0 then
    insert into safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
    values ('adjustment_out', coalesce(inv.paid_amount,0), 'invoice_cancel', cancel_invoice.id, 'إلغاء فاتورة #' || cancel_invoice.id::text, now(), null);
  end if;

  update clients
  set total_profit = greatest(0, coalesce(total_profit,0) - coalesce(inv.profit_amount,0))
  where clients.id = inv.client_id;

  if inv.barn_id is not null then
    update barns
    set total_invoices = greatest(0, coalesce(total_invoices,0) - 1),
        total_profit = greatest(0, coalesce(total_profit,0) - coalesce(inv.profit_amount,0))
    where barns.id = inv.barn_id;
  end if;

  update invoices
  set invoice_lifecycle = 'cancelled',
      profit_amount = 0,
      paid_amount = 0,
      remaining_amount = 0,
      status = 'معلق',
      updated_at = now()
  where invoices.id = cancel_invoice.id;

  return jsonb_build_object('ok', true, 'data', to_jsonb((select i from invoices i where i.id = cancel_invoice.id)));
end;
$$;


ALTER FUNCTION "public"."cancel_invoice"("id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_invoice"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_client_id bigint := nullif(payload->>'client_id','')::bigint;
  v_barn_id bigint := nullif(payload->>'barn_id','')::bigint;
  v_warehouse_id bigint := nullif(payload->>'warehouse_id','')::bigint;
  v_customer_name text := coalesce(payload->>'customer_name','');
  v_notes text := payload->>'notes';
  v_discount numeric := greatest(0, coalesce((payload->>'discount_amount')::numeric,0));
  v_paid numeric := greatest(0, coalesce((payload->>'paid_amount')::numeric,0));
  v_total numeric := 0;
  v_remaining numeric;
  v_profit numeric := 0;
  v_status text := 'معلق';
  v_payment_method text;
  v_invoice_id bigint;
  v_items jsonb := coalesce(payload->'items','[]'::jsonb);
  it jsonb;
  v_now date := current_date;
  v_payment_id bigint;
begin
  for it in select * from jsonb_array_elements(v_items) loop
    v_total := v_total + coalesce((it->>'total_price')::numeric,0);
  end loop;
  v_total := greatest(0, v_total - v_discount);
  if v_paid > v_total then v_paid := v_total; end if;
  v_remaining := greatest(0, v_total - v_paid);
  if v_total > 0 and v_paid >= v_total then
    v_status := 'مدفوعة';
  elsif v_paid > 0 then
    v_status := 'جزئي';
  end if;

  v_payment_method := case when v_remaining > 0 then 'آجل' else coalesce(payload->>'immediate_payment_method', payload->>'payment_method', 'cash') end;

  insert into invoices
    (client_id, barn_id, warehouse_id, customer_name, total_amount, paid_amount, remaining_amount, profit_amount, payment_method, status, notes, discount_amount, created_at, created_by, due_date)
  values
    (v_client_id, v_barn_id, v_warehouse_id, v_customer_name, v_total, v_paid, v_remaining, v_profit, v_payment_method, v_status, v_notes, v_discount, now(), null, nullif(payload->>'due_date','')::date)
  returning id into v_invoice_id;

  for it in select * from jsonb_array_elements(v_items) loop
    insert into invoice_items
      (invoice_id, product_id, product_name, quantity, unit_price, total_price, batch_id, display_quantity, display_unit, created_at)
    values
      (v_invoice_id, (it->>'product_id')::bigint, coalesce(it->>'product_name',''), coalesce((it->>'quantity')::numeric,0),
       coalesce((it->>'unit_price')::numeric,0), coalesce((it->>'total_price')::numeric,0), nullif(it->>'batch_id','')::bigint,
       coalesce((it->>'display_quantity')::numeric, (it->>'quantity')::numeric, 0),
       case when coalesce(it->>'display_unit','kg')='gram' then 'gram' else 'kg' end, now());
  end loop;

  if v_paid > 0 then
    insert into payments
      (client_id, barn_id, amount, payment_method, notes, payment_date, created_at, created_by, invoice_id, wallet_id)
    values
      (v_client_id, v_barn_id, v_paid, coalesce(payload->>'immediate_payment_method', payload->>'payment_method', 'cash'), 'دفعة فاتورة #' || v_invoice_id::text, v_now, now(), null, v_invoice_id, nullif(payload->>'wallet_id','')::bigint)
    returning id into v_payment_id;
    perform public.route_payment(jsonb_build_object('id', v_payment_id, 'amount', v_paid, 'payment_method', coalesce(payload->>'immediate_payment_method', payload->>'payment_method', 'cash'), 'wallet_id', nullif(payload->>'wallet_id','')::bigint));
  end if;

  if v_remaining > 0 then
    insert into payments
      (client_id, barn_id, amount, payment_method, notes, payment_date, created_at, created_by, invoice_id)
    values
      (v_client_id, v_barn_id, v_remaining, 'deferred', 'آجل فاتورة #' || v_invoice_id::text, v_now, now(), null, v_invoice_id);
  end if;

  return jsonb_build_object('ok', true, 'data', to_jsonb((select i from invoices i where i.id = v_invoice_id)));
end;
$$;


ALTER FUNCTION "public"."create_invoice"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_supplier_receipt"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_purchase_id bigint;
  v_item jsonb;
  v_wh_id_text text;
  v_wh_qty_text text;
  v_wh_id bigint;
  v_first_wh_id bigint;
  v_batch_qty int;
  v_batch_id bigint;
  v_existing_batch_id bigint;
  v_product_id bigint;
  v_purchase_price numeric;
  v_selling_price numeric;
  v_expiry_date text;
  v_unit_type text;
  v_kg_per_bag numeric;
BEGIN
  -- 0. Identify a "primary" warehouse ID for the header constraint
  SELECT (jsonb_object_keys(elem->'distribution'))::bigint INTO v_first_wh_id
  FROM jsonb_array_elements(payload->'items') AS elem
  LIMIT 1;
  
  IF v_first_wh_id IS NULL THEN
    v_first_wh_id := 1; 
  END IF;

  -- 1. Insert supplier_purchase header
  INSERT INTO supplier_purchases (
    supplier_id, warehouse_id, notes, total_amount, created_at
  ) VALUES (
    (payload->>'supplier_id')::bigint,
    v_first_wh_id,
    payload->>'notes',
    COALESCE(
      NULLIF((payload->>'total_amount')::numeric, 0),
      (
        SELECT COALESCE(SUM(
          (elem->>'quantity')::numeric * 
          (elem->>'unit_price')::numeric * 
          CASE WHEN (elem->>'unit_type') = 'bulk' THEN COALESCE((elem->>'kg_per_bag')::numeric, 0) ELSE 1 END
        ), 0)
        FROM jsonb_array_elements(payload->'items') AS elem
      ),
      0
    ),
    NOW()
  ) RETURNING id INTO v_purchase_id;

  -- 2. Loop through each item in payload->items
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items')
  LOOP
    v_product_id    := (v_item->>'product_id')::bigint;
    v_purchase_price := COALESCE((v_item->>'unit_price')::numeric, 0); 
    v_selling_price  := COALESCE((v_item->>'selling_price')::numeric, 0);
    v_expiry_date    := v_item->>'expiry_date';
    v_unit_type      := COALESCE(v_item->>'unit_type', 'piece');
    v_kg_per_bag     := (v_item->>'kg_per_bag')::numeric;

    FOR v_wh_id_text, v_wh_qty_text IN SELECT * FROM jsonb_each_text(v_item->'distribution')
    LOOP
      v_wh_id     := v_wh_id_text::bigint;
      v_batch_qty := v_wh_qty_text::int;
      
      IF v_batch_qty <= 0 THEN CONTINUE; END IF;

      -- 4. Audit Log: supplier_purchase_items
      INSERT INTO supplier_purchase_items (
        supplier_purchase_id, product_id,
        quantity, unit_price, total_price, expiry_date,
        created_at
      ) VALUES (
        v_purchase_id, v_product_id,
        v_batch_qty, v_purchase_price, 
        (v_batch_qty * v_purchase_price * CASE WHEN v_unit_type = 'bulk' THEN COALESCE(v_kg_per_bag, 0) ELSE 1 END),
        NULLIF(v_expiry_date, '')::date,
        NOW()
      );

      -- 5. UPSERT product_batches (The "Collection")
      SELECT id INTO v_existing_batch_id
      FROM product_batches
      WHERE product_id = v_product_id
        AND warehouse_id = v_wh_id
        AND purchase_price = v_purchase_price
        AND (
          (expiry_date IS NULL AND (v_expiry_date IS NULL OR v_expiry_date = ''))
          OR expiry_date = NULLIF(v_expiry_date, '')::date
        )
      LIMIT 1;

      IF v_existing_batch_id IS NOT NULL THEN
        UPDATE product_batches
        SET quantity    = quantity + v_batch_qty,
            kg_remaining = COALESCE(kg_remaining, 0) +
              CASE WHEN v_unit_type = 'bulk'
                THEN v_batch_qty * COALESCE(v_kg_per_bag, kg_per_bag, 0)
                ELSE 0
              END,
            bag_count = COALESCE(bag_count, 0) + CASE WHEN v_unit_type = 'bulk' THEN v_batch_qty ELSE 0 END,
            updated_at  = NOW()
        WHERE id = v_existing_batch_id;
        v_batch_id := v_existing_batch_id;
      ELSE
        INSERT INTO product_batches (
          product_id, warehouse_id, expiry_date,
          quantity, purchase_price, selling_price,
          unit_type, bag_count, kg_per_bag, kg_remaining,
          source, created_at, updated_at
        ) VALUES (
          v_product_id, v_wh_id,
          NULLIF(v_expiry_date, '')::date,
          v_batch_qty,
          v_purchase_price, v_selling_price,
          v_unit_type,
          CASE WHEN v_unit_type = 'bulk' THEN v_batch_qty ELSE NULL END,
          CASE WHEN v_unit_type = 'bulk' THEN v_kg_per_bag ELSE NULL END,
          CASE WHEN v_unit_type = 'bulk'
            THEN v_batch_qty * v_kg_per_bag
            ELSE NULL
          END,
          'supplier_purchase',
          NOW(), NOW()
        ) RETURNING id INTO v_batch_id;
      END IF;

      -- 6. Bulk specific: bag_instances
      IF v_unit_type = 'bulk' AND v_batch_qty > 0 THEN
        FOR i IN 1..v_batch_qty LOOP
          INSERT INTO bag_instances (
            batch_id, product_id, warehouse_id,
            bag_number, kg_total, kg_remaining,
            status, expiry_date, created_at
          ) VALUES (
            v_batch_id, v_product_id, v_wh_id,
            (SELECT COALESCE(MAX(bag_number),0) + 1 FROM bag_instances WHERE batch_id = v_batch_id),
            v_kg_per_bag, v_kg_per_bag,
            'sealed',
            NULLIF(v_expiry_date, '')::date,
            NOW()
          );
        END LOOP;
        
        UPDATE bag_instances
        SET status = 'open', opened_at = NOW()
        WHERE id = (
          SELECT id FROM bag_instances
          WHERE product_id = v_product_id AND warehouse_id = v_wh_id AND status = 'sealed'
          AND NOT EXISTS (SELECT 1 FROM bag_instances WHERE product_id = v_product_id AND warehouse_id = v_wh_id AND status = 'open')
          ORDER BY expiry_date ASC NULLS LAST, id ASC
          LIMIT 1
        );
      END IF;

      -- 7. Sync summary stock table
      INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
      VALUES (v_product_id, v_wh_id, 0, NOW())
      ON CONFLICT (product_id, warehouse_id) DO NOTHING;
      
      UPDATE product_warehouse_stock
      SET quantity = (SELECT COALESCE(SUM(quantity), 0) FROM product_batches WHERE product_id = v_product_id AND warehouse_id = v_wh_id),
          updated_at = NOW()
      WHERE product_id = v_product_id AND warehouse_id = v_wh_id;

    END LOOP;

    -- 8. Global product price updates
    UPDATE products
    SET selling_price = CASE WHEN v_selling_price > 0 THEN v_selling_price ELSE products.selling_price END,
        purchase_price = v_purchase_price,
        updated_at = NOW()
    WHERE id = v_product_id;

  END LOOP;

  RETURN jsonb_build_object('id', v_purchase_id, 'success', true);
END;
$$;


ALTER FUNCTION "public"."create_supplier_receipt"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_invoice_item"("invoice_id" bigint, "item_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  inv record;
  item_exists boolean;
  item_count int;
begin
  select * into inv from invoices where id = invoice_id;
  if inv is null then
    raise exception 'الفاتورة غير موجودة';
  end if;
  if coalesce(inv.invoice_lifecycle, 'active') = 'cancelled' then
    raise exception 'الفاتورة ملغاة ولا يمكن تعديلها';
  end if;

  select exists(select 1 from invoice_items where id = item_id and invoice_items.invoice_id = delete_invoice_item.invoice_id)
  into item_exists;
  if not item_exists then
    raise exception 'الصنف غير موجود في هذه الفاتورة';
  end if;

  select count(*)::int into item_count from invoice_items where invoice_items.invoice_id = delete_invoice_item.invoice_id;
  if item_count <= 1 then
    raise exception 'لا يمكن حذف آخر صنف — ألغِ الفاتورة أو أضف صنفاً آخر أولاً';
  end if;

  perform public.reverse_invoice_item(item_id);
  delete from invoice_items where id = item_id;

  update invoices i
  set total_amount = x.total,
      paid_amount = least(coalesce(i.paid_amount,0), x.total),
      remaining_amount = greatest(0, x.total - least(coalesce(i.paid_amount,0), x.total)),
      status = case
        when x.total > 0 and least(coalesce(i.paid_amount,0), x.total) >= x.total then 'مدفوعة'
        when least(coalesce(i.paid_amount,0), x.total) > 0 then 'جزئي'
        else 'معلق'
      end,
      updated_at = now()
  from (
    select inv.id as invoice_id,
           greatest(0, coalesce(sum(ii.total_price),0) - coalesce(inv.discount_amount,0)) as total
    from invoices inv
    left join invoice_items ii on ii.invoice_id = inv.id
    where inv.id = delete_invoice_item.invoice_id
    group by inv.id, inv.discount_amount
  ) x
  where i.id = x.invoice_id;

  return jsonb_build_object('ok', true, 'data', to_jsonb((select i from invoices i where i.id = invoice_id)));
end;
$$;


ALTER FUNCTION "public"."delete_invoice_item"("invoice_id" bigint, "item_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."replace_invoice"("id" bigint, "payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  inv record;
  res jsonb;
begin
  select * into inv from invoices where invoices.id = replace_invoice.id;
  if inv is null then
    return jsonb_build_object('ok', false, 'message', 'الفاتورة غير موجودة');
  end if;
  if coalesce(inv.invoice_lifecycle,'active') = 'cancelled' then
    raise exception 'الفاتورة ملغاة ولا يمكن تعديلها';
  end if;

  perform public.cancel_invoice(replace_invoice.id);
  res := public.create_invoice(payload || jsonb_build_object('client_id', inv.client_id, 'barn_id', inv.barn_id, 'warehouse_id', inv.warehouse_id));

  if not (res->>'ok')::boolean then
    return res;
  end if;

  update invoices
  set id = replace_invoice.id
  where invoices.id = ((res->'data'->>'id')::bigint);

  return jsonb_build_object('ok', true, 'data', to_jsonb((select i from invoices i where i.id = replace_invoice.id)));
end;
$$;


ALTER FUNCTION "public"."replace_invoice"("id" bigint, "payload" "jsonb") OWNER TO "postgres";


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
begin
  if v_invoice_id is null or v_item_id is null then
    raise exception 'invoice_id و item_id مطلوبان';
  end if;

  select ii.*
  into v_item
  from invoice_items ii
  where ii.id = v_item_id and ii.invoice_id = v_invoice_id;

  if v_item is null then
    raise exception 'الصنف غير موجود في هذه الفاتورة';
  end if;

  v_line_qty := coalesce(v_item.quantity,0);
  if v_ret is null or v_ret <= 0 or v_ret > v_line_qty + 0.0001 then
    raise exception 'كمية الإرجاع غير صالحة';
  end if;

  -- Reuse reversal + reapply reduced quantity by deleting allocations and adjusting line
  perform public.reverse_invoice_item(v_item_id);
  update invoice_items
  set quantity = greatest(0, v_line_qty - v_ret),
      total_price = greatest(0, coalesce(unit_price,0) * greatest(0, v_line_qty - v_ret))
  where id = v_item_id;

  insert into return_documents (invoice_id, client_id, barn_id, notes, created_at)
  select i.id, i.client_id, i.barn_id, v_notes, now()
  from invoices i where i.id = v_invoice_id;

  insert into return_items (return_document_id, invoice_item_id, batch_id, bag_instance_id, returned_quantity, notes, return_date)
  values ((select max(id) from return_documents where invoice_id = v_invoice_id), v_item_id, v_item.batch_id, v_item.sold_from_bag_id, v_ret, v_notes, now());

  return jsonb_build_object('ok', true, 'data', to_jsonb((select i from invoices i where i.id = v_invoice_id)));
end;
$$;


ALTER FUNCTION "public"."return_partial_invoice_item"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reverse_invoice_item"("item_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_item record;
  v_wh bigint;
  v_qty numeric;
  v_bag record;
  v_batch record;
begin
  select ii.*, i.warehouse_id as invoice_warehouse_id, p.unit_type as product_unit_type
  into v_item
  from invoice_items ii
  join invoices i on i.id = ii.invoice_id
  left join products p on p.id = ii.product_id
  where ii.id = item_id;

  if v_item is null then
    return jsonb_build_object('ok', true, 'data', null);
  end if;

  v_wh := coalesce(v_item.batch_warehouse_id, v_item.invoice_warehouse_id);
  if v_item.product_id is null or v_wh is null then
    return jsonb_build_object('ok', true, 'data', null);
  end if;

  if coalesce(v_item.product_unit_type, 'piece') = 'bulk' then
    for v_bag in
      select id, bag_id, amount_kg
      from invoice_item_bags
      where invoice_item_id = item_id
      order by id desc
    loop
      update bag_instances
      set kg_remaining = coalesce(kg_remaining,0) + coalesce(v_bag.amount_kg,0),
          status = case when status = 'empty' and coalesce(kg_remaining,0) + coalesce(v_bag.amount_kg,0) > 0.001 then 'open' else status end
      where id = v_bag.bag_id;
    end loop;

    update product_batches pb
    set kg_remaining = coalesce((
      select sum(bi.kg_remaining)
      from bag_instances bi
      where bi.batch_id = pb.id
    ),0), updated_at = now()
    where pb.id in (
      select b.batch_id
      from bag_instances b
      join invoice_item_bags iib on iib.bag_id = b.id
      where iib.invoice_item_id = item_id
    );

    delete from invoice_item_bags where invoice_item_id = item_id;

    update product_warehouse_stock pws
    set quantity = coalesce((
      select sum(coalesce(pb.quantity,0))
      from product_batches pb
      where pb.product_id = v_item.product_id and pb.warehouse_id = v_wh
    ),0),
    updated_at = now()
    where pws.product_id = v_item.product_id and pws.warehouse_id = v_wh;

  else
    for v_batch in
      select id, batch_id, quantity
      from invoice_item_batches
      where invoice_item_id = item_id
      order by id desc
    loop
      update product_batches
      set quantity = coalesce(quantity,0) + coalesce(v_batch.quantity,0), updated_at = now()
      where id = v_batch.batch_id;
    end loop;

    delete from invoice_item_batches where invoice_item_id = item_id;

    insert into product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
    values (
      v_item.product_id,
      v_wh,
      coalesce((
        select sum(coalesce(pb.quantity,0))
        from product_batches pb
        where pb.product_id = v_item.product_id and pb.warehouse_id = v_wh
      ),0),
      now()
    )
    on conflict (product_id, warehouse_id)
    do update set quantity = excluded.quantity, updated_at = now();
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('item_id', item_id));
end;
$$;


ALTER FUNCTION "public"."reverse_invoice_item"("item_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."route_payment"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  method text := coalesce(payload->>'payment_method', '');
  amount numeric := coalesce((payload->>'amount')::numeric, 0);
  payment_id bigint := nullif(payload->>'id','')::bigint;
  wallet_id bigint := nullif(payload->>'wallet_id','')::bigint;
begin
  if method in ('deferred', 'historical_invoice_paid') then
    return jsonb_build_object('ok', true, 'data', payload);
  end if;

  if method = 'cash' then
    insert into safe_transactions (type, amount, reference_type, reference_id, notes, created_at, created_by)
    values ('customer_payment_in', amount, 'payment', payment_id, null, now(), null);
  elsif method in ('vodafone_cash', 'instapay') then
    insert into wallet_transactions (type, amount, wallet_id, reference_type, reference_id, notes, created_at, created_by)
    values ('invoice_payment_in', amount, wallet_id, 'payment', payment_id, null, now(), null);
  end if;

  return jsonb_build_object('ok', true, 'data', payload);
end;
$$;


ALTER FUNCTION "public"."route_payment"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bag_instances" (
    "id" bigint NOT NULL,
    "batch_id" bigint NOT NULL,
    "product_id" bigint NOT NULL,
    "warehouse_id" bigint NOT NULL,
    "bag_number" bigint NOT NULL,
    "kg_total" numeric(12,4) NOT NULL,
    "kg_remaining" numeric(12,4) NOT NULL,
    "status" "text" DEFAULT 'sealed'::"text" NOT NULL,
    "expiry_date" "date",
    "opened_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bag_instances" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."bag_instances_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."bag_instances_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."bag_instances_id_seq" OWNED BY "public"."bag_instances"."id";



CREATE TABLE IF NOT EXISTS "public"."barn_billing_cycles" (
    "id" bigint NOT NULL,
    "barn_id" bigint NOT NULL,
    "started_at" "date" NOT NULL,
    "ended_at" "date",
    "carry_in" numeric(12,4) DEFAULT 0 NOT NULL,
    "carryover_out" numeric(12,4),
    "closed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."barn_billing_cycles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."barn_billing_cycles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."barn_billing_cycles_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."barn_billing_cycles_id_seq" OWNED BY "public"."barn_billing_cycles"."id";



CREATE TABLE IF NOT EXISTS "public"."barns" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "initial_debt" numeric(12,4) DEFAULT 0,
    "total_invoices" bigint DEFAULT 0,
    "total_profit" numeric(12,4) DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."barns" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."barns_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."barns_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."barns_id_seq" OWNED BY "public"."barns"."id";



CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" bigint NOT NULL,
    "name_ar" "text" NOT NULL
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."categories_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."categories_id_seq" OWNED BY "public"."categories"."id";



CREATE TABLE IF NOT EXISTS "public"."client_billing_cycles" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "started_at" "date" NOT NULL,
    "ended_at" "date",
    "carry_in" numeric(12,4) DEFAULT 0 NOT NULL,
    "carryover_out" numeric(12,4),
    "closed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_billing_cycles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."client_billing_cycles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."client_billing_cycles_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."client_billing_cycles_id_seq" OWNED BY "public"."client_billing_cycles"."id";



CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "location" "text",
    "initial_debt" numeric(12,4) DEFAULT 0,
    "last_visit" "date",
    "total_profit" numeric(12,4) DEFAULT 0,
    "favorite" boolean DEFAULT false,
    "pinned" boolean DEFAULT false,
    "pinned_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."clients_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."clients_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."clients_id_seq" OWNED BY "public"."clients"."id";



CREATE TABLE IF NOT EXISTS "public"."digital_wallets" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "provider" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."digital_wallets" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."digital_wallets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."digital_wallets_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."digital_wallets_id_seq" OWNED BY "public"."digital_wallets"."id";



CREATE TABLE IF NOT EXISTS "public"."invoice_item_bags" (
    "id" bigint NOT NULL,
    "invoice_item_id" bigint NOT NULL,
    "bag_id" bigint NOT NULL,
    "amount_kg" numeric(12,4) NOT NULL
);


ALTER TABLE "public"."invoice_item_bags" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."invoice_item_bags_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."invoice_item_bags_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."invoice_item_bags_id_seq" OWNED BY "public"."invoice_item_bags"."id";



CREATE TABLE IF NOT EXISTS "public"."invoice_item_batches" (
    "id" bigint NOT NULL,
    "invoice_item_id" bigint NOT NULL,
    "batch_id" bigint NOT NULL,
    "quantity" numeric(12,4) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."invoice_item_batches" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."invoice_item_batches_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."invoice_item_batches_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."invoice_item_batches_id_seq" OWNED BY "public"."invoice_item_batches"."id";



CREATE TABLE IF NOT EXISTS "public"."invoice_items" (
    "id" bigint NOT NULL,
    "invoice_id" bigint NOT NULL,
    "product_id" bigint,
    "product_name" "text" DEFAULT ''::"text",
    "quantity" numeric(12,4) DEFAULT 0,
    "unit_price" numeric(12,4) DEFAULT 0,
    "total_price" numeric(12,4) DEFAULT 0,
    "batch_id" bigint,
    "sold_from_bag_id" bigint,
    "unit_purchase_price" numeric(12,4),
    "unit_selling_price" numeric(12,4),
    "batch_expiry_date" "date",
    "batch_warehouse_id" bigint,
    "display_quantity" numeric(12,4),
    "display_unit" "text" DEFAULT 'kg'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invoice_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."invoice_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."invoice_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."invoice_items_id_seq" OWNED BY "public"."invoice_items"."id";



CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "barn_id" bigint,
    "warehouse_id" bigint NOT NULL,
    "customer_name" "text" DEFAULT ''::"text",
    "total_amount" numeric(12,4) DEFAULT 0,
    "paid_amount" numeric(12,4) DEFAULT 0,
    "remaining_amount" numeric(12,4) DEFAULT 0,
    "profit_amount" numeric(12,4) DEFAULT 0,
    "payment_method" "text" DEFAULT 'cash'::"text",
    "status" "text" DEFAULT 'معلق'::"text",
    "notes" "text",
    "discount_amount" numeric(12,4) DEFAULT 0,
    "invoice_lifecycle" "text" DEFAULT 'active'::"text",
    "due_date" "date",
    "billing_cycle_id" bigint,
    "barn_billing_cycle_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    "created_by" "text",
    "last_edited_by" bigint,
    "last_edited_at" timestamp with time zone,
    "edit_override_reason" "text"
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."invoices_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."invoices_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."invoices_id_seq" OWNED BY "public"."invoices"."id";



CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "barn_id" bigint,
    "amount" numeric(12,4) NOT NULL,
    "payment_method" "text" DEFAULT 'cash'::"text",
    "notes" "text",
    "payment_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text",
    "billing_cycle_id" bigint,
    "barn_billing_cycle_id" bigint,
    "invoice_id" bigint,
    "wallet_id" bigint,
    "settled_at" timestamp with time zone
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."payments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."payments_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."payments_id_seq" OWNED BY "public"."payments"."id";



CREATE TABLE IF NOT EXISTS "public"."product_batches" (
    "id" bigint NOT NULL,
    "product_id" bigint NOT NULL,
    "warehouse_id" bigint NOT NULL,
    "expiry_date" "date" NOT NULL,
    "quantity" numeric(12,4) DEFAULT 0,
    "purchase_price" numeric(12,4),
    "selling_price" numeric(12,4),
    "unit_type" "text" DEFAULT 'piece'::"text",
    "bag_count" bigint,
    "kg_per_bag" numeric(12,4),
    "kg_remaining" numeric(12,4),
    "source" "text" DEFAULT 'supplier_purchase'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_batches" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."product_batches_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."product_batches_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."product_batches_id_seq" OWNED BY "public"."product_batches"."id";



CREATE TABLE IF NOT EXISTS "public"."product_warehouse_stock" (
    "product_id" bigint NOT NULL,
    "warehouse_id" bigint NOT NULL,
    "quantity" numeric(12,4) DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_warehouse_stock" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "company" "text",
    "category" "text",
    "barcode" "text",
    "unit_type" "text" DEFAULT 'piece'::"text" NOT NULL,
    "bag_weight_kg" numeric(12,4),
    "purchase_price" numeric(12,4) DEFAULT 0,
    "selling_price" numeric(12,4) DEFAULT 0,
    "alert_level" numeric(12,4) DEFAULT 0,
    "alert_level_kg" numeric(12,4),
    "expiry_date" "date",
    "image_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."products_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."products_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."products_id_seq" OWNED BY "public"."products"."id";



CREATE TABLE IF NOT EXISTS "public"."return_documents" (
    "id" bigint NOT NULL,
    "invoice_id" bigint,
    "client_id" bigint,
    "barn_id" bigint,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."return_documents" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."return_documents_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."return_documents_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."return_documents_id_seq" OWNED BY "public"."return_documents"."id";



CREATE TABLE IF NOT EXISTS "public"."return_items" (
    "id" bigint NOT NULL,
    "return_document_id" bigint NOT NULL,
    "invoice_item_id" bigint,
    "batch_id" bigint,
    "bag_instance_id" bigint,
    "returned_quantity" numeric(12,4) NOT NULL,
    "notes" "text",
    "return_date" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."return_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."return_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."return_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."return_items_id_seq" OWNED BY "public"."return_items"."id";



CREATE OR REPLACE VIEW "public"."return_transactions" AS
 SELECT "ri"."id",
    "rd"."invoice_id",
    "ri"."invoice_item_id",
    "ri"."batch_id",
    "ri"."bag_instance_id",
    "ri"."returned_quantity",
    "ri"."return_date",
    "ri"."notes"
   FROM ("public"."return_items" "ri"
     LEFT JOIN "public"."return_documents" "rd" ON (("rd"."id" = "ri"."return_document_id")));


ALTER VIEW "public"."return_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."safe_transactions" (
    "id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric(12,4) NOT NULL,
    "reference_type" "text",
    "reference_id" bigint,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text"
);


ALTER TABLE "public"."safe_transactions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."safe_transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."safe_transactions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."safe_transactions_id_seq" OWNED BY "public"."safe_transactions"."id";



CREATE TABLE IF NOT EXISTS "public"."settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_payments" (
    "id" bigint NOT NULL,
    "supplier_id" bigint NOT NULL,
    "amount" numeric(12,4) NOT NULL,
    "payment_method" "text" DEFAULT 'cash'::"text",
    "notes" "text",
    "payment_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text"
);


ALTER TABLE "public"."supplier_payments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."supplier_payments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."supplier_payments_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."supplier_payments_id_seq" OWNED BY "public"."supplier_payments"."id";



CREATE TABLE IF NOT EXISTS "public"."supplier_purchase_items" (
    "id" bigint NOT NULL,
    "supplier_purchase_id" bigint NOT NULL,
    "product_id" bigint NOT NULL,
    "quantity" numeric(12,4) DEFAULT 0,
    "unit_price" numeric(12,4) DEFAULT 0,
    "total_price" numeric(12,4) DEFAULT 0,
    "expiry_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."supplier_purchase_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."supplier_purchase_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."supplier_purchase_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."supplier_purchase_items_id_seq" OWNED BY "public"."supplier_purchase_items"."id";



CREATE TABLE IF NOT EXISTS "public"."supplier_purchases" (
    "id" bigint NOT NULL,
    "supplier_id" bigint NOT NULL,
    "warehouse_id" bigint NOT NULL,
    "total_amount" numeric(12,4) DEFAULT 0,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text"
);


ALTER TABLE "public"."supplier_purchases" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."supplier_purchases_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."supplier_purchases_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."supplier_purchases_id_seq" OWNED BY "public"."supplier_purchases"."id";



CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "address" "text",
    "notes" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."suppliers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."suppliers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."suppliers_id_seq" OWNED BY "public"."suppliers"."id";



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" bigint NOT NULL,
    "email" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "display_name" "text",
    "role" "text" DEFAULT 'staff'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['super_admin'::"text", 'admin'::"text", 'staff'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."users_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."users_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."users_id_seq" OWNED BY "public"."users"."id";



CREATE TABLE IF NOT EXISTS "public"."wallet_transactions" (
    "id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric(12,4) NOT NULL,
    "wallet_id" bigint,
    "reference_type" "text",
    "reference_id" bigint,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "text"
);


ALTER TABLE "public"."wallet_transactions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."wallet_transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."wallet_transactions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."wallet_transactions_id_seq" OWNED BY "public"."wallet_transactions"."id";



CREATE TABLE IF NOT EXISTS "public"."warehouses" (
    "id" bigint NOT NULL,
    "name_ar" "text" NOT NULL,
    "name_en" "text",
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."warehouses" OWNER TO "postgres";


ALTER TABLE ONLY "public"."bag_instances" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bag_instances_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."barn_billing_cycles" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."barn_billing_cycles_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."barns" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."barns_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."categories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."client_billing_cycles" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."client_billing_cycles_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."clients" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."clients_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."digital_wallets" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."digital_wallets_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."invoice_item_bags" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."invoice_item_bags_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."invoice_item_batches" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."invoice_item_batches_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."invoice_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."invoice_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."invoices" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."invoices_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."payments" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."payments_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."product_batches" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."product_batches_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."products" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."products_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."return_documents" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."return_documents_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."return_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."return_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."safe_transactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."safe_transactions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."supplier_payments" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."supplier_payments_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."supplier_purchase_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."supplier_purchase_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."supplier_purchases" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."supplier_purchases_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."suppliers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."suppliers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."users" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."users_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."wallet_transactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."wallet_transactions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."bag_instances"
    ADD CONSTRAINT "bag_instances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."barn_billing_cycles"
    ADD CONSTRAINT "barn_billing_cycles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."barns"
    ADD CONSTRAINT "barns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_billing_cycles"
    ADD CONSTRAINT "client_billing_cycles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."digital_wallets"
    ADD CONSTRAINT "digital_wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_item_bags"
    ADD CONSTRAINT "invoice_item_bags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_item_batches"
    ADD CONSTRAINT "invoice_item_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_batches"
    ADD CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_warehouse_stock"
    ADD CONSTRAINT "product_warehouse_stock_pkey" PRIMARY KEY ("product_id", "warehouse_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."return_documents"
    ADD CONSTRAINT "return_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."return_items"
    ADD CONSTRAINT "return_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."safe_transactions"
    ADD CONSTRAINT "safe_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."supplier_payments"
    ADD CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_purchase_items"
    ADD CONSTRAINT "supplier_purchase_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_purchases"
    ADD CONSTRAINT "supplier_purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."warehouses"
    ADD CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_payments_invoice_id" ON "public"."payments" USING "btree" ("invoice_id");



CREATE UNIQUE INDEX "idx_payments_one_deferred_per_invoice" ON "public"."payments" USING "btree" ("invoice_id") WHERE (("payment_method" = 'deferred'::"text") AND ("invoice_id" IS NOT NULL));



CREATE INDEX "idx_product_batches_lookup" ON "public"."product_batches" USING "btree" ("product_id", "warehouse_id", "purchase_price", "expiry_date");



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE OR REPLACE TRIGGER "trg_app_settings_updated_at" BEFORE UPDATE ON "public"."app_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_barns_updated_at" BEFORE UPDATE ON "public"."barns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_digital_wallets_updated_at" BEFORE UPDATE ON "public"."digital_wallets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_product_batches_updated_at" BEFORE UPDATE ON "public"."product_batches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_product_warehouse_stock_updated_at" BEFORE UPDATE ON "public"."product_warehouse_stock" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_products_updated_at" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_settings_updated_at" BEFORE UPDATE ON "public"."settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_suppliers_updated_at" BEFORE UPDATE ON "public"."suppliers" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."bag_instances"
    ADD CONSTRAINT "bag_instances_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."product_batches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bag_instances"
    ADD CONSTRAINT "bag_instances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bag_instances"
    ADD CONSTRAINT "bag_instances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."barn_billing_cycles"
    ADD CONSTRAINT "barn_billing_cycles_barn_id_fkey" FOREIGN KEY ("barn_id") REFERENCES "public"."barns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."barns"
    ADD CONSTRAINT "barns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_billing_cycles"
    ADD CONSTRAINT "client_billing_cycles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_item_bags"
    ADD CONSTRAINT "invoice_item_bags_bag_id_fkey" FOREIGN KEY ("bag_id") REFERENCES "public"."bag_instances"("id");



ALTER TABLE ONLY "public"."invoice_item_bags"
    ADD CONSTRAINT "invoice_item_bags_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_item_batches"
    ADD CONSTRAINT "invoice_item_batches_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."product_batches"("id");



ALTER TABLE ONLY "public"."invoice_item_batches"
    ADD CONSTRAINT "invoice_item_batches_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."product_batches"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_sold_from_bag_id_fkey" FOREIGN KEY ("sold_from_bag_id") REFERENCES "public"."bag_instances"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_barn_billing_cycle_id_fkey" FOREIGN KEY ("barn_billing_cycle_id") REFERENCES "public"."barn_billing_cycles"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_barn_id_fkey" FOREIGN KEY ("barn_id") REFERENCES "public"."barns"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_billing_cycle_id_fkey" FOREIGN KEY ("billing_cycle_id") REFERENCES "public"."client_billing_cycles"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_last_edited_by_fkey" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_barn_billing_cycle_id_fkey" FOREIGN KEY ("barn_billing_cycle_id") REFERENCES "public"."barn_billing_cycles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_barn_id_fkey" FOREIGN KEY ("barn_id") REFERENCES "public"."barns"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_billing_cycle_id_fkey" FOREIGN KEY ("billing_cycle_id") REFERENCES "public"."client_billing_cycles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."product_batches"
    ADD CONSTRAINT "product_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_batches"
    ADD CONSTRAINT "product_batches_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_warehouse_stock"
    ADD CONSTRAINT "product_warehouse_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_warehouse_stock"
    ADD CONSTRAINT "product_warehouse_stock_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."return_documents"
    ADD CONSTRAINT "return_documents_barn_id_fkey" FOREIGN KEY ("barn_id") REFERENCES "public"."barns"("id");



ALTER TABLE ONLY "public"."return_documents"
    ADD CONSTRAINT "return_documents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."return_documents"
    ADD CONSTRAINT "return_documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."return_items"
    ADD CONSTRAINT "return_items_bag_instance_id_fkey" FOREIGN KEY ("bag_instance_id") REFERENCES "public"."bag_instances"("id");



ALTER TABLE ONLY "public"."return_items"
    ADD CONSTRAINT "return_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."product_batches"("id");



ALTER TABLE ONLY "public"."return_items"
    ADD CONSTRAINT "return_items_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id");



ALTER TABLE ONLY "public"."return_items"
    ADD CONSTRAINT "return_items_return_document_id_fkey" FOREIGN KEY ("return_document_id") REFERENCES "public"."return_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_payments"
    ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE ONLY "public"."supplier_purchase_items"
    ADD CONSTRAINT "supplier_purchase_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."supplier_purchase_items"
    ADD CONSTRAINT "supplier_purchase_items_supplier_purchase_id_fkey" FOREIGN KEY ("supplier_purchase_id") REFERENCES "public"."supplier_purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_purchases"
    ADD CONSTRAINT "supplier_purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE ONLY "public"."supplier_purchases"
    ADD CONSTRAINT "supplier_purchases_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."digital_wallets"("id");



ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bag_instances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."barn_billing_cycles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."barns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_billing_cycles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."digital_wallets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_item_bags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_item_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_warehouse_stock" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."return_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."return_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."safe_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_role_full_access" ON "public"."app_settings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."bag_instances" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."barn_billing_cycles" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."barns" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."categories" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."client_billing_cycles" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."clients" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."digital_wallets" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."invoice_item_bags" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."invoice_item_batches" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."invoice_items" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."invoices" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."payments" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."product_batches" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."product_warehouse_stock" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."products" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."return_documents" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."return_items" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."safe_transactions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."settings" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."supplier_payments" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."supplier_purchase_items" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."supplier_purchases" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."suppliers" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."users" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."wallet_transactions" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role_full_access" ON "public"."warehouses" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supplier_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supplier_purchase_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supplier_purchases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wallet_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."warehouses" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."auto_open_next_bag"("product_id" bigint, "warehouse_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."auto_open_next_bag"("product_id" bigint, "warehouse_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_open_next_bag"("product_id" bigint, "warehouse_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_invoice"("id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_invoice"("id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_invoice"("id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_invoice"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_invoice"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_invoice"("payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_supplier_receipt"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_supplier_receipt"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_supplier_receipt"("payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_invoice_item"("invoice_id" bigint, "item_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."delete_invoice_item"("invoice_id" bigint, "item_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_invoice_item"("invoice_id" bigint, "item_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."replace_invoice"("id" bigint, "payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."replace_invoice"("id" bigint, "payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_invoice"("id" bigint, "payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."return_partial_invoice_item"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."return_partial_invoice_item"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."return_partial_invoice_item"("payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."reverse_invoice_item"("item_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."reverse_invoice_item"("item_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reverse_invoice_item"("item_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."route_payment"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."route_payment"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."route_payment"("payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."bag_instances" TO "anon";
GRANT ALL ON TABLE "public"."bag_instances" TO "authenticated";
GRANT ALL ON TABLE "public"."bag_instances" TO "service_role";



GRANT ALL ON SEQUENCE "public"."bag_instances_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bag_instances_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bag_instances_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."barn_billing_cycles" TO "anon";
GRANT ALL ON TABLE "public"."barn_billing_cycles" TO "authenticated";
GRANT ALL ON TABLE "public"."barn_billing_cycles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."barn_billing_cycles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."barn_billing_cycles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."barn_billing_cycles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."barns" TO "anon";
GRANT ALL ON TABLE "public"."barns" TO "authenticated";
GRANT ALL ON TABLE "public"."barns" TO "service_role";



GRANT ALL ON SEQUENCE "public"."barns_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."barns_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."barns_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_billing_cycles" TO "anon";
GRANT ALL ON TABLE "public"."client_billing_cycles" TO "authenticated";
GRANT ALL ON TABLE "public"."client_billing_cycles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_billing_cycles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_billing_cycles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_billing_cycles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON SEQUENCE "public"."clients_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."clients_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."clients_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."digital_wallets" TO "anon";
GRANT ALL ON TABLE "public"."digital_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."digital_wallets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."digital_wallets_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."digital_wallets_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."digital_wallets_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_item_bags" TO "anon";
GRANT ALL ON TABLE "public"."invoice_item_bags" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_item_bags" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoice_item_bags_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoice_item_bags_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoice_item_bags_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_item_batches" TO "anon";
GRANT ALL ON TABLE "public"."invoice_item_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_item_batches" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoice_item_batches_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoice_item_batches_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoice_item_batches_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_items" TO "anon";
GRANT ALL ON TABLE "public"."invoice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoice_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoice_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoice_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoices_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoices_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoices_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."payments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."payments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."payments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."product_batches" TO "anon";
GRANT ALL ON TABLE "public"."product_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."product_batches" TO "service_role";



GRANT ALL ON SEQUENCE "public"."product_batches_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."product_batches_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."product_batches_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."product_warehouse_stock" TO "anon";
GRANT ALL ON TABLE "public"."product_warehouse_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."product_warehouse_stock" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON SEQUENCE "public"."products_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."products_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."products_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."return_documents" TO "anon";
GRANT ALL ON TABLE "public"."return_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."return_documents" TO "service_role";



GRANT ALL ON SEQUENCE "public"."return_documents_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."return_documents_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."return_documents_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."return_items" TO "anon";
GRANT ALL ON TABLE "public"."return_items" TO "authenticated";
GRANT ALL ON TABLE "public"."return_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."return_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."return_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."return_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."return_transactions" TO "anon";
GRANT ALL ON TABLE "public"."return_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."return_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."safe_transactions" TO "anon";
GRANT ALL ON TABLE "public"."safe_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."safe_transactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."safe_transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."safe_transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."safe_transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."settings" TO "anon";
GRANT ALL ON TABLE "public"."settings" TO "authenticated";
GRANT ALL ON TABLE "public"."settings" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_payments" TO "anon";
GRANT ALL ON TABLE "public"."supplier_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_payments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."supplier_payments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."supplier_payments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."supplier_payments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_purchase_items" TO "anon";
GRANT ALL ON TABLE "public"."supplier_purchase_items" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_purchase_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."supplier_purchase_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."supplier_purchase_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."supplier_purchase_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_purchases" TO "anon";
GRANT ALL ON TABLE "public"."supplier_purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_purchases" TO "service_role";



GRANT ALL ON SEQUENCE "public"."supplier_purchases_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."supplier_purchases_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."supplier_purchases_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."suppliers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."suppliers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."suppliers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."users_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."users_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."users_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_transactions" TO "anon";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."wallet_transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wallet_transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wallet_transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."warehouses" TO "anon";
GRANT ALL ON TABLE "public"."warehouses" TO "authenticated";
GRANT ALL ON TABLE "public"."warehouses" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































