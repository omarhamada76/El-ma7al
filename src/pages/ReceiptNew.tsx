import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { getSuppliers, createSupplier } from '@/api/suppliers'
import { getWarehouses } from '@/api/warehouses'
import { getProducts, createProduct, getProductBatches } from '@/api/products'
import { getCategoryOptions } from '@/api/categories'
import {
  createSupplierReceiptWithDistribution,
  type CreateSupplierReceiptBody,
} from '@/api/supplierPurchases'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import AddProductModal from '@/components/AddProductModal'
import AddReceiptLineModal from '@/components/AddReceiptLineModal'
import AddSupplierModal from '@/components/AddSupplierModal'
import type { Product, ProductBatch } from '@/types/api'

function defaultExpiryDate(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

interface ReceiptRow {
  product_id: number
  product_name: string
  quantity: number
  unit_price: number
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

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers', 'list'],
    queryFn: () => getSuppliers({ limit: 200 }),
  })
  const suppliers = suppliersData?.data ?? []

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses,
  })
  const sortedWarehouses = [...warehouses].sort((a, b) => a.id - b.id)

  const { data: productsData } = useQuery({
    queryKey: ['products', 'list'],
    queryFn: () => getProducts({ limit: 500 }),
  })
  const products = productsData?.data ?? []
  const { data: categoryOptions = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategoryOptions,
  })

  const createMutation = useMutation({
    mutationFn: (body: CreateSupplierReceiptBody) =>
      createSupplierReceiptWithDistribution(body),
    onSuccess: () => {
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
      navigate('/inventory?unpriced=1')
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الاستلام')
    },
  })

  const createSupplierMutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: (newSupplier) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers', 'list'] })
      setSupplierId(String(newSupplier.id))
      setAddSupplierOpen(false)
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
          total_price: newProduct.purchase_price,
          expiry_date: defaultExpiryDate(),
          distribution: dist,
        },
      ])
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
      quantity: q,
      unit_price: product.purchase_price,
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
        quantity: sum || 1,
        unit_price: product.purchase_price,
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
        expiry_date: i.expiry_date,
        unit_type: i.unit_type,
        kg_per_bag: i.kg_per_bag,
        distribution: i.distribution,
      })),
    })
  }

  return (
    <div className="space-y-6 max-w-4xl w-full min-w-0 overflow-x-hidden" dir="rtl">
      <h1 className="text-xl sm:text-2xl font-bold">استلام البضاعة</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 break-words">
        اختر المورد (الشركة)، أضف الأصناف المستلمة (المنتج، الكمية، سعر الفاتورة). من المبلغ الإجمالي تزيد مديونية المورد. ثم وزّع كل صنف على المخازن (اجهور / شبرا) لزيادة المخزون عندهم.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6 min-w-0">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
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
                unit_type: d.unit_type,
                bag_weight_kg: d.bag_weight_kg ?? null,
                initial_batches: d.initial_batches ?? [],
                warehouse_id: d.warehouse_id,
              })
            }}
          />
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto min-w-0 w-full max-w-full">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-right py-2 px-3">المنتج</th>
                  <th className="text-right py-2 px-3 w-32">تاريخ الصلاحية</th>
                  <th className="text-right py-2 px-3 w-24">الكمية</th>
                  <th className="text-right py-2 px-3 w-28">سعر الوحدة</th>
                  <th className="text-right py-2 px-3 w-28">الإجمالي</th>
                  {sortedWarehouses.map((w) => (
                    <th key={w.id} className="text-right py-2 px-3 w-24">توزيع: {w.name_ar}</th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((row, index) => {
                  const isSearchOpen = focusedProductRow === index
                  const searchNorm = productSearchQuery.trim().toLowerCase()
                  const filteredProducts = searchNorm
                    ? products.filter((p) => p.name.toLowerCase().includes(searchNorm))
                    : products
                  return (
                  <tr key={index} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="py-1.5 px-3 relative">
                      <div ref={isSearchOpen ? productSearchRef : null} className="relative">
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
                          <ul className="absolute z-10 top-full left-0 right-0 mt-0.5 max-h-48 overflow-y-auto rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
                            {filteredProducts.length === 0 ? (
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
                                    className="w-full text-right px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                                  >
                                    {p.name}
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
                        type="date"
                        value={row.expiry_date}
                        onChange={(e) => setExpiryDate(index, e.target.value)}
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
                      <td colSpan={5 + sortedWarehouses.length + 1} className="py-1 px-3">
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
