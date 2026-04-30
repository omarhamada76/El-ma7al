import { useState, useEffect } from 'react'
import Modal from './Modal'
import { cn } from '@/lib/utils'

export type ClientFormData = { name: string; phone: string; location: string; initial_debt: number; notes?: string }

interface AddClientModalProps {
  open: boolean
  onClose: () => void
  /** When set, form is in edit mode (prefilled, title "تعديل عميل") */
  initialValues?: ClientFormData | null
  onSubmit: (data: ClientFormData) => Promise<void>
  /** موظف: إخفاء المديونية المبدئية */
  hideInitialDebt?: boolean
}

export default function AddClientModal({ open, onClose, initialValues, onSubmit, hideInitialDebt }: AddClientModalProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [initial_debt, setInitialDebt] = useState(0)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && initialValues) {
      setName(initialValues.name)
      setPhone(initialValues.phone || '')
      setLocation(initialValues.location || '')
      setInitialDebt(initialValues.initial_debt ?? 0)
      setNotes(initialValues.notes || '')
    } else if (open && !initialValues) {
      setName('')
      setPhone('')
      setLocation('')
      setInitialDebt(0)
      setNotes('')
    }
  }, [open, initialValues])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('اسم العميل مطلوب')
      return
    }
    setLoading(true)
    try {
      await onSubmit({
        name: name.trim(),
        phone: phone.trim() || '',
        location: location.trim() || '',
        initial_debt: hideInitialDebt ? 0 : initial_debt,
        notes: notes.trim() || '',
      })
      if (!initialValues) {
        setName('')
        setPhone('')
        setLocation('')
        setInitialDebt(0)
        setNotes('')
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الحفظ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initialValues ? 'تعديل عميل' : 'إضافة عميل'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">اسم العميل *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900'
            )}
            placeholder="اسم العميل"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">رقم الهاتف <span className="text-gray-400 font-normal">(اختياري)</span></label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            placeholder="01xxxxxxxxx"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">الموقع <span className="text-gray-400 font-normal">(اختياري)</span></label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            placeholder="غير محدد"
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
        <div>
          <label className="block text-sm font-medium mb-1">ملاحظات <span className="text-gray-400 font-normal">(اختياري)</span></label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 min-h-[80px]"
            placeholder="أية ملاحظات إضافية عن العميل..."
          />
        </div>
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
            {loading ? 'جاري الحفظ...' : initialValues ? 'تحديث' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
