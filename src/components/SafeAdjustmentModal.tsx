import { useState } from 'react'
import Modal from './Modal'

interface SafeAdjustmentModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: { type: 'adjustment_in' | 'adjustment_out'; amount: number; notes?: string }) => Promise<void>
}

export default function SafeAdjustmentModal({ open, onClose, onSubmit }: SafeAdjustmentModalProps) {
  const [type, setType] = useState<'adjustment_in' | 'adjustment_out'>('adjustment_in')
  const [amount, setAmount] = useState(0)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (amount <= 0) {
      setError('المبلغ يجب أن يكون أكبر من صفر')
      return
    }
    setLoading(true)
    try {
      await onSubmit({ type, amount, notes: notes.trim() || undefined })
      setAmount(0)
      setNotes('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الحفظ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="تعديل رصيد الخزنه">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">نوع التعديل</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'adjustment_in' | 'adjustment_out')}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          >
            <option value="adjustment_in">إيداع</option>
            <option value="adjustment_out">سحب</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">المبلغ (ج.م) *</label>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={amount || ''}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">ملاحظات</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 font-medium">
            إلغاء
          </button>
          <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50">
            {loading ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
