import { useState, useEffect } from 'react'
import Modal from './Modal'

export type SupplierFormData = { name: string; phone: string; email: string; address: string; notes: string }

interface AddSupplierModalProps {
  open: boolean
  onClose: () => void
  /** When set, form is in edit mode (prefilled, title "تعديل مورد") */
  initialValues?: SupplierFormData | null
  onSubmit: (data: SupplierFormData) => Promise<void>
}

export default function AddSupplierModal({ open, onClose, initialValues, onSubmit }: AddSupplierModalProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && initialValues) {
      setName(initialValues.name)
      setPhone(initialValues.phone || '')
      setEmail(initialValues.email || '')
      setAddress(initialValues.address || '')
      setNotes(initialValues.notes || '')
    } else if (open && !initialValues) {
      setName('')
      setPhone('')
      setEmail('')
      setAddress('')
      setNotes('')
    }
  }, [open, initialValues])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('اسم المورد مطلوب')
      return
    }
    setLoading(true)
    try {
      await onSubmit({
        name: name.trim(),
        phone: phone.trim() || '',
        email: email.trim() || '',
        address: address.trim() || '',
        notes: notes.trim() || '',
      })
      if (!initialValues) {
        setName('')
        setPhone('')
        setEmail('')
        setAddress('')
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
    <Modal open={open} onClose={onClose} title={initialValues ? 'تعديل مورد' : 'إضافة مورد'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">اسم المورد *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            placeholder="اسم المورد"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">رقم الهاتف</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">البريد الإلكتروني</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">العنوان</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">ملاحظات</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            rows={2}
          />
        </div>
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
