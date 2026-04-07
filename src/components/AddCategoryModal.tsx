import { useState } from 'react'
import Modal from './Modal'
import { cn } from '@/lib/utils'

interface AddCategoryModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (name_ar: string) => Promise<void>
}

export default function AddCategoryModal({ open, onClose, onSubmit }: AddCategoryModalProps) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmed = name.trim()
    if (!trimmed) {
      setError('اسم الفئة مطلوب')
      return
    }
    setLoading(true)
    try {
      await onSubmit(trimmed)
      setName('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الحفظ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="إضافة فئة">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">الفئة (اسم الفئة) *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
            )}
            placeholder="مثال: مضادات حيوية"
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
            {loading ? 'جاري الحفظ...' : 'إضافة الفئة'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
