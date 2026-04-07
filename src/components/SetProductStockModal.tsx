import { useState, useEffect } from 'react'
import Modal from './Modal'
import { adjustStock } from '@/api/products'
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

  useEffect(() => {
    if (open) setQuantity(currentQuantity)
  }, [open, currentQuantity])

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
      const delta = q - currentQuantity
      await adjustStock(String(productId), {
        warehouse_id: warehouseId,
        quantity_delta: delta,
      })
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
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium disabled:opacity-50"
          >
            {loading ? 'جاري الحفظ...' : 'تحديث الكمية'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
