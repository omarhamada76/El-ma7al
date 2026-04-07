import { useState, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Pencil, Trash2 } from 'lucide-react'
import { getProduct, getProductStock, getProductBatches, getProductBags, deleteProduct } from '@/api/products'
import { getWarehouses } from '@/api/warehouses'
import { getCategoryOptions } from '@/api/categories'
import { formatCurrency } from '@/lib/utils'
import ProductLabelPrint from '@/components/ProductLabelPrint'
import type { ProductBatch, BagInstance } from '@/types/api'
import EditProductModal from '@/components/EditProductModal'
import SetProductStockModal from '@/components/SetProductStockModal'
import { useAuthStore } from '@/stores/auth'
import { canManageProductBatches } from '@/lib/roles'

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [stockEdit, setStockEdit] = useState<{
    warehouseId: number
    warehouseName: string
    currentQuantity: number
  } | null>(null)
  const [printBatch, setPrintBatch] = useState<ProductBatch | null>(null)
  const [printBag, setPrintBag] = useState<BagInstance | null>(null)
  const [labelCount, setLabelCount] = useState(1)
  const role = useAuthStore((s) => s.user?.role)
  const canEditBatches = canManageProductBatches(role)
  const isSuperAdmin = role === 'super_admin'
  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => getProduct(id!),
    enabled: !!id && id !== 'new',
  })
  const { data: stock = [] } = useQuery({
    queryKey: ['product', id, 'stock'],
    queryFn: () => getProductStock(id!),
    enabled: !!id && id !== 'new',
  })
  const { data: bags = [] } = useQuery({
    queryKey: ['product', id, 'bags'],
    queryFn: () => getProductBags(id!),
    enabled: !!id && id !== 'new' && product?.unit_type === 'bulk',
  })
  const { data: batches = [] } = useQuery({
    queryKey: ['product', id, 'batches'],
    queryFn: () => getProductBatches(id!),
    enabled: !!id && id !== 'new',
  })
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses,
  })
  const { data: categoryOptions = [] } = useQuery({
    queryKey: ['categories', 'options'],
    queryFn: getCategoryOptions,
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteProduct(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products', 'warehouse'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-batches'] })
      queryClient.invalidateQueries({ queryKey: ['product'] })
      navigate('/inventory')
    },
  })
  const handleDelete = () => {
    if (window.confirm('هل أنت متأكد من حذف هذا المنتج؟')) deleteMutation.mutate()
  }

  // Total quantity across all batches
  const totalBatchQty = useMemo(
    () => batches.reduce((sum, b) => sum + (b.unit_type === 'bulk' ? (b.kg_remaining ?? 0) : (b.quantity ?? 0)), 0),
    [batches]
  )

  // Detect expired batches
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const warehouseNames = useMemo(
    () => Object.fromEntries(warehouses.map((w) => [w.id, w.name_ar])),
    [warehouses]
  )

  const bulkWarehouseCards = useMemo(() => {
    if (product?.unit_type !== 'bulk') return []
    const byWh = new Map<number, BagInstance[]>()
    for (const b of bags) {
      const arr = byWh.get(b.warehouse_id) ?? []
      arr.push(b)
      byWh.set(b.warehouse_id, arr)
    }
    const out: {
      whId: number
      whName: string
      open: BagInstance | undefined
      sealedCount: number
      totalKg: number
    }[] = []
    for (const [whId, list] of byWh) {
      const active = list.filter((x) => x.status !== 'empty')
      if (active.length === 0) continue
      const open = active.find((x) => x.status === 'open')
      const sealedCount = active.filter((x) => x.status === 'sealed').length
      const totalKg = active.reduce((s, x) => s + x.kg_remaining, 0)
      out.push({
        whId,
        whName: warehouseNames[whId] ?? `مخزن ${whId}`,
        open,
        sealedCount,
        totalKg,
      })
    }
    return out
  }, [bags, product?.unit_type, warehouseNames])

  if (!id || id === 'new') {
    return (
      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
        نموذج إضافة منتج جديد يمكن إضافته هنا.
      </div>
    )
  }

  if (isLoading || !product)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    )

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 min-w-0">
          <Link to="/inventory" className="hover:underline shrink-0">
            المخزون
          </Link>
          <ArrowRight className="w-4 h-4 shrink-0" />
          <span className="text-gray-900 dark:text-gray-100 font-medium truncate">
            {product.name}
          </span>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
          >
            <Pencil className="w-4 h-4" />
            تعديل
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            حذف
          </button>
        </div>
      </div>
      <EditProductModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        product={product}
        categoryOptions={categoryOptions}
        warehouseOptions={warehouses.map((w) => ({ id: w.id, name_ar: w.name_ar }))}
        canManageBatches={canEditBatches}
        isSuperAdmin={isSuperAdmin}
        onProductSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['product', id] })
        }}
      />
      <h1 className="text-xl sm:text-2xl font-bold">{product.name}</h1>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">سعر الشراء</p>
          <p className="text-xl font-bold mt-1">{formatCurrency(product.purchase_price)}</p>
        </div>
        <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">سعر البيع</p>
          <p className="text-xl font-bold mt-1">{formatCurrency(product.selling_price)}</p>
        </div>
        <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">الفئة</p>
          <p className="text-xl font-bold mt-1">{product.category ?? '—'}</p>
        </div>
      </div>

      {product.unit_type === 'bulk' && bulkWarehouseCards.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">الشكارة الحالية</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {bulkWarehouseCards.map((c) => {
              const b = c.open
              const pct =
                b && b.kg_total > 0 ? Math.min(100, Math.round((b.kg_remaining / b.kg_total) * 100)) : 0
              const barColor =
                pct > 50 ? 'bg-emerald-500' : pct >= 20 ? 'bg-amber-500' : 'bg-red-500'
              return (
                <div
                  key={c.whId}
                  className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      {b ? '🟢 الشكارة المفتوحة' : '⚪ لا توجد شكارة مفتوحة'} — {c.whName}
                    </span>
                  </div>
                  {b ? (
                    <>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-600 dark:text-gray-400">متبقي</span>
                          <span className="font-bold tabular-nums">
                            {b.kg_remaining.toFixed(2)} كيلو ({pct}% من {b.kg_total.toFixed(1)} كيلو)
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        الصلاحية: {b.expiry_date ?? '—'} · دفعة #{b.batch_id}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">جميع الشكاير مغلقة — يُفتح أول بيع من الدفعة الأقرب للانتهاء.</p>
                  )}
                  <p className="text-sm border-t border-gray-100 dark:border-gray-700 pt-2">
                    في الانتظار: <strong>{c.sealedCount}</strong> شكارة مغلقة · إجمالي المخزون في المخزن:{' '}
                    <strong>{c.totalKg.toFixed(2)} كيلو</strong>
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">ملصقات الباركود الداخلية</h2>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            ملصقات الطابعة الحرارية (58مم) تحمل فقط رمز النظام: <strong className="text-gray-900 dark:text-gray-100">B</strong> لدفعة
            القطعة أو <strong className="text-gray-900 dark:text-gray-100">G</strong> لشكارة البيع بالكيلو — للمسح عند إصدار الفاتورة.
          </p>
          <p>
            باركود المورد/العلبة مسجّل في بطاقة المنتج أدناه ويُستخدم عند الاستلام من المورد، ولا يُطبع على هذه الملصقات.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            لطباعة ملصق: افتح «طباعة ملصق» من صف الدفعة (منتج بالقطعة) أو «طباعة ملصق شكارة» من بطاقة الشكارة (بالكيلو).
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">المخزون حسب المخزن</h2>
        {stock.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 p-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
            لا يوجد مخزون مسجّل. استلم من مورد أو قم بتعديل يدوي.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {stock.map((s) => (
              <li
                key={`${s.product_id}-${s.warehouse_id}`}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center gap-2"
              >
                <span className="font-medium">
                  {warehouseNames[s.warehouse_id] ?? `مخزن ${s.warehouse_id}`}
                </span>
                : <span className="font-bold">{product?.unit_type === 'bulk' ? `${s.quantity.toFixed(2)} كجم` : s.quantity}</span>
                <button
                  type="button"
                  onClick={() =>
                    setStockEdit({
                      warehouseId: s.warehouse_id,
                      warehouseName: warehouseNames[s.warehouse_id] ?? `مخزن ${s.warehouse_id}`,
                      currentQuantity: s.quantity,
                    })
                  }
                  className="text-primary-600 dark:text-primary-400 hover:underline text-sm font-medium"
                >
                  تعديل
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

            {product.unit_type === 'bulk' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">تتبع الشكاير (حسب المخزن وتاريخ الصلاحية)</h2>
          </div>
          {bags.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 p-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
              لا توجد شكاير مسجلة لهذا المنتج.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bags.map(b => (
                <div key={b.id} className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <span className="font-bold text-lg text-primary-600">شكارة #{b.bag_number}</span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${b.status === 'open' ? 'bg-orange-100 text-orange-800' : b.status === 'empty' ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-800'}`}>
                      {b.status === 'open' ? 'مفتوحة' : b.status === 'empty' ? 'فارغة' : 'مغلقة'}
                    </span>
                  </div>
                  <div className="text-sm">المخزن: {b.warehouse_name_ar || `مخزن ${b.warehouse_id}`}</div>
                  <div className="text-sm">الصلاحية: {b.expiry_date || 'غير محدد'}</div>
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                    <div className="bg-primary-600 h-2.5 rounded-full" style={{ width: `${Math.max(0, Math.min(100, (b.kg_remaining / b.kg_total) * 100))}%`}}></div>
                  </div>
                  <div className="text-xs text-center text-gray-500 mt-1">{b.kg_remaining} من {b.kg_total} كجم متبقي</div>
                  {b.opened_at && <div className="text-xs text-gray-400 mt-1">فُتحت في: {new Date(b.opened_at).toLocaleDateString('ar-EG')}</div>}
                  <button
                    type="button"
                    onClick={() => { setPrintBag(b); setLabelCount(1) }}
                    className="mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    طباعة ملصق شكارة
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Batches Section ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">الدُفعات (حسب تاريخ الصلاحية)</h2>
          {batches.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-sm font-medium">
              إجمالي المخزون: {product?.unit_type === 'bulk' ? `${totalBatchQty.toFixed(2)} كجم` : `${totalBatchQty} وحدة`}
            </span>
          )}
        </div>
        {batches.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 p-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
            لا توجد دُفعات. عند استلام بضاعة بتاريخ صلاحية يتم إنشاء دُفعة تلقائياً.
          </p>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-right py-2 px-3">المخزن</th>
                  <th className="text-right py-2 px-3">تاريخ الصلاحية</th>
                  <th className="text-right py-2 px-3">
                    {product?.unit_type === 'bulk' ? 'الوزن' : 'الكمية'}
                  </th>
                  <th className="text-right py-2 px-3">سعر الشراء</th>
                  <th className="text-right py-2 px-3">سعر البيع</th>
                  <th className="py-2 px-3 w-28" />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const isExpired =
                    b.expiry_date &&
                    b.expiry_date !== '9999-12-31' &&
                    b.expiry_date < todayStr
                  const isSentinel = !b.expiry_date || b.expiry_date === '9999-12-31'
                  return (
                    <tr
                      key={b.id}
                      className={`border-b border-gray-100 dark:border-gray-700 last:border-0 ${
                        isExpired
                          ? 'bg-red-50 dark:bg-red-900/10'
                          : ''
                      }`}
                    >
                      <td className="py-2 px-3">
                        {b.warehouse_name_ar ?? warehouseNames[b.warehouse_id] ?? `مخزن ${b.warehouse_id}`}
                      </td>
                      <td className="py-2 px-3">
                        {isSentinel ? (
                          <span className="text-gray-400">بدون تاريخ</span>
                        ) : (
                          <span
                            className={
                              isExpired
                                ? 'text-red-600 dark:text-red-400 font-medium'
                                : ''
                            }
                          >
                            {b.expiry_date}
                            {isExpired && (
                              <span className="mr-1 text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded-full">
                                منتهي
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-medium">{b.quantity}</td>
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-400">
                        {b.purchase_price != null ? formatCurrency(b.purchase_price) : '—'}
                      </td>
                      <td className="py-2 px-3">
                        {b.selling_price != null && b.selling_price > 0 ? (
                          formatCurrency(b.selling_price)
                        ) : (
                          <span className="text-amber-600">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        {product.unit_type !== 'bulk' ? (
                          <button
                            type="button"
                            onClick={() => { setPrintBatch(b); setLabelCount(b.quantity ?? 1) }}
                            className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            طباعة ملصق
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">استخدم ملصق الشكارة</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Print Modal ─────────────────────────────────────────── */}
      {printBatch && product && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPrintBatch(null)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">ملصق الدُفعة (باركود B)</h3>
              <button type="button" onClick={() => setPrintBatch(null)} className="p-2 -m-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">×</button>
            </div>

            {/* Batch info summary */}
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <p className="text-gray-500 dark:text-gray-400 text-xs">المخزن</p>
                <p className="font-medium">{printBatch.warehouse_name_ar ?? warehouseNames[printBatch.warehouse_id] ?? `مخزن ${printBatch.warehouse_id}`}</p>
              </div>
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <p className="text-gray-500 dark:text-gray-400 text-xs">تاريخ الصلاحية</p>
                <p className="font-medium">
                  {!printBatch.expiry_date || printBatch.expiry_date === '9999-12-31' ? 'بدون تاريخ' : printBatch.expiry_date}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <p className="text-gray-500 dark:text-gray-400 text-xs">سعر الشراء</p>
                <p className="font-medium">{printBatch.purchase_price != null ? formatCurrency(printBatch.purchase_price) : '—'}</p>
              </div>
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <p className="text-gray-500 dark:text-gray-400 text-xs">سعر البيع</p>
                <p className="font-medium">{printBatch.selling_price != null ? formatCurrency(printBatch.selling_price) : '—'}</p>
              </div>
            </div>

            {/* Quantity selector */}
            <div className="mb-4 no-print">
              <label className="block text-sm font-medium mb-1">عدد الملصقات</label>
              <input
                type="number"
                min={1}
                max={200}
                value={labelCount}
                onChange={(e) => setLabelCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">الافتراضي = كمية الدُفعة ({printBatch.quantity})</p>
            </div>

            <ProductLabelPrint product={product} batch={printBatch} labelCount={labelCount} />
          </div>
        </div>
      )}
      {printBag && product && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPrintBag(null)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">ملصق الشكارة (باركود G)</h3>
              <button type="button" onClick={() => setPrintBag(null)} className="p-2 -m-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <p className="text-gray-500 dark:text-gray-400 text-xs">رقم الشكارة</p>
                <p className="font-medium">#{printBag.bag_number}</p>
              </div>
              <div className="p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <p className="text-gray-500 dark:text-gray-400 text-xs">الوزن الكلي</p>
                <p className="font-medium">{printBag.kg_total} كجم</p>
              </div>
            </div>
            <ProductLabelPrint product={product} bag={printBag} labelCount={labelCount} />
          </div>
        </div>
      )}
      {stockEdit && id && (
        <SetProductStockModal
          open={!!stockEdit}
          onClose={() => setStockEdit(null)}
          productId={Number(id)}
          productName={product.name}
          warehouseId={stockEdit.warehouseId}
          warehouseName={stockEdit.warehouseName}
          currentQuantity={stockEdit.currentQuantity}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['product', id, 'stock'] })
            queryClient.invalidateQueries({ queryKey: ['warehouse-stock', stockEdit.warehouseId] })
          }}
        />
      )}
    </div>
  )
}
