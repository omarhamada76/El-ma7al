import { useState, useMemo, useRef, useEffect } from 'react'
import Modal from './Modal'
import FeedbackBanner from './FeedbackBanner'
import { cn, formatCurrency, formatExpiryMonth, formatNumber, getNearExpiryWarning } from '@/lib/utils'
import type { ProductBatch } from '@/types/api'

interface BatchPickerModalProps {
  open: boolean
  onClose: () => void
  productName: string
  batches: ProductBatch[]
  warehouseNames: Record<number, string>
  /** Called when user confirms a batch selection. */
  onSelect: (batch: ProductBatch, quantity: number) => void
}

export default function BatchPickerModal({
  open,
  onClose,
  productName,
  batches,
  warehouseNames,
  onSelect,
}: BatchPickerModalProps) {
  const sortedBatches = useMemo(() => {
    return [...batches].sort((a, b) => {
      const dateA = a.expiry_date || '9999-12-31'
      const dateB = b.expiry_date || '9999-12-31'
      if (dateA < dateB) return -1
      if (dateA > dateB) return 1
      return 0
    })
  }, [batches])

  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [error, setError] = useState('')
  const confirmLockRef = useRef(false)

  const defaultBatchId = sortedBatches[0]?.id

  useEffect(() => {
    if (!open) {
      confirmLockRef.current = false
      return
    }
    if (defaultBatchId == null) return
    setSelectedBatchId(defaultBatchId)
    setQuantity(1)
    setError('')
  }, [open, defaultBatchId])

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const selectedBatch = sortedBatches.find((b) => b.id === selectedBatchId)

  const earliestExpiry = sortedBatches[0]?.expiry_date || '9999-12-31'
  const isSelectingLaterBatch =
    selectedBatch && (selectedBatch.expiry_date || '9999-12-31') > earliestExpiry
  const getBatchQty = (b: ProductBatch) =>
    b.unit_type === 'bulk' ? (b.kg_remaining ?? 0) : (b.quantity ?? 0)

  const handleConfirm = () => {
    if (confirmLockRef.current) return
    if (!selectedBatch) {
      setError('اختر دفعة أولاً')
      return
    }
    const q = Math.max(0.01, quantity)
    if (q > getBatchQty(selectedBatch)) {
      setError(
        `الكمية المطلوبة تتجاوز المخزون المتاح في هذه الدفعة (متاح: ${selectedBatch.unit_type === 'bulk' ? formatNumber(getBatchQty(selectedBatch), 2) + ' كجم' : formatNumber(getBatchQty(selectedBatch), 0)})`
      )
      return
    }
    setError('')
    confirmLockRef.current = true
    onSelect(selectedBatch, q)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="اختر الدفعة" className="sm:max-w-xl">
      <div className="space-y-4" dir="rtl">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          المنتج: <span className="font-medium text-gray-900 dark:text-gray-100">{productName}</span>
          <br />
          يوجد <span className="font-medium">{batches.length}</span> دفعة متاحة — اختر الدفعة والكمية المطلوبة.
        </p>

        {error && (
          <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {isSelectingLaterBatch && (
          <FeedbackBanner
            type="warning"
            message={getNearExpiryWarning(earliestExpiry)}
          />
        )}

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 px-3 w-10" />
                <th className="text-right py-2 px-3">المخزن</th>
                <th className="text-right py-2 px-3">تاريخ الصلاحية</th>
                <th className="text-right py-2 px-3">الكمية المتاحة</th>
                <th className="text-right py-2 px-3">سعر البيع</th>
              </tr>
            </thead>
            <tbody>
              {sortedBatches.map((b, idx) => {
                const isSentinel = !b.expiry_date || b.expiry_date === '9999-12-31'
                const isExpired =
                  !isSentinel && b.expiry_date != null && b.expiry_date < todayStr
                const isFefo = idx === 0

                return (
                  <tr
                    key={b.id}
                    className={cn(
                      'border-b border-gray-100 dark:border-gray-700 last:border-0 cursor-pointer transition-colors',
                      selectedBatchId === b.id
                        ? 'bg-primary-50 dark:bg-primary-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/30',
                      isExpired && 'bg-red-50/50 dark:bg-red-900/10'
                    )}
                    onClick={() => {
                      setSelectedBatchId(b.id)
                      setError('')
                    }}
                  >
                    <td className="py-2 px-3 text-center">
                      <input
                        type="radio"
                        name="batch-picker"
                        checked={selectedBatchId === b.id}
                        onChange={() => {
                          setSelectedBatchId(b.id)
                          setError('')
                        }}
                        className="accent-primary-600"
                      />
                    </td>
                    <td className="py-2 px-3">
                      {b.warehouse_name_ar ?? warehouseNames[b.warehouse_id] ?? `مخزن ${b.warehouse_id}`}
                    </td>
                    <td className="py-2 px-3">
                      {isSentinel ? (
                        <span className="text-gray-400">بدون تاريخ</span>
                      ) : (
                        <span className={isExpired ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                          {formatExpiryMonth(b.expiry_date)}
                          {isExpired && (
                            <span className="mr-1 text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded-full">
                              منتهي
                            </span>
                          )}
                        </span>
                      )}
                      {isFefo && !isExpired && (
                        <span className="mr-1 text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded-full">
                          الأقرب انتهاءً
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-medium">{b.unit_type === "bulk" ? `${formatNumber(b.kg_remaining ?? 0, 2)} كجم` : formatNumber(b.quantity ?? 0, 0)}</td>
                    <td className="py-2 px-3">
                      {b.selling_price != null && b.selling_price > 0
                        ? formatCurrency(b.selling_price)
                        : <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">{selectedBatch?.unit_type === "bulk" ? "الوزن (كجم)" : "الكمية"}</label>
          <input
            type="number"
            min={0}
            step="any"
            max={selectedBatch ? getBatchQty(selectedBatch) : 99999}
            value={quantity}
            onChange={(e) => {
              const v = Number(e.target.value) || 1
              setQuantity(v)
              if (selectedBatch && v > getBatchQty(selectedBatch)) {
                setError(
                  `الكمية المطلوبة تتجاوز المخزون المتاح في هذه الدفعة (متاح: ${selectedBatch.unit_type === 'bulk' ? formatNumber(getBatchQty(selectedBatch), 2) + ' كجم' : formatNumber(getBatchQty(selectedBatch), 0)})`
                )
              } else {
                setError('')
              }
            }}
            className={cn(
              'w-full max-w-xs px-3 py-2 rounded-lg border bg-white dark:bg-gray-800 text-sm',
              error
                ? 'border-red-400 dark:border-red-600'
                : 'border-gray-300 dark:border-gray-600',
              'focus:ring-2 focus:ring-primary-500'
            )}
          />
          {selectedBatch && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              الحد الأقصى: {selectedBatch.unit_type === 'bulk' ? `${formatNumber(selectedBatch.kg_remaining ?? 0, 2)} كجم` : `${formatNumber(selectedBatch.quantity ?? 0, 0)} وحدة`}
            </p>
          )}
        </div>

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
            onClick={handleConfirm}
            disabled={!selectedBatch || quantity <= 0}
            className={cn(
              'px-4 py-2 rounded-lg font-medium text-white',
              'bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            تأكيد الدفعة
          </button>
        </div>
      </div>
    </Modal>
  )
}
