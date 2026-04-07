import { useState, useEffect } from 'react'
import Modal from './Modal'

interface SafeSetBalanceModalProps {
  open: boolean
  onClose: () => void
  currentBalance: number
  onSubmit: (data: { newBalance: number; notes?: string }) => Promise<void>
}

export default function SafeSetBalanceModal({
  open,
  onClose,
  currentBalance,
  onSubmit,
}: SafeSetBalanceModalProps) {
  const [newBalance, setNewBalance] = useState(currentBalance)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setNewBalance(currentBalance)
      setNotes('')
      setError('')
    }
  }, [open, currentBalance])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newBalance < 0) {
      setError('الرصيد لا يمكن أن يكون سالباً')
      return
    }
    setLoading(true)
    try {
      await onSubmit({ newBalance, notes: notes.trim() || undefined })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الحفظ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="ضبط رصيد الخزنه">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          الرصيد الحالي:{' '}
          <span className="font-semibold">
            {currentBalance.toLocaleString('ar-EG')} ج.م
          </span>
        </p>
        <div>
          <label className="block text-sm font-medium mb-1">الرصيد الجديد (ج.م) *</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={Number.isNaN(newBalance) ? '' : newBalance}
            onChange={(e) => setNewBalance(Number(e.target.value) || 0)}
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
        <p className="text-xs text-gray-500 dark:text-gray-400">
          سيتم تسجيل فرق الرصيد كتعديل (إيداع أو سحب) تلقائياً.
        </p>
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 font-medium"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

