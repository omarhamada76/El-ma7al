import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { cn, fromMonthInputValue, toMonthInputValue, normalizeSearchText } from '@/lib/utils'
import { Package } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { getProducts } from '@/api/products'
import type { Product } from '@/types/api'

interface AddReceiptLineModalProps {
  open: boolean
  onClose: () => void
  products: Product[]
  firstWarehouseId?: number
  onAdd: (product: Product, quantity: number, expiryDate: string, kg_per_bag?: number) => void
}

export default function AddReceiptLineModal({
  open,
  onClose,
  products,
  firstWarehouseId,
  onAdd,
}: AddReceiptLineModalProps) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [kgPerBag, setKgPerBag] = useState<number | ''>('')
  const [expiryDate, setExpiryDate] = useState('')

  useEffect(() => {
    if (!open) return
    setSearch('')
    setSelectedId(null)
    setQuantity(1)
    setKgPerBag('')
    const oneYear = new Date()
    oneYear.setFullYear(oneYear.getFullYear() + 1)
    setExpiryDate(oneYear.toISOString().slice(0, 10))
  }, [open])

  const { data: searchResultsData, isLoading: isSearching } = useQuery({
    queryKey: ['products', 'search', search],
    queryFn: () => getProducts({ search: normalizeSearchText(search), limit: 50 }),
    enabled: search.trim().length > 0,
    staleTime: 30000,
  })
  const searchResults = searchResultsData?.data ?? []

  const filtered = search.trim().length > 0 ? searchResults : products

  const selected = selectedId != null ? filtered.find((p) => p.id === selectedId) : undefined

  const handleAdd = () => {
    if (!selected || !expiryDate) return
    const q = Math.max(0, Number(quantity))
    if (!Number.isFinite(q) || q <= 0) return
    let kg = undefined
    if (selected.unit_type === 'bulk') {
      const kgb = Number(kgPerBag)
      if (!Number.isFinite(kgb) || kgb <= 0) return
      kg = kgb
    }
    onAdd(selected, q, expiryDate, kg)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إضافة صنف من المخزون"
      className="sm:max-w-lg"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          ابحث عن منتج موجود، حدد الكمية وتاريخ الصلاحية، ثم أضفه إلى الجدول.
        </p>

        <div>
          <label className="block text-sm font-medium mb-1">بحث</label>
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="اسم المنتج..."
            className={cn(
              'w-full rounded-lg border border-gray-300 bg-white py-2 ps-4 pe-3 text-sm dark:border-gray-600 dark:bg-gray-800',
              'focus:ring-2 focus:ring-primary-500'
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">
              {selected?.unit_type === 'bulk' ? 'عدد الشكاير' : 'الكمية'}
            </label>
            <input
              type="number"
              min={selected?.unit_type === 'bulk' ? 1 : 0.01}
              step={selected?.unit_type === 'bulk' ? '1' : 'any'}
              value={quantity === 0 ? '' : quantity}
              onChange={(e) => setQuantity(Math.max(0, Number(e.target.value) || 0))}
              className={cn(
                'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800 text-sm',
                'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
              )}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">تاريخ الصلاحية</label>
            <input
              type="month"
              value={toMonthInputValue(expiryDate)}
              onChange={(e) => setExpiryDate(fromMonthInputValue(e.target.value) ?? '')}
              required
              className={cn(
                'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800 text-sm',
                !expiryDate
                  ? 'border-red-400 dark:border-red-600'
                  : 'border-gray-300 dark:border-gray-600',
                'focus:ring-2 focus:ring-primary-500'
              )}
            />
          </div>
        </div>

        {selected?.unit_type === 'bulk' && (
          <div>
            <label className="block text-sm font-medium mb-1">وزن الشكارة بالكيلو</label>
            <input
              type="number"
              min={0.01}
              step="any"
              value={kgPerBag}
              onChange={(e) => setKgPerBag(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={`الوزن الافتراضي: ${selected.bag_weight_kg || 'غير محدد'}`}
              className={cn(
                'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800 text-sm',
                'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
              )}
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">المنتجات</label>
          <div className="rounded-lg border border-gray-200 dark:border-gray-600 max-h-56 overflow-y-auto">
            {isSearching ? (
              <p className="p-4 text-sm text-gray-500 dark:text-gray-400 text-center italic animate-pulse">جاري البحث...</p>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-gray-500 dark:text-gray-400 text-center">لا توجد نتائج</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(p.id)
                        if (p.unit_type === 'bulk') {
                          setQuantity(1)
                          setKgPerBag((p.bag_weight_kg as number) || '')
                        }
                      }}
                      className={cn(
                        'w-full flex items-center gap-3 text-right px-3 py-2.5 text-sm transition-colors cursor-pointer',
                        selectedId === p.id
                          ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-900 dark:text-primary-100 font-medium'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/80'
                      )}
                    >
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="h-10 w-10 rounded-lg object-cover border border-gray-200 dark:border-gray-600 shadow-sm" />
                      ) : (
                        <div className="h-10 w-10 flex items-center justify-center rounded-lg border border-dashed border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-400">
                          <Package className="h-5 w-5" />
                        </div>
                      )}
                      <div className="flex-1 text-right">
                        <div className="flex items-center gap-2">
                          <span>{p.name}</span>
                          <span className="text-xs text-gray-400 font-mono">#{p.id}</span>
                        </div>
                        {p.unit_type === 'bulk' && (
                          <span className="text-[10px] text-primary-600 bg-primary-100 px-1 py-0.5 rounded">منتج بالوزن (شكاير)</span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {firstWarehouseId != null && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            بشكل افتراضي تُوضع الكمية كاملة في أول مخزن؛ يمكنك تعديل التوزيع في الجدول قبل الحفظ.
          </p>
        )}

        <div className="flex flex-wrap gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={!selected || quantity <= 0 || !expiryDate || (selected.unit_type === 'bulk' && !kgPerBag)}
            onClick={handleAdd}
            className={cn(
              'px-4 py-2 rounded-lg font-medium text-white',
              'bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            إضافة للجدول
          </button>
        </div>
      </div>
    </Modal>
  )
}
