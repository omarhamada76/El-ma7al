import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Package, Search, ArrowLeft, Pencil, Trash2, ChevronRight, ChevronLeft, FileText } from 'lucide-react'
import { getProducts, createProduct, updateProduct, deleteProduct, getWarehouseStockMap } from '@/api/products'
import type { Product } from '@/types/api'
import { getWarehouses } from '@/api/warehouses'
import { getCategoryOptions, createCategory } from '@/api/categories'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'
import AddProductModal from '@/components/AddProductModal'
import AddCategoryModal from '@/components/AddCategoryModal'
import ContextMenu from '@/components/ContextMenu'
import SetProductStockModal from '@/components/SetProductStockModal'
import EditProductModal from '@/components/EditProductModal'
import FeedbackBanner from '@/components/FeedbackBanner'
import SuccessOverlay from '@/components/SuccessOverlay'
import { useAuthStore } from '@/stores/auth'
import { canManageProductBatches } from '@/lib/roles'

const LAST_WAREHOUSE_KEY = 'vet-pharmacy-inventory-warehouse'

/** Exactly one list filter at a time; `low_stock` may come from `?lowStock=1`. */
type InventoryListFilter = 'all' | 'low_stock' | 'unpriced' | 'expiring'

function getLastWarehouseId(): string {
  if (typeof window === 'undefined') return ''
  try {
    const saved = localStorage.getItem(LAST_WAREHOUSE_KEY)
    return saved ?? ''
  } catch {
    return ''
  }
}

export default function Inventory() {
  const role = useAuthStore((s) => s.user?.role)
  const canEditBatches = canManageProductBatches(role)
  const isSuperAdmin = role === 'super_admin'
  const [search, setSearch] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [inventoryCelebrate, setInventoryCelebrate] = useState<{ title: string; subtitle?: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; product: Product } | null>(null)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [warehouseId, setWarehouseId] = useState<number | undefined>(() => {
    const saved = getLastWarehouseId()
    if (saved) {
      const n = Number(saved)
      if (Number.isInteger(n)) return n
    }
    return 1
  })


  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [searchParams, setSearchParams] = useSearchParams()
  const [lowStockMode, setLowStockMode] = useState(() => searchParams.get('lowStock') === '1')
  const listFilter = useMemo((): InventoryListFilter => {
    if (searchParams.get('expiring') === '1') return 'expiring'
    if (searchParams.get('unpriced') === '1') return 'unpriced'
    if (searchParams.get('lowStock') === '1' || lowStockMode) return 'low_stock'
    return 'all'
  }, [searchParams, lowStockMode])
  const applyListFilter = useCallback(
    (next: InventoryListFilter) => {
      if (next === 'low_stock') {
        setLowStockMode(true)
        setSearchParams(
          (prev) => {
            const p = new URLSearchParams(prev)
            p.set('lowStock', '1')
            p.delete('unpriced')
            p.delete('expiring')
            return p
          },
          { replace: true }
        )
        return
      }
      setLowStockMode(false)
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.delete('lowStock')
          if (next === 'unpriced') {
            p.set('unpriced', '1')
            p.delete('expiring')
          } else if (next === 'expiring') {
            p.set('expiring', '1')
            p.delete('unpriced')
          } else {
            p.delete('unpriced')
            p.delete('expiring')
          }
          return p
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )
  useEffect(() => {
    if (searchParams.get('expiring') === '1' || searchParams.get('unpriced') === '1') {
      setLowStockMode(false)
    }
    if (searchParams.get('lowStock') === '1') {
      setLowStockMode(true)
    }
  }, [searchParams])
  const [addOpen, setAddOpen] = useState(false)
  const [addCategoryOpen, setAddCategoryOpen] = useState(false)
  const [stockEdit, setStockEdit] = useState<{
    product: Product
    warehouseId: number
    warehouseName: string
    currentQuantity: number
  } | null>(null)
  const queryClient = useQueryClient()
  const createMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      queryClient.invalidateQueries({ queryKey: ['product'] })
      if (data?.id != null) {
        queryClient.invalidateQueries({ queryKey: ['product', String(data.id)] })
        queryClient.invalidateQueries({ queryKey: ['product', String(data.id), 'stock'] })
        queryClient.invalidateQueries({ queryKey: ['product', String(data.id), 'batches'] })
      }
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateProduct>[1] }) => updateProduct(String(id), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      setEditProduct(null)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteProduct(String(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      setContextMenu(null)
      setInventoryCelebrate({ title: 'تم حذف المنتج بنجاح' })
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر حذف المنتج')
    },
  })
  const createCategoryMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setCategory(data.name_ar)
      setAddCategoryOpen(false)
      setInventoryCelebrate({ title: 'تم إضافة التصنيف بنجاح' })
    },
  })
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses,
  })
  const { data: categoryOptions = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategoryOptions,
  })


  const limit = 50
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['products', search, warehouseId, category, listFilter, page],
    queryFn: () =>
      getProducts({
        search: search || undefined,
        warehouse_id: warehouseId,
        category: category || undefined,
        ...(listFilter === 'expiring'
          ? { expiring: true }
          : listFilter === 'unpriced'
            ? { unpriced: true }
            : listFilter === 'low_stock'
              ? { low_stock: true }
              : {}),
        limit,
        page,
      }),
    placeholderData: keepPreviousData,
  })
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))
  useEffect(() => {
    setPage(1)
  }, [search, category, listFilter])
  useEffect(() => {
    if (searchParams.get('add') !== '1') return
    setAddOpen(true)
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.delete('add')
        return p
      },
      { replace: true }
    )
  }, [searchParams, setSearchParams])
  useEffect(() => {
    if (data !== undefined && totalPages > 0 && page > totalPages) {
      setPage(totalPages)
    }
  }, [totalPages, page, data])

  const products = data?.data ?? []
  const [editPriceId, setEditPriceId] = useState<number | null>(null)
  const [editPurchasePriceVal, setEditPurchasePriceVal] = useState('')
  const [editSellingPriceVal, setEditSellingPriceVal] = useState('')
  /** Captured when saving inline prices; reapplied after refetch so <main> scroll does not jump to top. */
  const restoreInventoryScrollY = useRef<number | null>(null)
  /**
   * Inline prices: PATCH /products/:id → server `updateProduct` → `products.purchase_price` / `products.selling_price`
   * (SQLite `server/db.js` or Postgres `server/pgdb.js`). List refetch keeps UI aligned with DB.
   */
  const priceMutation = useMutation({
    mutationFn: ({
      id,
      purchase_price,
      selling_price,
    }: {
      id: number
      purchase_price: number
      selling_price: number
    }) => updateProduct(String(id), { purchase_price, selling_price }),
    onSuccess: async (updated: Product, { id }) => {
      queryClient.setQueriesData({ queryKey: ['products'] }, (old: unknown) => {
        if (!old || typeof old !== 'object' || !('data' in old)) return old
        const rec = old as { data: Product[]; total: number }
        if (!Array.isArray(rec.data)) return old
        return {
          ...rec,
          data: rec.data.map((row) => (row.id === id ? { ...row, ...updated } : row)),
        }
      })
      await queryClient.invalidateQueries({ queryKey: ['products'] })
      await queryClient.invalidateQueries({ queryKey: ['product', String(id)] })
      setEditPriceId(null)
      setInventoryCelebrate({ title: 'تم حفظ الأسعار بنجاح' })
    },
    onError: (err) => {
      restoreInventoryScrollY.current = null
      setErrorMessage(err instanceof Error ? err.message : 'تعذر حفظ الأسعار')
    },
  })

  useLayoutEffect(() => {
    const y = restoreInventoryScrollY.current
    if (y == null) return
    const main = document.querySelector('main')
    if (!(main instanceof HTMLElement)) {
      restoreInventoryScrollY.current = null
      return
    }
    main.scrollTop = y
    restoreInventoryScrollY.current = null
  }, [data])

  useEffect(() => {
    if (!errorMessage) return
    const t = window.setTimeout(() => setErrorMessage(null), 4500)
    return () => window.clearTimeout(t)
  }, [errorMessage])

  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)

  return (
    <div className="space-y-6" dir="rtl">
      <SuccessOverlay
        open={!!inventoryCelebrate}
        title={inventoryCelebrate?.title ?? ''}
        subtitle={inventoryCelebrate?.subtitle}
        durationMs={1500}
        onComplete={() => setInventoryCelebrate(null)}
      />
      {errorMessage && <FeedbackBanner type="error" message={errorMessage} />}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">المخزون</h1>
        <div className="flex gap-2">
          {products.length > 0 && (
            <button
              type="button"
              disabled={isGeneratingPdf}
              onClick={async () => {
                setIsGeneratingPdf(true)
                try {
                  const { createInventoryPdfBlob } = await import('@/lib/inventoryPdf')
                  let title = 'تقرير المخزون'
                  if (listFilter === 'low_stock') title = 'تقرير نواقص المخزون'
                  else if (listFilter === 'unpriced') title = 'تقرير منتجات بدون سعر'
                  else if (listFilter === 'expiring') title = 'تقرير منتجات قاربت على الانتهاء'

                  const dateStr = new Date().toLocaleDateString('ar-EG', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })

                  const blob = await createInventoryPdfBlob(products, title, {
                    warehouseName: warehouses.find((w) => w.id === warehouseId)?.name_ar,
                    warehouseStockMap: Object.fromEntries(
                      products.map((p) => [p.id, p.warehouse_stock ?? p.batch_total_quantity ?? 0])
                    ),
                  })

                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${title}-${dateStr}.pdf`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                  
                  setInventoryCelebrate({ title: 'تم إنشاء ملف PDF بنجاح' })
                } catch (err) {
                  setErrorMessage('فشل إنشاء ملف PDF')
                  console.error(err)
                } finally {
                  setIsGeneratingPdf(false)
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium disabled:opacity-50"
            >
              {isGeneratingPdf ? (
                <div className="w-4 h-4 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              تصدير PDF
            </button>
          )}

          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
          >
            <Plus className="w-4 h-4" />
            إضافة منتج
          </button>

          <AddProductModal
            open={addOpen}
            onClose={() => setAddOpen(false)}
            categoryOptions={categoryOptions}
            warehouseOptions={warehouses.map((w) => ({ id: w.id, name_ar: w.name_ar }))}
            onSubmit={async (d) => {
              await createMutation.mutateAsync({
                name: d.name,
                company: d.company || null,
                category: d.category || null,
                purchase_price: d.purchase_price,
                selling_price: d.selling_price,
                alert_level: d.alert_level,
                alert_level_kg: d.alert_level_kg ?? null,
                barcode: d.barcode || null,
                notes: d.notes || null,
                image_url: d.image_url ?? null,
                unit_type: d.unit_type,
                bag_weight_kg: d.bag_weight_kg ?? null,
                initial_batches: d.initial_batches ?? [],
                warehouse_id: d.warehouse_id,
              })
              setInventoryCelebrate({ title: 'تم إضافة المنتج بنجاح' })
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الفئة..."
            className="w-full py-2 ps-12 pe-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
          />
        </div>
        <select
          value={warehouseId ?? ''}
          onChange={(e) => {
            const val = e.target.value
            const id = val ? Number(val) : undefined
            setWarehouseId(id)
            try {
              if (val) localStorage.setItem(LAST_WAREHOUSE_KEY, val)
              else localStorage.removeItem(LAST_WAREHOUSE_KEY)
            } catch { /* ignore */ }
          }}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
        >
          <option value="">جميع المخازن</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name_ar}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
          >
            <option value="">جميع الفئات</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAddCategoryOpen(true)}
            className="shrink-0 px-3 py-2 rounded-lg border border-primary-500 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 text-sm font-medium"
          >
            + إضافة فئة
          </button>
        </div>
        <AddCategoryModal
          open={addCategoryOpen}
          onClose={() => setAddCategoryOpen(false)}
          onSubmit={async (name_ar) => {
            await createCategoryMutation.mutateAsync(name_ar)
          }}
        />
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={listFilter === 'low_stock'}
            onChange={(e) => applyListFilter(e.target.checked ? 'low_stock' : 'all')}
            className="rounded border-gray-300 text-primary-600"
          />
          <span className="text-sm">منخفض المخزون</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={listFilter === 'unpriced'}
            onChange={(e) => applyListFilter(e.target.checked ? 'unpriced' : 'all')}
            className="rounded border-gray-300 text-amber-600"
          />
          <span className="text-sm">بدون سعر بيع</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={listFilter === 'expiring'}
            onChange={(e) => applyListFilter(e.target.checked ? 'expiring' : 'all')}
            className="rounded border-gray-300 text-rose-600"
          />
          <span className="text-sm">قاربت على الانتهاء</span>
        </label>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-14 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
              />
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="p-8 text-center text-gray-500 dark:text-gray-400">
            لا توجد منتجات. أضف منتجاً أو سجّل استلاماً من مورد.
          </p>
        ) : (
          <div className={cn("responsive-table-container transition-opacity duration-200", isFetching && "opacity-50 pointer-events-none")}>
            <table className="responsive-table">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="text-right py-3 px-4">المنتج</th>
                  <th className="text-right py-3 px-4 hidden sm:table-cell">الفئة</th>
                  <th
                    className={cn(
                      'text-right py-3 px-4',
                      editPriceId != null ? 'table-cell' : 'hidden md:table-cell'
                    )}
                  >
                    سعر الشراء
                  </th>
                  <th className="text-right py-3 px-4">سعر البيع</th>
                  <th className="text-right py-3 px-4">المخزون</th>
                  <th className="text-right py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  // Price range helpers
                  const ppMin = p.purchase_price_min
                  const ppMax = p.purchase_price_max
                  const hasBatchPP = ppMin != null && ppMax != null
                  const ppIsSingle = hasBatchPP && ppMin === ppMax
                  const spMin = p.selling_price_min
                  const spMax = p.selling_price_max
                  const hasBatchSP = spMin != null && spMax != null
                  const spIsSingle = hasBatchSP && spMin === spMax
                  /** Inline PATCH only updates `products.*`; ranges block quick edit (use product detail for batches). */
                  const batchRangePreventsInline =
                    (hasBatchPP && !ppIsSingle) || (hasBatchSP && !spIsSingle)
                  // Stock: use batch_total_quantity when available, else warehouse map
                  const batchQty = p.batch_total_quantity ?? null
                  /** Same pattern as «سعر الشراء»: batch min/max when present, else product default or «تحديد السعر». */
                  const sellingPriceCellContent = hasBatchSP ? (
                    spIsSingle ? (
                      formatCurrency(spMin!)
                    ) : (
                      <span>
                        {formatCurrency(spMin!)} — {formatCurrency(spMax!)}
                      </span>
                    )
                  ) : p.selling_price > 0 ? (
                    formatCurrency(p.selling_price)
                  ) : (
                    <span className="text-amber-600">تحديد السعر</span>
                  )
                  return (
                  <tr
                    key={p.id}
                    className={cn(
                      'border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30',
                      /* Top-align row while editing so price cells line up (align-middle vs uneven cell heights skews inputs) */
                      editPriceId === p.id && '[&>td]:!align-top'
                    )}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, product: p })
                    }}
                  >
                    <td className="py-2 px-4">
                      <div className="flex items-center gap-2 font-medium">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-9 w-9 shrink-0 rounded object-cover border border-gray-200 dark:border-gray-600"
                          />
                        ) : (
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 text-gray-400"
                            aria-hidden
                          >
                            <Package className="h-4 w-4" />
                          </span>
                        )}
                        <span className="min-w-0 break-words">{p.name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-4 text-gray-500 dark:text-gray-400 hidden sm:table-cell">
                      {p.category ?? '—'}
                    </td>
                    <td
                      className={cn(
                        'py-2 px-4 align-middle',
                        editPriceId != null ? 'table-cell' : 'hidden md:table-cell'
                      )}
                    >
                      {editPriceId === p.id ? (
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={editPurchasePriceVal}
                          onChange={(e) => setEditPurchasePriceVal(e.target.value)}
                          autoFocus
                          placeholder="شراء"
                          inputMode="decimal"
                          className="h-9 w-full min-w-[4.5rem] max-w-[6.5rem] rounded-md border border-gray-300 bg-white px-2 text-sm box-border dark:border-gray-600 dark:bg-gray-800"
                        />
                      ) : hasBatchPP ? (
                        ppIsSingle
                          ? formatCurrency(ppMin)
                          : <span>{formatCurrency(ppMin)} — {formatCurrency(ppMax)}</span>
                      ) : (
                        formatCurrency(p.purchase_price)
                      )}
                    </td>
                    <td className="py-2 px-4 align-middle">
                      {editPriceId === p.id ? (
                        <form
                          className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1.5"
                          onSubmit={(e) => {
                            e.preventDefault()
                            const purchase = parseFloat(editPurchasePriceVal)
                            const selling = parseFloat(editSellingPriceVal)
                            if (!isNaN(purchase) && purchase >= 0 && !isNaN(selling) && selling >= 0) {
                              const main = document.querySelector('main')
                              if (main instanceof HTMLElement) {
                                restoreInventoryScrollY.current = main.scrollTop
                              }
                              priceMutation.mutate({
                                id: p.id,
                                purchase_price: purchase,
                                selling_price: selling,
                              })
                            }
                          }}
                        >
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={editSellingPriceVal}
                            onChange={(e) => setEditSellingPriceVal(e.target.value)}
                            placeholder="بيع"
                            inputMode="decimal"
                            className="h-9 min-w-[4.5rem] max-w-[6.5rem] flex-1 rounded-md border border-gray-300 bg-white px-2 text-sm box-border dark:border-gray-600 dark:bg-gray-800 sm:w-20 sm:flex-none sm:max-w-none"
                          />
                          <button
                            type="submit"
                            disabled={priceMutation.isPending}
                            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:pointer-events-none disabled:opacity-60 dark:bg-primary-500 dark:hover:bg-primary-400"
                          >
                            {priceMutation.isPending ? '…' : 'حفظ'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditPriceId(null)}
                            disabled={priceMutation.isPending}
                            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700/80"
                          >
                            إلغاء
                          </button>
                        </form>
                      ) : batchRangePreventsInline ? (
                        <span className="text-gray-800 dark:text-gray-200">{sellingPriceCellContent}</span>
                      ) : (
                        <button
                          type="button"
                          title={
                            hasBatchSP || hasBatchPP
                              ? 'يُحفَظ في قاعدة البيانات كسعر افتراضي للمنتج. لتعديل سعر كل دفعة استخدم صفحة التفاصيل.'
                              : undefined
                          }
                          onClick={() => {
                            setEditPriceId(p.id)
                            setEditPurchasePriceVal(String(p.purchase_price ?? ''))
                            setEditSellingPriceVal(String(p.selling_price ?? ''))
                          }}
                          className="hover:underline"
                        >
                          {sellingPriceCellContent}
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      {warehouseId != null ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="inline-flex items-center gap-1 flex-wrap justify-end">
                            {p.unit_type === 'bulk' ? (
                              <>
                                {formatNumber(Number(p.warehouse_stock ?? 0), 2)} كيلو
                                {p.bulk_bag_count != null && p.bulk_bag_count > 0 && (
                                  <span className="text-gray-500 dark:text-gray-400 text-xs">
                                    ({p.bulk_bag_count} شكارة)
                                  </span>
                                )}
                                {p.bulk_open_bag_low && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                                    الشكارة المفتوحة على وشك الانتهاء
                                  </span>
                                )}
                              </>
                            ) : (
                              p.warehouse_stock ?? 0
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const wh = warehouses.find((w) => w.id === warehouseId)
                              setStockEdit({
                                product: p,
                                warehouseId,
                                warehouseName: wh?.name_ar ?? '',
                                currentQuantity: p.warehouse_stock ?? 0,
                              })
                            }}
                            className="text-primary-600 dark:text-primary-400 hover:underline text-sm font-medium"
                          >
                            تعديل
                          </button>
                        </div>
                      ) : (
                        <span>
                          {p.unit_type === 'bulk'
                            ? `${formatNumber(Number(batchQty ?? 0), 2)} كجم`
                            : formatNumber(Number(batchQty ?? 0), 0)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      <Link
                        to={`/inventory/products/${p.id}`}
                        className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        <Package className="w-4 h-4" />
                        تفاصيل
                        <ArrowLeft className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && products.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <ChevronRight className="w-4 h-4" />
              السابق
            </button>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              صفحة {page} من {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              التالي
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        )}
        <ContextMenu
          open={!!contextMenu}
          x={contextMenu?.x ?? 0}
          y={contextMenu?.y ?? 0}
          onClose={() => setContextMenu(null)}
          items={
            contextMenu
              ? [
                  {
                    label: 'تعديل',
                    icon: <Pencil className="w-4 h-4" />,
                    onClick: () => setEditProduct(contextMenu.product),
                  },
                  {
                    label: 'حذف',
                    icon: <Trash2 className="w-4 h-4" />,
                    danger: true,
                    onClick: () => {
                      if (window.confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
                        deleteMutation.mutate(contextMenu.product.id)
                      }
                    },
                  },
                ]
              : []
          }
        />
        {editProduct && (
          <EditProductModal
            open={!!editProduct}
            onClose={() => setEditProduct(null)}
            product={editProduct}
            categoryOptions={categoryOptions}
            warehouseOptions={warehouses.map((w) => ({ id: w.id, name_ar: w.name_ar }))}
            canManageBatches={canEditBatches}
            isSuperAdmin={isSuperAdmin}
            onProductSaved={() => {
              queryClient.invalidateQueries({ queryKey: ['products'] })
              queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
              setEditProduct(null)
              setInventoryCelebrate({ title: 'تم حفظ بيانات المنتج بنجاح' })
            }}
          />
        )}
        {stockEdit && (
          <SetProductStockModal
            open={!!stockEdit}
            onClose={() => setStockEdit(null)}
            productId={stockEdit.product.id}
            productName={stockEdit.product.name}
            warehouseId={stockEdit.warehouseId}
            warehouseName={stockEdit.warehouseName}
            currentQuantity={stockEdit.currentQuantity}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ['warehouse-stock', stockEdit.warehouseId] })
              queryClient.invalidateQueries({ queryKey: ['products'] })
              setInventoryCelebrate({ title: 'تم تحديث الكمية بنجاح' })
            }}
          />
        )}
      </div>
    </div>
  )
}
