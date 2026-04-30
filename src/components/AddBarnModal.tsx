import { useState, useEffect } from 'react'
import Modal from './Modal'

export type BarnFormData = { name: string; initial_debt: number }

interface AddBarnModalProps {
  open: boolean
  onClose: () => void
  initialValues?: BarnFormData | null
  onSubmit: (data: BarnFormData) => Promise<void>
  hideInitialDebt?: boolean
}

export default function AddBarnModal({ open, onClose, onSubmit, initialValues, hideInitialDebt }: AddBarnModalProps) {
  const [name, setName] = useState('')
  const [initial_debt, setInitialDebt] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && initialValues) {
      setName(initialValues.name)
      setInitialDebt(initialValues.initial_debt)
    } else if (open && !initialValues) {
      setName('')
      setInitialDebt(0)
    }
  }, [open, initialValues])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('اسم العنبر مطلوب')
      return
    }
    setLoading(true)
    try {
      await onSubmit({ name: name.trim(), initial_debt: hideInitialDebt ? 0 : initial_debt })
      if (!initialValues) {
        setName('')
        setInitialDebt(0)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الحفظ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initialValues ? 'تعديل عنبر' : 'إضافة عنبر'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">اسم العنبر *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            placeholder="اسم العنبر"
          />
        </div>
        {!hideInitialDebt && (
          <div>
            <label className="block text-sm font-medium mb-1">المديونية المبدئية (ج.م)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={initial_debt || ''}
              onChange={(e) => setInitialDebt(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            />
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 font-medium">
            إلغاء
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'جاري الحفظ...' : initialValues ? 'تحديث' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
