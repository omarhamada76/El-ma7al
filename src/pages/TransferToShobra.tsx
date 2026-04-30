import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, ArrowLeft, Search, Package } from 'lucide-react'
import { getWarehouses } from '@/api/warehouses'
import { getProductsWithStockInWarehouse } from '@/api/products'
import { createInventoryTransfer, type CreateTransferBody } from '@/api/inventoryTransfers'
import { cn, formatNumber } from '@/lib/utils'
import FeedbackBanner from '@/components/FeedbackBanner'
import SuccessOverlay from '@/components/SuccessOverlay'
import type { Product } from '@/types/api'

interface TransferRow {
  product_id: number
  product_name: string
  available: number
  quantity: number
  unit_type?: 'piece' | 'bulk'
}

export default function TransferToShobra() {
  const queryClient = useQueryClient()
  const [items, setItems] = useState<TransferRow[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [celebrate, setCelebrate] = useState<{
    title: string
    subtitle?: string
    durationMs?: number
    then?: () => void
  } | null>(null)

  /* ─── Product search ─── */
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!searchOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [searchOpen])

  /* ─── Data queries ─── */
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses,
  })

  // Find اجهور (source) and شبرا (target) by name
  const sourceWarehouse = useMemo(
    () => warehouses.find((w) => /اجهور|أجهور|aghor/i.test(w.name_ar ?? w.name_en ?? '')),
    [warehouses]
  )
  const targetWarehouse = useMemo(
    () => warehouses.find((w) => /شبرا|shobra/i.test(w.name_ar ?? w.name_en ?? '')),
    [warehouses]
  )

  // Load products with stock directly from source warehouse (اجهور)
  const { data: warehouseProducts = [] } = useQuery({
    queryKey: ['warehouse-products-with-stock', sourceWarehouse?.id],
    queryFn: () => getProductsWithStockInWarehouse(sourceWarehouse!.id),
    enabled: !!sourceWarehouse,
  })

  // Build a stock lookup from the warehouse products data
  const stockMap = useMemo(() => {
    const map: Record<number, number> = {}
    for (const item of warehouseProducts) {
      map[item.product.id] = item.stock
    }
    return map
  }, [warehouseProducts])

  // Products that have stock in اجهور (already filtered by API)
  const productsWithStock = useMemo(
    () => warehouseProducts.filter((item) => item.stock > 0).map((item) => item.product),
    [warehouseProducts]
  )

  // Filter for search
  const searchNorm = searchQuery.trim().toLowerCase()
  const filteredProducts = useMemo(() => {
    const alreadyAdded = new Set(items.map((i) => i.product_id))
    const available = productsWithStock.filter((p) => !alreadyAdded.has(p.id))
    if (!searchNorm) return available
    return available.filter((p) => p.name.toLowerCase().includes(searchNorm))
  }, [productsWithStock, items, searchNorm])

  /* ─── Transfer mutation ─── */
  const transferMutation = useMutation({
    mutationFn: (body: CreateTransferBody) => createInventoryTransfer(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-batches'] })
      queryClient.invalidateQueries({ queryKey: ['product'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setCelebrate({
        title: 'تم تحويل البضاعة بنجاح',
        subtitle: `تم نقل ${items.length} صنف من اجهور إلى شبرا`,
        durationMs: 2000,
        then: () => {
          setItems([])
          setNotes('')
        },
      })
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ التحويل')
    },
  })

  /* ─── Handlers ─── */
  const addProduct = (product: Product) => {
    const stock = stockMap[product.id] ?? 0
    if (stock <= 0) return
    setItems((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_name: product.name,
        available: stock,
        quantity: 1,
        unit_type: product.unit_type,
      },
    ])
    setSearchOpen(false)
    setSearchQuery('')
  }

  const setQuantity = (index: number, qty: number) => {
    setItems((prev) => {
      const next = [...prev]
      const row = next[index]
      next[index] = { ...row, quantity: Math.max(0, Math.min(qty, row.available)) }
      return next
    })
  }

  const removeRow = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!sourceWarehouse || !targetWarehouse) {
      setError('لم يتم العثور على المخازن (اجهور / شبرا)')
      return
    }
    if (items.length === 0) {
      setError('أضف صنفاً واحداً على الأقل')
      return
    }
    for (const row of items) {
      if (row.quantity <= 0) {
        setError(`أدخل كمية صحيحة للمنتج «${row.product_name}»`)
        return
      }
      if (row.quantity > row.available) {
        setError(`الكمية المطلوبة للمنتج «${row.product_name}» أكبر من المتاح (${row.available})`)
        return
      }
    }

    transferMutation.mutate({
      from_warehouse_id: sourceWarehouse.id,
      to_warehouse_id: targetWarehouse.id,
      notes: notes.trim() || undefined,
      items: items.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
      })),
    })
  }

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0)

  /* ─── Loading / error states ─── */
  if (warehouses.length > 0 && (!sourceWarehouse || !targetWarehouse)) {
    return (
      <div className="space-y-6 w-full" dir="rtl">
        <h1 className="text-xl sm:text-2xl font-bold">تحويل بضاعه لشبرا</h1>
        <FeedbackBanner
          type="error"
          message="لم يتم العثور على مخازن «اجهور» و«شبرا». تأكد من إعدادات المخازن."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6 w-full" dir="rtl">
      <SuccessOverlay
        open={!!celebrate}
        title={celebrate?.title ?? ''}
        subtitle={celebrate?.subtitle}
        durationMs={celebrate?.durationMs ?? 2000}
        onComplete={() => {
          const next = celebrate?.then
          setCelebrate(null)
          next?.()
        }}
      />

      {/* ─── Header ─── */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">تحويل بضاعه لشبرا</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          نقل منتجات من مخزن <strong className="text-gray-700 dark:text-gray-200">اجهور</strong> إلى
          مخزن <strong className="text-gray-700 dark:text-gray-200">شبرا</strong>. اختر المنتجات وحدد
          الكمية لكل صنف.
        </p>
      </div>

      {/* ─── Direction indicator ─── */}
      <div className="flex items-center justify-center gap-4 py-4 px-6 rounded-xl bg-gradient-to-l from-blue-50 to-emerald-50 dark:from-blue-950/30 dark:to-emerald-950/30 border border-blue-100 dark:border-blue-900/50">
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
            <Package className="w-6 h-6" />
          </div>
          <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
            {sourceWarehouse?.name_ar ?? 'اجهور'}
          </span>
        </div>
        <div className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
          <ArrowLeft className="w-5 h-5" />
          <ArrowLeft className="w-5 h-5 -mr-3" />
          <ArrowLeft className="w-5 h-5 -mr-3" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
            <Package className="w-6 h-6" />
          </div>
          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
            {targetWarehouse?.name_ar ?? 'شبرا'}
          </span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <FeedbackBanner type="error" message={error} />}

        {/* ─── Add product button ─── */}
        <div className="relative" ref={searchRef}>
          <button
            type="button"
            onClick={() => {
              setSearchOpen(true)
              setTimeout(() => searchInputRef.current?.focus(), 50)
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-primary-300 dark:border-primary-700 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 font-medium transition-colors w-full justify-center"
          >
            <Plus className="w-5 h-5" />
            إضافة منتج للتحويل
          </button>

          {searchOpen && (
            <div className="absolute z-50 top-full start-0 end-0 mt-1 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 overflow-hidden">
              <div className="p-3 border-b border-gray-100 dark:border-gray-700">
                <div className="relative">
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="بحث عن منتج في مخزن اجهور..."
                    className="w-full py-2 ps-10 pe-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-sm focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
              <ul className="max-h-64 overflow-y-auto">
                {filteredProducts.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                    {searchNorm ? 'لا توجد نتائج' : 'لا توجد منتجات متاحة'}
                  </li>
                ) : (
                  filteredProducts.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => addProduct(p)}
                        className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                      >
                        <span className="font-medium text-right">{p.name}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0 ms-2">
                          متاح: {formatNumber(stockMap[p.id] ?? 0, p.unit_type === 'bulk' ? 2 : 0)}{' '}
                          {p.unit_type === 'bulk' ? 'كجم' : 'وحدة'}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>

        {/* ─── Items table ─── */}
        {items.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            {/* Desktop table */}
            <table className="hidden sm:table w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-right py-3 px-4 w-[40%]">المنتج</th>
                  <th className="text-right py-3 px-4 w-[20%]">المتاح في اجهور</th>
                  <th className="text-right py-3 px-4 w-[25%]">الكمية للتحويل</th>
                  <th className="w-14" />
                </tr>
              </thead>
              <tbody>
                {items.map((row, index) => (
                  <tr
                    key={row.product_id}
                    className="border-b border-gray-100 dark:border-gray-700 last:border-0"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                          <Package className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 break-words">{row.product_name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-gray-600 dark:text-gray-300">
                        {formatNumber(row.available, row.unit_type === 'bulk' ? 2 : 0)}{' '}
                        <span className="text-xs text-gray-400">
                          {row.unit_type === 'bulk' ? 'كجم' : 'وحدة'}
                        </span>
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={row.available}
                          step={row.unit_type === 'bulk' ? 0.1 : 1}
                          value={row.quantity === 0 ? '' : row.quantity}
                          onChange={(e) => setQuantity(index, Number(e.target.value) || 0)}
                          className={cn(
                            'w-24 px-3 py-2 rounded-lg border text-sm font-medium',
                            'bg-white dark:bg-gray-900',
                            row.quantity > row.available
                              ? 'border-red-400 dark:border-red-600 focus:ring-red-500'
                              : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500',
                            'focus:ring-2'
                          )}
                        />
                        {row.quantity > 0 && (
                          <span className="text-xs text-gray-400">
                            ({Math.round((row.quantity / row.available) * 100)}%)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        aria-label="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {items.map((row, index) => (
                <div key={row.product_id} className="p-4 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
                        <Package className="h-4 w-4" />
                      </span>
                      <span className="font-bold text-sm break-words">{row.product_name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      className="p-2 text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">
                        المتاح
                      </label>
                      <span className="text-sm font-semibold">
                        {formatNumber(row.available, row.unit_type === 'bulk' ? 2 : 0)}{' '}
                        {row.unit_type === 'bulk' ? 'كجم' : 'وحدة'}
                      </span>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">
                        الكمية للتحويل
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={row.available}
                        step={row.unit_type === 'bulk' ? 0.1 : 1}
                        value={row.quantity === 0 ? '' : row.quantity}
                        onChange={(e) => setQuantity(index, Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 font-bold"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-primary-50 dark:bg-primary-950/20 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                إجمالي الأصناف: {items.length}
              </span>
              <span className="text-sm font-bold text-primary-600 dark:text-primary-400">
                إجمالي الوحدات: {formatNumber(totalItems, 0)}
              </span>
            </div>
          </div>
        )}

        {/* ─── Notes ─── */}
        <div>
          <label className="text-sm font-medium mb-1 block">ملاحظات (اختياري)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="أي ملاحظات عن هذا التحويل..."
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm resize-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* ─── Submit ─── */}
        <button
          type="submit"
          disabled={items.length === 0 || transferMutation.isPending}
          className={cn(
            'w-full py-3 rounded-xl font-bold text-white transition-all',
            items.length === 0
              ? 'bg-gray-300 dark:bg-gray-700 cursor-not-allowed'
              : 'bg-gradient-to-l from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 shadow-lg hover:shadow-xl active:scale-[0.98]',
            transferMutation.isPending && 'opacity-60 pointer-events-none'
          )}
        >
          {transferMutation.isPending ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              جاري التحويل…
            </span>
          ) : (
            `تنفيذ التحويل — ${items.length} صنف`
          )}
        </button>
      </form>
    </div>
  )
}
