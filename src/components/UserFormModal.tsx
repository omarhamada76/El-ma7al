import { useEffect, useState } from 'react'
import type { User, UserRole } from '@/types/api'

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'staff', label: 'موظف' },
  { value: 'admin', label: 'مشرف' },
  { value: 'super_admin', label: 'مدير النظام' },
]

interface UserFormModalProps {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  initialUser?: User | null
  /** Only super_admin can assign super_admin */
  canAssignSuperAdmin: boolean
  onSubmit: (data: {
    email?: string
    password?: string
    display_name: string
    role: UserRole
    is_active?: boolean
  }) => Promise<void>
  isPending?: boolean
}

export default function UserFormModal({
  open,
  onClose,
  mode,
  initialUser,
  canAssignSuperAdmin,
  onSubmit,
  isPending,
}: UserFormModalProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<UserRole>('staff')
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    if (mode === 'edit' && initialUser) {
      setEmail(initialUser.email)
      setPassword('')
      setDisplayName(initialUser.display_name ?? '')
      setRole(initialUser.role)
      setIsActive(initialUser.is_active !== false)
    } else {
      setEmail('')
      setPassword('')
      setDisplayName('')
      setRole('staff')
      setIsActive(true)
    }
  }, [open, mode, initialUser])

  if (!open) return null

  const roleChoices = canAssignSuperAdmin
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((o) => o.value !== 'super_admin')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      if (mode === 'create') {
        if (!email.trim()) {
          setError('البريد مطلوب')
          return
        }
        if (password.length < 6) {
          setError('كلمة المرور 6 أحرف على الأقل')
          return
        }
        await onSubmit({
          email: email.trim(),
          password,
          display_name: displayName,
          role,
        })
      } else {
        await onSubmit({
          display_name: displayName,
          role,
          is_active: isActive,
          ...(password.trim() ? { password: password.trim() } : {}),
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="إغلاق"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold mb-4">
          {mode === 'create' ? 'إضافة مستخدم' : 'تعديل مستخدم'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'create' ? (
            <>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">البريد</label>
                <input
                  type="email"
                  required
                  dir="ltr"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">كلمة المرور</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">البريد</label>
              <input
                type="text"
                readOnly
                dir="ltr"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50 text-gray-600"
                value={email}
              />
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">الاسم المعروض</label>
            <input
              type="text"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">الدور</label>
            <select
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {roleChoices.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {mode === 'edit' && (
            <>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">حساب نشط</span>
              </label>
              <div>
                <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">
                  كلمة مرور جديدة (اختياري)
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="اتركه فارغاً للإبقاء على الحالية"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isPending ? 'جاري الحفظ…' : mode === 'create' ? 'إنشاء' : 'حفظ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
