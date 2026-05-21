import { useState, useEffect } from 'react'
import Modal from './Modal'
import { adjustStock, getProductBatches, patchProductBatch } from '@/api/products'
import { cn } from '@/lib/utils'

interface SetProductStockModalProps {
  open: boolean
  onClose: () => void
  productId: number
  productName: string
  warehouseId: number
  warehouseName: string
  currentQuantity: number
  onSuccess: () => void
}

export default function SetProductStockModal({
  open,
  onClose,
  productId,
  productName,
  warehouseId,
  warehouseName,
  currentQuantity,
  onSuccess,
}: SetProductStockModalProps) {
  const [quantity, setQuantity] = useState<number | ''>(currentQuantity)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [batchCount, setBatchCount] = useState<number | null>(null)
  const [batchPreview, setBatchPreview] = useState<string[]>([])
  const [batchesLoading, setBatchesLoading] = useState(false)

  useEffect(() => {
    if (open) setQuantity(currentQuantity)
  }, [open, currentQuantity])

  useEffect(() => {
    let cancelled = false
    if (!open) return
    setBatchesLoading(true)
    setBatchCount(null)
    setBatchPreview([])
    setError('')
    getProductBatches(productId, warehouseId, { includeEmpty: true })
      .then((rows) => {
        if (cancelled) return
        setBatchCount(rows.length)
        const preview = rows
          .slice(0, 3)
          .map((b) => `#${b.id}${b.expiry_date && b.expiry_date !== '9999-12-31' ? ` (${b.expiry_date.slice(0, 7)})` : ''}`)
        setBatchPreview(preview)
      })
      .catch(() => {
        if (cancelled) return
        setBatchCount(null)
      })
      .finally(() => {
        if (!cancelled) setBatchesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, productId, warehouseId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const q = Math.max(0, Number(quantity))
    if (Number.isNaN(q)) {
      setError('أدخل رقماً صحيحاً')
      return
    }
    setLoading(true)
    try {
      // Keep quantity edits consistent with batch edits by writing to the batch source of truth.
      const batches = await getProductBatches(productId, warehouseId, { includeEmpty: true })
      if (batches.length === 1) {
        const b = batches[0]
        if ((b.unit_type ?? 'piece') === 'bulk') {
          await patchProductBatch(b.id, { kg_remaining: q })
        } else {
          await patchProductBatch(b.id, { quantity: Math.floor(q) })
        }
      } else if (batches.length === 0) {
        // Legacy fallback when no batches exist yet.
        const delta = q - currentQuantity
        await adjustStock(String(productId), {
          warehouse_id: warehouseId,
          quantity_delta: delta,
        })
      } else {
        setError('يوجد أكثر من دفعة في هذا المخزن. عدّل الكمية من جدول الدُفعات داخل "تعديل المنتج".')
        setLoading(false)
        return
      }
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تحديث الكمية')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="تعديل الكمية في المخزن">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          المنتج: <span className="font-medium text-gray-900 dark:text-gray-100">{productName}</span>
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          المخزن: <span className="font-medium text-gray-900 dark:text-gray-100">{warehouseName}</span>
        </p>
        <div>
          <label className="block text-sm font-medium mb-1">الكمية/الوزن الحالي</label>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{currentQuantity}</p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3 text-sm">
          <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">حالة الدُفعات في هذا المخزن</p>
          {batchesLoading ? (
            <p className="text-gray-500 dark:text-gray-400">جاري فحص الدُفعات...</p>
          ) : batchCount == null ? (
            <p className="text-gray-500 dark:text-gray-400">تعذر قراءة الدُفعات الآن. يمكن المتابعة وسيتم التحقق عند الحفظ.</p>
          ) : batchCount === 0 ? (
            <p className="text-amber-700 dark:text-amber-300">لا توجد دفعات حالياً. سيتم استخدام تعديل المخزون المباشر.</p>
          ) : batchCount === 1 ? (
            <p className="text-emerald-700 dark:text-emerald-300">
              دفعة واحدة {batchPreview[0] ? `(${batchPreview[0]})` : ''} — التعديل السريع مسموح من هنا.
            </p>
          ) : (
            <p className="text-amber-700 dark:text-amber-300">
              يوجد {batchCount} دفعات {batchPreview.length ? `(${batchPreview.join('، ')}${batchCount > batchPreview.length ? ' ...' : ''})` : ''} — عدّل الكمية من جدول الدُفعات داخل "تعديل المنتج".
            </p>
          )}
        </div>
        <div>
          <label htmlFor="new-qty" className="block text-sm font-medium mb-1">الكمية/الوزن الجديد *</label>
          <input
            id="new-qty"
            type="number"
            min={0}
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
            )}
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={loading || (batchCount != null && batchCount > 1)}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium disabled:opacity-50"
          >
            {loading ? 'جاري الحفظ...' : 'تحديث الكمية'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
