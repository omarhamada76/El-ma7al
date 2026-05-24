-- Fix delete_invoice_item ambiguous column reference 'inv.id'
-- Rename subquery table alias from 'inv' to 't_inv' to prevent conflict with declared variable 'inv'

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
    select t_inv.id as invoice_id,
           greatest(0, coalesce(sum(ii.total_price),0) - coalesce(t_inv.discount_amount,0)) as total
    from invoices t_inv
    left join invoice_items ii on ii.invoice_id = t_inv.id
    where t_inv.id = delete_invoice_item.invoice_id
    group by t_inv.id, t_inv.discount_amount
  ) x
  where i.id = x.invoice_id;

  return jsonb_build_object('ok', true, 'data', to_jsonb((select i from invoices i where i.id = invoice_id)));
end;
$$;

GRANT ALL ON FUNCTION "public"."delete_invoice_item"("invoice_id" bigint, "item_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."delete_invoice_item"("invoice_id" bigint, "item_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_invoice_item"("invoice_id" bigint, "item_id" bigint) TO "service_role";
