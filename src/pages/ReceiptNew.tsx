import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Package } from 'lucide-react'
import { getSuppliers, createSupplier } from '@/api/suppliers'
import { getWarehouses } from '@/api/warehouses'
import { getProducts, createProduct, getProductBatches } from '@/api/products'
import { getCategoryOptions } from '@/api/categories'
import {
  createSupplierReceiptWithDistribution,
  type CreateSupplierReceiptBody,
} from '@/api/supplierPurchases'
import { formatCurrency, fromMonthInputValue, toMonthInputValue, normalizeSearchText } from '@/lib/utils'
import { cn } from '@/lib/utils'
import AddProductModal from '@/components/AddProductModal'
import AddReceiptLineModal from '@/components/AddReceiptLineModal'
import AddSupplierModal from '@/components/AddSupplierModal'
import FeedbackBanner from '@/components/FeedbackBanner'
import SuccessOverlay from '@/components/SuccessOverlay'
import type { Product, ProductBatch } from '@/types/api'

function defaultExpiryDate(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

interface ReceiptRow {
  product_id: number
  product_name: string
  image_url?: string | null
  quantity: number
  unit_price: number
  /** سعر البيع للدفعة الجديدة؛ إن وُجد يُستخدم بدل حساب الهامش الافتراضي */
  selling_price?: number
  total_price: number
  expiry_date: string
  unit_type?: 'piece' | 'bulk'
  kg_per_bag?: number
  distribution: Record<number, number> // warehouse_id -> qty
}

/** quantity = bags; unit_price = per kg — total = bags × kg/bag × price/kg */
function receiptLineTotal(row: ReceiptRow): number {
  if (row.unit_type !== 'bulk') return row.quantity * row.unit_price
  const kpb = Number(row.kg_per_bag) || 0
  return row.quantity * kpb * row.unit_price
}

export default function ReceiptNew() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ReceiptRow[]>([])
  const [error, setError] = useState('')
  const [celebrate, setCelebrate] = useState<{
    title: string
    subtitle?: string
    durationMs?: number
    then?: () => void
  } | null>(null)
  const [addProductOpen, setAddProductOpen] = useState(false)
  const [addLineOpen, setAddLineOpen] = useState(false)
  const [addSupplierOpen, setAddSupplierOpen] = useState(false)
  const [focusedProductRow, setFocusedProductRow] = useState<number | null>(null)
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const productSearchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focusedProductRow === null) return
    const handleClickOutside = (e: MouseEvent) => {
      if (productSearchRef.current && !productSearchRef.current.contains(e.target as Node)) {
        setFocusedProductRow(null)
        setProductSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [focusedProductRow])
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (items.length > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [items.length])

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers', 'list'],
    queryFn: () => getSuppliers({ limit: 200 }),
  })
  const suppliers = suppliersData?.data ?? []

  // Auto-select "شبرا" as default supplier if found
  useEffect(() => {
    if (suppliers.length > 0 && !supplierId) {
      const shubra = suppliers.find((s) => s.name === 'شبرا')
      if (shubra) {
        setSupplierId(String(shubra.id))
      }
    }
  }, [suppliers, supplierId])

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses,
  })
  const sortedWarehouses = [...warehouses].sort((a, b) => a.id - b.id)

  const { data: productsData } = useQuery({
    queryKey: ['products', 'list'],
    queryFn: () => getProducts({ limit: 100 }), // Reduced limit since we now have active search
  })
  const products = productsData?.data ?? []

  const { data: searchResultsData, isLoading: isSearchingProducts } = useQuery({
    queryKey: ['products', 'search', productSearchQuery],
    queryFn: () => getProducts({ search: normalizeSearchText(productSearchQuery), limit: 50 }),
    enabled: productSearchQuery.trim().length > 0,
  })
  const searchResults = searchResultsData?.data ?? []

  const { data: categoryOptions = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategoryOptions,
  })

  const createMutation = useMutation({
    mutationFn: (body: CreateSupplierReceiptBody) =>
      createSupplierReceiptWithDistribution(body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      queryClient.invalidateQueries({ queryKey: ['supplier'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['products', 'warehouse'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-batches'] })
      queryClient.invalidateQueries({ queryKey: ['product'] })
      queryClient.invalidateQueries({ queryKey: ['receipt-batches'] })
      setCelebrate({
        title: 'تم تسجيل استلام المورد بنجاح',
        subtitle: 'جاري التوجيه…',
        durationMs: 1700,
        then: () => {
          const productIds = variables.items.map(i => i.product_id).filter(Boolean).join(',')
          navigate(`/inventory?ids=${productIds}`)
        },
      })
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الاستلام')
    },
  })

  const createSupplierMutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: (newSupplier) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers', 'list'] })
      setSupplierId(String(newSupplier.id))
      setAddSupplierOpen(false)
      setCelebrate({
        title: 'تم إضافة المورد بنجاح',
        subtitle: 'تم اختياره في الاستلام',
        durationMs: 1400,
      })
    },
  })

  const createProductMutation = useMutation({
    mutationFn: (body: Parameters<typeof createProduct>[0]) => createProduct(body),
    onSuccess: (newProduct, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products', 'list'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      queryClient.invalidateQueries({ queryKey: ['product', String(newProduct.id)] })
      setAddProductOpen(false)
      const chosenWhId = variables.warehouse_id ?? sortedWarehouses[0]?.id
      const dist: Record<number, number> = {}
      sortedWarehouses.forEach((w) => { dist[w.id] = w.id === chosenWhId ? 1 : 0 })
      setItems((prev) => [
        ...prev,
        {
          product_id: newProduct.id,
          product_name: newProduct.name,
          quantity: 1,
          unit_price: newProduct.purchase_price,
          selling_price:
            newProduct.selling_price != null && newProduct.selling_price > 0
              ? newProduct.selling_price
              : undefined,
          total_price: newProduct.purchase_price,
          expiry_date: defaultExpiryDate(),
          distribution: dist,
        },
      ])
      setCelebrate({
        title: 'تم إضافة المنتج بنجاح',
        subtitle: 'تمت إضافته كسطر في الاستلام',
        durationMs: 1400,
      })
    },
  })

  // Track existing batches for products in the receipt to show merge vs new-batch notice
  const productIdsInReceipt = [...new Set(items.map((i) => i.product_id).filter(Boolean))]
  const { data: existingBatchesMap = {} } = useQuery({
    queryKey: ['receipt-batches', productIdsInReceipt.join(',')],
    queryFn: async () => {
      const map: Record<number, ProductBatch[]> = {}
      for (const pid of productIdsInReceipt) {
        map[pid] = await getProductBatches(pid)
      }
      return map
    },
    enabled: productIdsInReceipt.length > 0,
    staleTime: 10_000,
  })

  /** Check if a receipt row matches an existing batch */
  function getBatchMatchStatus(row: ReceiptRow): 'merge' | 'new' | null {
    if (!row.product_id || !row.unit_price || !row.expiry_date) return null
    const batches = existingBatchesMap[row.product_id] || []
    if (batches.length === 0) return 'new'
    const batchExpiry = row.expiry_date || '9999-12-31'
    const match = batches.find(
      (b) =>
        b.purchase_price === row.unit_price &&
        (b.expiry_date || '9999-12-31') === batchExpiry
    )
    return match ? 'merge' : 'new'
  }
  const totalDebt = items.reduce((a, i) => a + i.total_price, 0)

  const addLineFromInventory = (product: Product, quantity: number, expiryDate: string, kg_per_bag?: number) => {
    const q = Number(quantity)
    if (!Number.isFinite(q) || q <= 0) return
    const firstWh = sortedWarehouses[0]
    const dist: Record<number, number> = {}
    sortedWarehouses.forEach((w) => {
      dist[w.id] = w.id === firstWh?.id ? q : 0
    })
    const newRow: ReceiptRow = {
      product_id: product.id,
      product_name: product.name,
      image_url: product.image_url,
      quantity: q,
      unit_price: product.purchase_price,
      selling_price:
        product.selling_price != null && product.selling_price > 0 ? product.selling_price : undefined,
      total_price: 0,
      expiry_date: expiryDate,
      unit_type: product.unit_type,
      kg_per_bag: kg_per_bag,
      distribution: dist,
    }
    newRow.total_price = receiptLineTotal(newRow)
    setItems((prev) => [...prev, newRow])
  }

  const setProduct = (index: number, product: Product) => {
    setItems((prev) => {
      const next = [...prev]
      const row = next[index]
      const sum = Object.values(row.distribution).reduce((a, b) => a + b, 0)
      next[index] = {
        product_id: product.id,
        product_name: product.name,
        image_url: product.image_url,
        quantity: sum || 1,
        unit_price: product.purchase_price,
        selling_price:
          product.selling_price != null && product.selling_price > 0 ? product.selling_price : undefined,
        total_price: 0,
        expiry_date: row.expiry_date,
        unit_type: product.unit_type,
        kg_per_bag: product.unit_type === 'bulk' ? (product.bag_weight_kg || undefined) : undefined,
        distribution: row.distribution,
      }
      next[index].total_price = receiptLineTotal(next[index])
      return next
    })
  }

  const setQuantity = (index: number, quantity: number) => {
    const q = Math.max(0, quantity)
    setItems((prev) => {
      const next = [...prev]
      const row = next[index]
      const currentSum = Object.values(row.distribution).reduce((a, b) => a + b, 0)
      const updated = { ...row, quantity: q, total_price: 0 }
      updated.total_price = receiptLineTotal(updated)
      next[index] = updated
      if (currentSum !== q) {
        const firstId = sortedWarehouses[0]?.id
        const dist: Record<number, number> = {}
        sortedWarehouses.forEach((w) => { dist[w.id] = w.id === firstId ? q : 0 })
        next[index].distribution = dist
      }
      return next
    })
  }

  const setUnitPrice = (index: number, unit_price: number) => {
    const p = Math.max(0, unit_price)
    setItems((prev) => {
      const next = [...prev]
      const updated = {
        ...next[index],
        unit_price: p,
        total_price: 0,
      }
      updated.total_price = receiptLineTotal(updated)
      next[index] = updated
      return next
    })
  }

  const setSellingPrice = (index: number, value: number | undefined) => {
    setItems((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        selling_price: value,
      }
      return next
    })
  }

  const setDistribution = (index: number, warehouseId: number, qty: number) => {
    const v = Math.max(0, qty)
    setItems((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        distribution: { ...next[index].distribution, [warehouseId]: v },
      }
      const sum = Object.values(next[index].distribution).reduce((a, b) => a + b, 0)
      next[index].quantity = sum
      next[index].total_price = receiptLineTotal(next[index])
      return next
    })
  }

  const setExpiryDate = (index: number, date: string) => {
    setItems((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], expiry_date: date }
      return next
    })
  }

  const removeRow = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!supplierId) {
      setError('اختر المورد')
      return
    }
    if (items.length === 0) {
      setError('أضف صنفاً واحداً على الأقل')
      return
    }
    for (const row of items) {
      if (!row.expiry_date) {
        setError(`أدخل تاريخ الصلاحية للمنتج «${row.product_name}»`)
        return
      }
      const sum = Object.values(row.distribution).reduce((a, b) => a + b, 0)
      if (sum !== row.quantity) {
        setError(`توزيع الكمية لا يساوي الكمية المستلمة للمنتج «${row.product_name}» (المجموع: ${sum}، المطلوب: ${row.quantity})`)
        return
      }
    }
    createMutation.mutate({
      supplier_id: Number(supplierId),
      notes: notes.trim() || undefined,
      items: items.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        ...(i.selling_price != null && i.selling_price > 0 ? { selling_price: i.selling_price } : {}),
        expiry_date: i.expiry_date,
        unit_type: i.unit_type,
        kg_per_bag: i.kg_per_bag,
        distribution: i.distribution,
      })),
    })
  }

  return (
    <div className="space-y-6 w-full max-w-7xl min-w-0" dir="rtl">
      <SuccessOverlay
        open={!!celebrate}
        title={celebrate?.title ?? ''}
        subtitle={celebrate?.subtitle}
        durationMs={celebrate?.durationMs ?? 1650}
        onComplete={() => {
          const next = celebrate?.then
          setCelebrate(null)
          next?.()
        }}
      />
      <h1 className="text-xl sm:text-2xl font-bold">استلام البضاعة</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 break-words">
        اختر المورد (الشركة)، أضف الأصناف المستلمة (المنتج، الكمية، سعر الشراء، واختياريًا سعر البيع للدفعة). من المبلغ الإجمالي تزيد مديونية المورد. إن تركت «سعر البيع» فارغًا يُحسب من هامش البيع الافتراضي في الإعدادات. ثم وزّع كل صنف على المخازن لزيادة المخزون.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6 min-w-0">
        {error && (
          <FeedbackBanner type="error" message={error} />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1">
              <label className="text-sm font-medium shrink-0">المورد / الشركة *</label>
              <button
                type="button"
                onClick={() => setAddSupplierOpen(true)}
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline shrink-0"
              >
                + إضافة مورد جديد
              </button>
            </div>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className={cn(
                'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
                'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
              )}
              required
            >
              <option value="">— اختر المورد —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <AddSupplierModal
              open={addSupplierOpen}
              onClose={() => setAddSupplierOpen(false)}
              onSubmit={async (d) => {
                await createSupplierMutation.mutateAsync({
                  name: d.name,
                  phone: d.phone || null,
                  email: d.email || null,
                  address: d.address || null,
                  notes: d.notes || null,
                })
              }}
            />
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
            <label className="text-sm font-medium shrink-0">الأصناف المستلمة *</label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAddProductOpen(true)}
                className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 shrink-0"
              >
                <Plus className="w-4 h-4 shrink-0" /> إضافة منتج جديد
              </button>
              <button
                type="button"
                onClick={() => setAddLineOpen(true)}
                className="inline-flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:underline shrink-0"
              >
                <Plus className="w-4 h-4 shrink-0" /> إضافة صنف
              </button>
            </div>
          </div>
          <AddReceiptLineModal
            open={addLineOpen}
            onClose={() => setAddLineOpen(false)}
            products={products}
            firstWarehouseId={sortedWarehouses[0]?.id}
            onAdd={addLineFromInventory}
          />
          <AddProductModal
            open={addProductOpen}
            onClose={() => setAddProductOpen(false)}
            categoryOptions={categoryOptions}
            warehouseOptions={sortedWarehouses.map((w) => ({ id: w.id, name_ar: w.name_ar }))}
            initialWarehouseId={sortedWarehouses[0]?.id}
            onSubmit={async (d) => {
              await createProductMutation.mutateAsync({
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
            }}
          />
          <div className="responsive-table-container">
            {/* Desktop View: Table — min width on product col so search + dropdown stay usable */}
            <table className="hidden sm:table w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-right py-3 px-3 w-16">الصورة</th>
                  <th className="text-right py-3 px-3 min-w-[16rem] w-[26%] align-top">المنتج</th>
                  <th className="text-right py-3 px-3 w-32">تاريخ الصلاحية</th>
                  <th className="text-right py-3 px-3 w-24">الكمية</th>
                  <th className="text-right py-3 px-3 w-28">سعر الوحدة (شراء)</th>
                  <th className="text-right py-3 px-3 w-28">سعر البيع</th>
                  <th className="text-right py-3 px-3 w-28">الإجمالي</th>
                  {sortedWarehouses.map((w) => (
                    <th key={w.id} className="text-right py-3 px-3 w-24 whitespace-nowrap">توزيع: {w.name_ar}</th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((row, index) => {
                  const isSearchOpen = focusedProductRow === index
                  const searchNorm = normalizeSearchText(productSearchQuery)
                  const filteredProducts = searchNorm
                    ? searchResults
                    : products
                  return (
                  <tr key={index} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="py-2 px-3 align-top">
                      {row.image_url ? (
                        <img
                          src={row.image_url}
                          alt=""
                          loading="lazy"
                          className="h-10 w-10 shrink-0 rounded-lg object-cover border border-gray-200 dark:border-gray-700 shadow-sm"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-400">
                          <Package className="h-5 w-5" />
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-3 relative min-w-[16rem] w-[26%] align-top">
                      <div ref={isSearchOpen ? productSearchRef : null} className="relative z-20 min-w-[14rem]">
                        <input
                          type="text"
                          value={isSearchOpen ? productSearchQuery : row.product_name}
                          onChange={(e) => {
                            setFocusedProductRow(index)
                            setProductSearchQuery(e.target.value)
                          }}
                          onFocus={() => {
                            setFocusedProductRow(index)
                            setProductSearchQuery('')
                          }}
                          placeholder="بحث عن منتج..."
                          className={cn(
                            'w-full rounded border bg-white py-1.5 ps-3.5 pe-2 text-sm dark:bg-gray-800',
                            'border-gray-300 dark:border-gray-600 focus:border-primary-500 focus:ring-2 focus:ring-primary-500'
                          )}
                        />
                        {isSearchOpen && (
                          <ul className="absolute z-50 top-full start-0 end-0 mt-0.5 max-h-48 overflow-y-auto overflow-x-hidden rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
                            {isSearchingProducts ? (
                              <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">جاري البحث...</li>
                            ) : filteredProducts.length === 0 ? (
                              <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">لا توجد نتائج</li>
                            ) : (
                              filteredProducts.map((p) => (
                                <li key={p.id}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setProduct(index, p)
                                      setFocusedProductRow(null)
                                      setProductSearchQuery('')
                                    }}
                                    className="w-full flex items-center gap-3 text-right px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                  >
                                    {p.image_url ? (
                                      <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover border border-gray-100 dark:border-gray-600" />
                                    ) : (
                                      <div className="h-8 w-8 flex items-center justify-center rounded border border-dashed border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-400">
                                        <Package className="h-4 w-4" />
                                      </div>
                                    )}
                                    <div className="flex-1 text-right">
                                      <div className="flex items-center gap-2">
                                        <span>{p.name}</span>
                                        <span className="text-xs text-gray-400 font-mono">#{p.id}</span>
                                      </div>
                                    </div>
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-3">
                      <input
                        type="month"
                        value={toMonthInputValue(row.expiry_date)}
                        onChange={(e) => setExpiryDate(index, fromMonthInputValue(e.target.value) ?? '')}
                        required
                        className={cn(
                          'w-full px-2 py-1.5 rounded border bg-white dark:bg-gray-800 text-sm',
                          !row.expiry_date
                            ? 'border-red-400 dark:border-red-600'
                            : 'border-gray-300 dark:border-gray-600'
                        )}
                      />
                    </td>
                    <td className="py-1.5 px-3">
                      <input
                        type="number"
                        min={0}
                        value={row.quantity === 0 ? '' : row.quantity}
                        onChange={(e) => setQuantity(index, Number(e.target.value) || 0)}
                        placeholder="0"
                        className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </td>
                    <td className="py-1.5 px-3">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.unit_price === 0 ? '' : row.unit_price}
                        onChange={(e) => setUnitPrice(index, Number(e.target.value) || 0)}
                        placeholder="0"
                        className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </td>
                    <td className="py-1.5 px-3">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.selling_price == null || row.selling_price === 0 ? '' : row.selling_price}
                        onChange={(e) => {
                          const v = e.target.value.trim()
                          if (v === '') setSellingPrice(index, undefined)
                          else setSellingPrice(index, Number(v) || undefined)
                        }}
                        placeholder="تلقائي"
                        title="اتركه فارغاً لاستخدام هامش البيع الافتراضي من الإعدادات"
                        className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </td>
                    <td className="py-1.5 px-3 font-medium">{formatCurrency(row.total_price)}</td>
                    {sortedWarehouses.map((w) => (
                      <td key={w.id} className="py-1.5 px-3">
                        <input
                          type="number"
                          min={0}
                          value={(row.distribution[w.id] ?? 0) === 0 ? '' : (row.distribution[w.id] ?? 0)}
                          onChange={(e) => setDistribution(index, w.id, Number(e.target.value) || 0)}
                          placeholder="0"
                          className="w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        />
                      </td>
                    ))}
                    <td className="py-1.5 px-1">
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="p-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        aria-label="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  );
                })}
                {/* Batch merge/new notices */}
                {items.map((row, index) => {
                  const status = getBatchMatchStatus(row)
                  if (!status) return null
                  return (
                    <tr key={`notice-${index}`} className="border-b border-gray-100 dark:border-gray-700">
                      <td colSpan={7 + sortedWarehouses.length + 1} className="py-1 px-3">
                        <span className="text-xs">
                          <span className="font-medium text-gray-600 dark:text-gray-400">{row.product_name}:</span>{' '}
                          {status === 'merge' ? (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              ✓ سيتم إضافة الكمية إلى الدفعة الموجودة
                            </span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">
                              ⊕ سيتم إنشاء دفعة جديدة لهذا المنتج
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Mobile View: Cards */}
            <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {items.map((row, index) => {
                const isSearchOpen = focusedProductRow === index
                const searchNorm = normalizeSearchText(productSearchQuery)
                const filteredProducts = searchNorm
                  ? searchResults
                  : products
                const status = getBatchMatchStatus(row)

                return (
                  <div key={index} className="p-4 space-y-4">
                    <div className="flex justify-between items-start gap-3">
                      <div className="shrink-0 pt-6">
                        {row.image_url ? (
                          <img
                            src={row.image_url}
                            alt=""
                            className="h-12 w-12 rounded-lg object-cover border border-gray-200 dark:border-gray-700 shadow-sm"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-400">
                            <Package className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <div ref={isSearchOpen ? productSearchRef : null} className="relative flex-1 min-w-0">
                         <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-1 block">المنتج</label>
                         <input
                           type="text"
                           value={isSearchOpen ? productSearchQuery : row.product_name}
                           onChange={(e) => {
                             setFocusedProductRow(index)
                             setProductSearchQuery(e.target.value)
                           }}
                           onFocus={() => {
                             setFocusedProductRow(index)
                             setProductSearchQuery('')
                           }}
                           placeholder="بحث عن منتج..."
                           className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 font-bold"
                         />
                         {isSearchOpen && (
                           <ul className="absolute z-20 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5">
                             {isSearchingProducts ? (
                               <li className="px-3 py-2.5 text-sm text-gray-500">جاري البحث...</li>
                             ) : filteredProducts.length === 0 ? (
                               <li className="px-3 py-2.5 text-sm text-gray-500">لا توجد نتائج</li>
                             ) : (
                               filteredProducts.map((p) => (
                                 <li key={p.id}>
                                   <button
                                     type="button"
                                     onClick={() => {
                                       setProduct(index, p)
                                       setFocusedProductRow(null)
                                       setProductSearchQuery('')
                                     }}
                                     className="w-full flex items-center gap-3 text-right px-3 py-2.5 text-sm hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                                   >
                                     {p.image_url ? (
                                       <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover border border-gray-100 dark:border-gray-600" />
                                     ) : (
                                       <div className="h-8 w-8 flex items-center justify-center rounded border border-dashed border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-400">
                                         <Package className="h-4 w-4" />
                                       </div>
                                     )}
                                     <div className="flex-1 text-right">
                                       <div className="flex items-center gap-2">
                                         <span>{p.name}</span>
                                         <span className="text-xs text-gray-400 font-mono">#{p.id}</span>
                                       </div>
                                     </div>
                                   </button>
                                 </li>
                               ))
                             )}
                           </ul>
                         )}
                       </div>
                       <button
                         type="button"
                         onClick={() => removeRow(index)}
                         className="mt-6 p-2 text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                       >
                         <Trash2 className="w-5 h-5" />
                       </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                       <div>
                         <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-1 block">الصلاحية</label>
                         <input
                           type="month"
                           value={toMonthInputValue(row.expiry_date)}
                           onChange={(e) => setExpiryDate(index, fromMonthInputValue(e.target.value) ?? '')}
                           className="w-full px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                         />
                       </div>
                       <div>
                         <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-1 block">سعر الشراء</label>
                         <input
                           type="number"
                           step="any"
                           value={row.unit_price || ''}
                           onChange={(e) => setUnitPrice(index, parseFloat(e.target.value) || 0)}
                           className="w-full px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-bold"
                         />
                       </div>
                       <div className="col-span-2">
                         <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-1 block">
                           سعر البيع (اختياري)
                         </label>
                         <input
                           type="number"
                           step="any"
                           value={row.selling_price == null || row.selling_price === 0 ? '' : row.selling_price}
                           onChange={(e) => {
                             const v = e.target.value.trim()
                             if (v === '') setSellingPrice(index, undefined)
                             else setSellingPrice(index, parseFloat(v) || undefined)
                           }}
                           placeholder="تلقائي حسب الإعدادات"
                           className="w-full px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                         />
                       </div>
                    </div>

                    <div className="p-3 bg-gray-50 dark:bg-gray-900/40 rounded-xl space-y-3">
                       <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold">التوزيع والمخزون</p>
                       <div className="grid grid-cols-2 gap-3">
                         {sortedWarehouses.map((w) => (
                           <div key={w.id}>
                             <label className="text-[10px] text-gray-500 mb-1 block">{w.name_ar}</label>
                             <input
                               type="number"
                               value={row.distribution[w.id] || ''}
                               onChange={(e) => setDistribution(index, w.id, parseFloat(e.target.value) || 0)}
                               placeholder="0"
                               className="w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                             />
                           </div>
                         ))}
                       </div>
                       <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-700">
                         <span className="text-xs font-semibold text-gray-500">إجمالي الكمية:</span>
                         <span className="text-sm font-black">{row.quantity} {row.unit_type === 'bulk' ? 'شكارة' : 'وحدة'}</span>
                       </div>
                    </div>

                    <div className="flex justify-between items-center py-2 bg-primary-50 dark:bg-primary-950/20 px-3 rounded-lg">
                       <span className="text-xs font-semibold text-primary-700 dark:text-primary-300">الإجمالي المالي:</span>
                       <span className="text-sm font-black text-primary-600 dark:text-primary-400">{formatCurrency(row.total_price)}</span>
                    </div>

                    {status && (
                       <div className={cn(
                         "text-[10px] p-2 rounded-lg font-bold",
                         status === 'merge' ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                       )}>
                         {status === 'merge' ? "✓ دمج مع دفعة سابقة" : "⊕ دفعة جديدة كلياً"}
                       </div>
                    )}
                  </div>
                )
              })}
            </div>
            {items.length > 0 && (
              <div className="flex justify-end p-3 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-200 dark:border-gray-700">
                <span className="font-bold">
                  إجمالي المديونية المضافة للمورد: {formatCurrency(totalDebt)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">ملاحظات</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
            )}
            rows={2}
          />
        </div>

        <div className="flex flex-wrap gap-3 pt-2 min-w-0">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-1 min-w-[120px] py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={
              createMutation.isPending ||
              items.length === 0 ||
              !supplierId
            }
            className={cn(
              'flex-1 min-w-[120px] py-2.5 rounded-lg font-medium text-white',
              'bg-primary-600 hover:bg-primary-700 focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {createMutation.isPending ? 'جاري الحفظ...' : 'تسجيل الاستلام والتوزيع'}
          </button>
        </div>
      </form>
    </div>
  )
}
