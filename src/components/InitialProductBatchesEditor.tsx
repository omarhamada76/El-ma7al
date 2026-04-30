import { useCallback } from 'react'
import type { InitialBatchEntry } from '@/api/products'
import { fromMonthInputValue, toMonthInputValue } from '@/lib/utils'

export type InitialBatchUiRow = {
  key: string
  warehouse_id: number | ''
  expiry_date: string
  purchase_price: number | ''
  selling_price: number | ''
  quantity: number | ''
  bag_count: number | ''
  kg_per_bag: number | ''
  has_open_bag: boolean
  open_kg_remaining: number | ''
}

export function newInitialBatchRow(
  defaults: {
    warehouse_id: number | ''
    purchase_price: number | ''
    selling_price: number | ''
    bag_weight_kg: number | null
  }
): InitialBatchUiRow {
  return {
    key: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `b-${Date.now()}-${Math.random()}`,
    warehouse_id: defaults.warehouse_id,
    expiry_date: '',
    purchase_price: defaults.purchase_price,
    selling_price: defaults.selling_price,
    quantity: '',
    bag_count: '',
    kg_per_bag: defaults.bag_weight_kg ?? '',
    has_open_bag: true,
    open_kg_remaining: '',
  }
}

/** Build API payload or validation error (Arabic). */
export function buildInitialBatchesPayload(
  rows: InitialBatchUiRow[],
  unitType: 'piece' | 'bulk',
  defaultBagWeightKg: number | null
): { ok: true; batches: InitialBatchEntry[] } | { ok: false; error: string } {
  const normExp = (s: string) => fromMonthInputValue(toMonthInputValue(s))

  const filled = rows.filter((r) => r.warehouse_id !== '' && Number.isInteger(Number(r.warehouse_id)))
  if (filled.length === 0) {
    return { ok: true, batches: [] }
  }

  const out: InitialBatchEntry[] = []

  for (const r of filled) {
    const wh = Number(r.warehouse_id)
    const pp = r.purchase_price === '' ? NaN : Number(r.purchase_price)
    const sp = r.selling_price === '' ? NaN : Number(r.selling_price)
    if (!Number.isFinite(pp) || pp < 0) {
      return { ok: false, error: 'سعر الشراء مطلوب لكل دفعة' }
    }
    if (!Number.isFinite(sp) || sp < 0) {
      return { ok: false, error: 'سعر البيع مطلوب لكل دفعة' }
    }

    const expTrim = (r.expiry_date ?? '').trim()
    if (expTrim === '') {
      return { ok: false, error: 'تاريخ الصلاحية مطلوب لكل دفعة' }
    }

    if (unitType === 'piece') {
      const q = r.quantity === '' ? NaN : Math.floor(Number(r.quantity))
      if (!Number.isFinite(q) || q <= 0) {
        return { ok: false, error: 'أدخل كمية أكبر من صفر لكل دفعة (قطعة)' }
      }
      out.push({
        warehouse_id: wh,
        expiry_date: normExp(r.expiry_date)!,
        purchase_price: pp,
        selling_price: sp,
        quantity: q,
      })
      continue
    }

    const bc = r.bag_count === '' ? NaN : Math.floor(Number(r.bag_count))
    const kpbRaw = r.kg_per_bag === '' ? null : Number(r.kg_per_bag)
    const kgPerBag = kpbRaw != null && Number.isFinite(kpbRaw) && kpbRaw > 0 ? kpbRaw : defaultBagWeightKg ?? NaN
    if (!Number.isFinite(kgPerBag) || (kgPerBag as number) <= 0) {
      return { ok: false, error: 'أدخل وزن الشكارة (كجم) لكل دفعة بالكيلو' }
    }
    if (!Number.isFinite(bc) || bc <= 0) {
      return { ok: false, error: 'أدخل عدد شكاير أكبر من صفر لكل دفعة بالكيلو' }
    }

    const hasOpen = r.has_open_bag
    let openRem: number | null = null
    if (hasOpen) {
      const raw = r.open_kg_remaining === '' ? null : Number(r.open_kg_remaining)
      openRem = raw == null || !Number.isFinite(raw) ? (kgPerBag as number) : raw
      if (!Number.isFinite(openRem) || openRem <= 0) {
        return { ok: false, error: 'الكيلو المتبقي في الشكارة المفتوحة يجب أن يكون أكبر من صفر' }
      }
      if (openRem > (kgPerBag as number) + 0.0001) {
        return { ok: false, error: 'الكيلو المتبقي لا يتجاوز وزن الشكارة' }
      }
    }

    out.push({
      warehouse_id: wh,
      expiry_date: normExp(r.expiry_date)!,
      purchase_price: pp,
      selling_price: sp,
      bag_count: bc,
      kg_per_bag: kgPerBag as number,
      has_open_bag: hasOpen,
      open_kg_remaining: hasOpen ? openRem : null,
    })
  }

  return { ok: true, batches: out }
}

/** First duplicate pair in payload order: 0-based indices (i &gt; j). */
export function findFirstDuplicateBatchPair(batches: InitialBatchEntry[]): { i: number; j: number } | null {
  for (let i = 1; i < batches.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = batches[i]
      const b = batches[j]
      if (
        a.warehouse_id === b.warehouse_id &&
        (a.expiry_date ?? '') === (b.expiry_date ?? '') &&
        a.purchase_price === b.purchase_price
      ) {
        return { i, j }
      }
    }
  }
  return null
}

type WarehouseOption = { id: number; name_ar: string }

type Props = {
  unitType: 'piece' | 'bulk'
  warehouseOptions: WarehouseOption[]
  defaultWarehouseId: number | ''
  defaultPurchasePrice: number | ''
  defaultSellingPrice: number | ''
  defaultBagWeightKg: number | null
  rows: InitialBatchUiRow[]
  onRowsChange: (rows: InitialBatchUiRow[]) => void
  title?: string
  description?: string
}

export default function InitialProductBatchesEditor({
  unitType,
  warehouseOptions,
  defaultWarehouseId,
  defaultPurchasePrice,
  defaultSellingPrice,
  defaultBagWeightKg,
  rows,
  onRowsChange,
  title = 'دفعات المخزون الابتدائي',
  description = 'اختياري — دفعة لكل رصيد من مشتريات سابقة (صلاحية وسعر مختلفان). بدون دفعات يُنشأ المنتج برصيد صفر.',
}: Props) {
  const addRow = useCallback(() => {
    onRowsChange([
      ...rows,
      newInitialBatchRow({
        warehouse_id: defaultWarehouseId === '' ? (warehouseOptions[0]?.id ?? '') : defaultWarehouseId,
        purchase_price: defaultPurchasePrice,
        selling_price: defaultSellingPrice,
        bag_weight_kg: defaultBagWeightKg,
      }),
    ])
  }, [
    rows,
    onRowsChange,
    defaultWarehouseId,
    defaultPurchasePrice,
    defaultSellingPrice,
    defaultBagWeightKg,
    warehouseOptions,
  ])

  const updateRow = (key: string, patch: Partial<InitialBatchUiRow>) => {
    onRowsChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const removeRow = (key: string) => {
    onRowsChange(rows.filter((r) => r.key !== key))
  }

  if (warehouseOptions.length === 0) return null

  return (
    <div className="rounded-lg border border-dashed border-primary-300 dark:border-primary-700 p-3 space-y-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto space-y-3">
          {rows.map((r, idx) => (
            <div
              key={r.key}
              className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 space-y-2 bg-white/50 dark:bg-gray-900/30"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">دفعة #{idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removeRow(r.key)}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline"
                >
                  حذف
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-0.5">المخزن *</label>
                  <select
                    value={r.warehouse_id === '' ? '' : r.warehouse_id}
                    onChange={(e) =>
                      updateRow(r.key, {
                        warehouse_id: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
                  >
                    <option value="">— اختر —</option>
                    {warehouseOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name_ar}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-0.5">تاريخ الصلاحية *</label>
                  <input
                    type="month"
                    value={toMonthInputValue(r.expiry_date)}
                    onChange={(e) => updateRow(r.key, { expiry_date: fromMonthInputValue(e.target.value) ?? '' })}
                    className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-0.5">سعر الشراء *</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={r.purchase_price === '' ? '' : r.purchase_price}
                    onChange={(e) =>
                      updateRow(r.key, {
                        purchase_price: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-0.5">سعر البيع *</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={r.selling_price === '' ? '' : r.selling_price}
                    onChange={(e) =>
                      updateRow(r.key, {
                        selling_price: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
                  />
                </div>
              </div>

              {unitType === 'piece' ? (
                <div>
                  <label className="block text-xs font-medium mb-0.5">الكمية (وحدات) *</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={r.quantity === '' ? '' : r.quantity}
                    onChange={(e) =>
                      updateRow(r.key, {
                        quantity: e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))),
                      })
                    }
                    className="w-full max-w-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-0.5">عدد الشكاير *</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={r.bag_count === '' ? '' : r.bag_count}
                      onChange={(e) =>
                        updateRow(r.key, {
                          bag_count: e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))),
                        })
                      }
                      className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-0.5">وزن الشكارة (كجم)</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      placeholder={defaultBagWeightKg != null ? String(defaultBagWeightKg) : ''}
                      value={r.kg_per_bag === '' ? '' : r.kg_per_bag}
                      onChange={(e) =>
                        updateRow(r.key, {
                          kg_per_bag: e.target.value === '' ? '' : Number(e.target.value),
                        })
                      }
                      className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2 flex flex-wrap gap-3 items-center">
                    <span className="text-xs font-medium">شكارة مفتوحة؟</span>
                    <label className="inline-flex items-center gap-1 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={`open-${r.key}`}
                        checked={r.has_open_bag}
                        disabled={(r.bag_count === '' ? 0 : Number(r.bag_count)) <= 0}
                        onChange={() => updateRow(r.key, { has_open_bag: true })}
                      />
                      نعم
                    </label>
                    <label className="inline-flex items-center gap-1 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={`open-${r.key}`}
                        checked={!r.has_open_bag}
                        disabled={(r.bag_count === '' ? 0 : Number(r.bag_count)) <= 0}
                        onChange={() => updateRow(r.key, { has_open_bag: false, open_kg_remaining: '' })}
                      />
                      لا
                    </label>
                  </div>
                  {(r.bag_count === '' ? 0 : Number(r.bag_count)) > 0 && r.has_open_bag && (
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium mb-0.5">كيلو متبقي (المفتوحة) *</label>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        placeholder={
                          (r.kg_per_bag !== '' ? Number(r.kg_per_bag) : defaultBagWeightKg) != null
                            ? String(r.kg_per_bag !== '' ? r.kg_per_bag : defaultBagWeightKg)
                            : ''
                        }
                        value={r.open_kg_remaining === '' ? '' : r.open_kg_remaining}
                        onChange={(e) =>
                          updateRow(r.key, {
                            open_kg_remaining: e.target.value === '' ? '' : Number(e.target.value),
                          })
                        }
                        className="w-full max-w-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addRow}
        className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
      >
        + إضافة دفعة
      </button>
    </div>
  )
}
