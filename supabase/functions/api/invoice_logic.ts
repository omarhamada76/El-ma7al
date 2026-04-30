
// Ported from server/pgdb.js for parity with local environment

export async function syncWarehouseStockFromBatches(q: any, productId: number, warehouseId: number) {
  const pr = await q('SELECT unit_type FROM products WHERE id = $1', [productId])
  const isBulk = pr.rows[0]?.unit_type === 'bulk'
  
  const r = await q(
    'SELECT SUM(CASE WHEN $3 THEN kg_remaining ELSE quantity END) AS s FROM product_batches WHERE product_id = $1 AND warehouse_id = $2',
    [productId, warehouseId, isBulk]
  )
  const total = Number(r.rows[0]?.s ?? 0)
  
  await q(
    `INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (product_id, warehouse_id)
     DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
    [productId, warehouseId, total]
  )
}

export async function allocatePieceBatchesFefo(q: any, productId: number, warehouseId: number, totalQty: number) {
  const rows = await q(
    `SELECT pb.id, pb.quantity, pb.expiry_date
     FROM product_batches pb
     JOIN products p ON p.id = pb.product_id
     WHERE pb.product_id = $1
       AND pb.warehouse_id = $2
       AND COALESCE(p.unit_type, 'piece') != 'bulk'
       AND COALESCE(pb.quantity, 0) > 0
     ORDER BY pb.expiry_date ASC, pb.id ASC`,
    [productId, warehouseId]
  )
  
  const totalAvail = rows.rows.reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0)
  if (totalAvail + 0.0001 < totalQty) {
    throw new Error(`الكمية المتاحة في الدُفعات غير كافية للمنتج (مطلوب: ${totalQty}، متاح: ${totalAvail})`)
  }
  
  const out = []
  let rem = totalQty
  for (const r of rows.rows) {
    if (rem <= 0.0001) break
    const take = Math.min(rem, Number(r.quantity ?? 0))
    if (take > 0) {
      out.push({ batch_id: r.id, quantity: take })
      rem -= take
    }
  }
  return out
}

export async function allocateBulkBagsFefo(q: any, productId: number, warehouseId: number, totalKilos: number) {
  const rows = await q(
    `SELECT pb.id, pb.kg_remaining, pb.expiry_date
     FROM product_batches pb
     JOIN products p ON p.id = pb.product_id
     WHERE pb.product_id = $1
       AND pb.warehouse_id = $2
       AND p.unit_type = 'bulk'
       AND COALESCE(pb.kg_remaining, 0) > 0
     ORDER BY pb.expiry_date ASC, pb.id ASC`,
    [productId, warehouseId]
  )
  
  const totalAvail = rows.rows.reduce((s: number, r: any) => s + Number(r.kg_remaining ?? 0), 0)
  if (totalAvail + 0.0001 < totalKilos) {
    throw new Error(`الوزن المتاح غير كافٍ للمنتج (مطلوب: ${totalKilos} كيلو، متاح: ${totalAvail} كيلو)`)
  }
  
  const out = []
  let rem = totalKilos
  for (const r of rows.rows) {
    if (rem <= 0.0001) break
    const take = Math.min(rem, Number(r.kg_remaining ?? 0))
    if (take > 0) {
      out.push({ batch_id: r.id, amount_kg: take })
      rem -= take
    }
  }
  return out
}

async function routePaymentWithClient(q: any, paymentRow: any) {
  const method = String(paymentRow.payment_method || '')
  const amount = Number(paymentRow.amount ?? 0)
  if (method === 'deferred' || method === 'historical_invoice_paid' || method === 'discount') return
  
  if (method === 'cash') {
    await q(
      `INSERT INTO safe_transactions (type, amount, reference_type, reference_id, created_at)
       VALUES ('customer_payment_in', $1, 'payment', $2, NOW())`,
      [amount, paymentRow.id]
    )
  } else if (method === 'vodafone_cash' || method === 'instapay') {
    await q(
      `INSERT INTO wallet_transactions (type, amount, wallet_id, reference_type, reference_id, created_at)
       VALUES ('invoice_payment_in', $1, $2, 'payment', $3, NOW())`,
      [amount, paymentRow.wallet_id ?? null, paymentRow.id]
    )
  }
}

export async function insertPaymentWithRouting(q: any, payload: any) {
  const res = await q(
    `INSERT INTO payments
     (client_id, barn_id, amount, payment_method, notes, payment_date, created_at, billing_cycle_id, barn_billing_cycle_id, invoice_id, wallet_id)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10)
     RETURNING *`,
    [
      payload.client_id,
      payload.barn_id ?? null,
      payload.amount ?? 0,
      payload.payment_method || 'cash',
      payload.notes ?? null,
      payload.payment_date || new Date().toISOString().slice(0, 10),
      payload.billing_cycle_id ?? null,
      payload.barn_billing_cycle_id ?? null,
      payload.invoice_id ?? null,
      payload.wallet_id ?? null
    ]
  )
  const paymentRow = res.rows[0]
  await routePaymentWithClient(q, paymentRow)
  return paymentRow
}

export async function allocateFromSpecificBag(q: any, bagId: number, productId: number, warehouseId: number, totalKilos: number) {
  const row = await q(
    `SELECT id, batch_id, kg_remaining, status
     FROM bag_instances
     WHERE id = $1 AND product_id = $2 AND warehouse_id = $3`,
    [bagId, productId, warehouseId]
  )
  const bag = row.rows[0]
  if (!bag) throw new Error('الشكارة غير موجودة أو لا تطابق المخزن')
  if (!['open', 'sealed'].includes(String(bag.status))) throw new Error('هذه الشكارة غير متاحة للبيع')
  const avail = Number(bag.kg_remaining ?? 0)
  if (avail <= 0) throw new Error('لا يوجد وزن متبقٍ في هذه الشكارة')
  if (totalKilos > avail + 0.001) throw new Error(`الكمية تتجاوز المتبقي في الشكارة (متاح: ${avail} كجم)`)
  return [{ bag_id: bag.id, batch_id: bag.batch_id, amount_kg: totalKilos }]
}

export async function createInvoiceInternal(q: any, data: any) {
  const t = new Date().toISOString()
  const items = Array.isArray(data.items) ? data.items : []
  const subtotal = items.reduce((a: number, i: any) => a + Number(i.total_price || 0), 0)
  const discountAmount = Math.max(0, Number(data.discount_amount ?? 0))
  const total = Math.max(0, subtotal - discountAmount)
  let paid = Math.max(0, Number(data.paid_amount ?? 0))
  if (paid > total) paid = total
  const remaining = Math.max(0, total - paid)

  if (remaining > 0 && data.register_deferred !== true && paid > 0) {
    throw new Error('المبلغ المدفوع أقل من إجمالي الفاتورة.\nيرجى إدخال المبلغ المتبقي أو تسجيله كآجل')
  }

  let status = 'معلق'
  if (total > 0 && paid >= total) status = 'مدفوعة'
  else if (paid > 0) status = 'جزئي'

  const invoicePaymentMethod = remaining > 0 ? 'آجل' : data.immediate_payment_method || data.payment_method || 'cash'

  const pids = [...new Set(items.map((i: any) => i.product_id).filter(Boolean))]
  const pMap: Record<number, number> = {}
  const utMap: Record<number, string> = {}
  if (pids.length) {
    const r = await q('SELECT id, purchase_price, unit_type FROM products WHERE id = ANY($1)', [pids])
    for (const row of r.rows) {
      pMap[row.id] = Number(row.purchase_price ?? 0)
      utMap[row.id] = row.unit_type || 'piece'
    }
  }
  const totalCost = items.reduce((s: number, i: any) => s + Number(i.quantity || 0) * Number(pMap[i.product_id] ?? 0), 0)
  const profit = Math.max(0, total - totalCost)

  let billingCycleId = null
  if (data.client_id) {
    const oc = await q('SELECT id FROM client_billing_cycles WHERE client_id = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1', [data.client_id])
    billingCycleId = oc.rows[0]?.id ?? null
  }
  let barnBillingCycleId = null
  if (data.barn_id) {
    const ob = await q('SELECT id FROM barn_billing_cycles WHERE barn_id = $1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1', [data.barn_id])
    barnBillingCycleId = ob.rows[0]?.id ?? null
  }

  const dueDate = data.due_date ? String(data.due_date).trim().slice(0, 10) : null

  const insInv = await q(
    `INSERT INTO invoices
     (client_id, barn_id, warehouse_id, customer_name, total_amount, paid_amount, remaining_amount, profit_amount, payment_method, status, notes, discount_amount, created_at, created_by, billing_cycle_id, barn_billing_cycle_id, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NULL,$13,$14,$15)
     RETURNING id`,
    [
      data.client_id,
      data.barn_id ?? null,
      data.warehouse_id,
      data.customer_name || '',
      total,
      paid,
      remaining,
      profit,
      invoicePaymentMethod,
      status,
      data.notes ?? null,
      discountAmount,
      billingCycleId,
      barnBillingCycleId,
      dueDate
    ]
  )
  const invoiceId = insInv.rows[0].id

  for (const it of items) {
    const qty = Number(it.quantity ?? 0)
    const dispQtyRaw = it.display_quantity != null ? Number(it.display_quantity) : qty
    const dispU = it.display_unit === 'gram' ? 'gram' : 'kg'
    
    const insItem = await q(
      `INSERT INTO invoice_items
       (invoice_id, product_id, product_name, quantity, unit_price, total_price, batch_id, display_quantity, display_unit, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       RETURNING id`,
      [invoiceId, it.product_id, it.product_name || '', qty, Number(it.unit_price ?? 0), Number(it.total_price ?? 0), it.batch_id ?? null, dispQtyRaw, dispU]
    )
    const itemId = insItem.rows[0].id

    if (qty > 0 && it.product_id) {
      if (utMap[it.product_id] === 'bulk') {
        const allocs = it.bag_id
          ? await allocateFromSpecificBag(q, it.bag_id, it.product_id, data.warehouse_id, qty)
          : await allocateBulkBagsFefo(q, it.product_id, data.warehouse_id, qty)
          
        for (const al of allocs) {
          if ((al as any).bag_id) {
            await q('INSERT INTO invoice_item_bags (invoice_item_id, bag_id, amount_kg) VALUES ($1,$2,$3)', [itemId, (al as any).bag_id, al.amount_kg])
            await q("UPDATE bag_instances SET kg_remaining = GREATEST(0, COALESCE(kg_remaining,0) - $1), status = CASE WHEN COALESCE(kg_remaining,0) - $1 <= 0.001 THEN 'empty' ELSE status END WHERE id = $2", [al.amount_kg, (al as any).bag_id])
          }
          await q('UPDATE product_batches SET kg_remaining = GREATEST(0, COALESCE(kg_remaining,0) - $1), updated_at = NOW() WHERE id = $2', [al.amount_kg, al.batch_id])
        }
        await syncWarehouseStockFromBatches(q, it.product_id, data.warehouse_id)
      } else {
        if (it.batch_id) {
          const b = await q('SELECT quantity FROM product_batches WHERE id = $1', [it.batch_id])
          const avail = Number(b.rows[0]?.quantity ?? 0)
          if (avail + 0.0001 < qty) {
            throw new Error(`الكمية المطلوبة تتجاوز المخزون المتاح في هذه الدفعة (متاح: ${avail})`)
          }
          await q('UPDATE product_batches SET quantity = GREATEST(0, COALESCE(quantity,0) - $1), updated_at = NOW() WHERE id = $2', [qty, it.batch_id])
          await q('INSERT INTO invoice_item_batches (invoice_item_id, batch_id, quantity) VALUES ($1,$2,$3)', [itemId, it.batch_id, qty])
        } else {
          const allocs = await allocatePieceBatchesFefo(q, it.product_id, data.warehouse_id, qty)
          for (const al of allocs) {
            await q('INSERT INTO invoice_item_batches (invoice_item_id, batch_id, quantity) VALUES ($1,$2,$3)', [itemId, al.batch_id, al.quantity])
            await q('UPDATE product_batches SET quantity = GREATEST(0, COALESCE(quantity,0) - $1), updated_at = NOW() WHERE id = $2', [al.quantity, al.batch_id])
          }
        }
        await syncWarehouseStockFromBatches(q, it.product_id, data.warehouse_id)
      }
    }
  }

  await q('UPDATE clients SET total_profit = COALESCE(total_profit,0) + $1 WHERE id = $2', [profit, data.client_id])
  if (data.barn_id) {
    await q('UPDATE barns SET total_invoices = COALESCE(total_invoices,0) + 1, total_profit = COALESCE(total_profit,0) + $1 WHERE id = $2', [profit, data.barn_id])
  }

  const immediate = data.immediate_payment_method || (['cash', 'vodafone_cash', 'instapay'].includes(data.payment_method) ? data.payment_method : 'cash')
  if (paid > 0) {
    await insertPaymentWithRouting(q, {
      client_id: data.client_id,
      barn_id: data.barn_id ?? null,
      amount: paid,
      payment_method: immediate,
      notes: `دفعة فاتورة #${invoiceId}`,
      payment_date: t.slice(0, 10),
      billing_cycle_id: billingCycleId,
      barn_billing_cycle_id: barnBillingCycleId,
      invoice_id: invoiceId,
      wallet_id: data.wallet_id ?? null,
    })
  }
  if (remaining > 0 && (data.register_deferred === true || paid === 0)) {
     await insertPaymentWithRouting(q, {
      client_id: data.client_id,
      barn_id: data.barn_id ?? null,
      amount: remaining,
      payment_method: 'deferred',
      notes: `آجل فاتورة #${invoiceId}`,
      payment_date: t.slice(0, 10),
      billing_cycle_id: billingCycleId,
      barn_billing_cycle_id: barnBillingCycleId,
      invoice_id: invoiceId,
    })
  }

  return { id: invoiceId }
}

export async function replaceInvoiceInternal(q: any, originalId: number, data: any) {
  // 1. Get original metadata
  const origRes = await q('SELECT created_at, created_by, client_id, barn_id, warehouse_id FROM invoices WHERE id = $1', [originalId])
  const orig = origRes.rows[0]
  if (!orig) throw new Error('الفاتورة غير موجودة')

  // 2. Call cancel_invoice (SQL) to reverse everything
  await q('SELECT public.cancel_invoice($1)', [originalId])

  // 3. Vacate the original ID
  await q('UPDATE invoices SET id = -($1::bigint) WHERE id = $2', [originalId, originalId])

  // 4. Prepare payload for createInvoiceInternal
  const payload = {
    ...data,
    client_id: data.client_id ?? orig.client_id,
    barn_id: data.barn_id ?? orig.barn_id,
    warehouse_id: data.warehouse_id ?? orig.warehouse_id
  }

  // 5. Create new invoice using JS logic (handles stock correctly)
  const { id: newId } = await createInvoiceInternal(q, payload)

  // 6. Restore original ID and metadata to the new record
  await q(
    `UPDATE invoices 
     SET id = $1, created_at = $2, created_by = $3, updated_at = NOW() 
     WHERE id = $4`,
    [originalId, orig.created_at, orig.created_by, newId]
  )

  // 7. Update non-FK references (transactions)
  await q("UPDATE safe_transactions SET reference_id = $1 WHERE reference_id = $2 AND reference_type IN ('payment', 'invoice_cancel')", [originalId, newId])
  await q("UPDATE wallet_transactions SET reference_id = $1 WHERE reference_id = $2 AND reference_type IN ('payment', 'invoice_cancel')", [originalId, newId])

  // 8. Cleanup the temporary record
  await q('DELETE FROM invoices WHERE id = $1', [-originalId])

  return { id: originalId }
}
