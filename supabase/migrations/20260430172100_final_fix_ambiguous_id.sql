-- Final Fix: column reference "id" is ambiguous.
-- This migration ensures all references in cancel_invoice and replace_invoice are fully qualified.

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
