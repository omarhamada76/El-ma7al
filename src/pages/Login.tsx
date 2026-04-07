import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { login, getAuthStatus, bootstrapAdmin } from '@/api/auth'
import { cn } from '@/lib/utils'

export default function Login() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await getAuthStatus()
        if (!cancelled) setNeedsBootstrap(s.needsBootstrap)
      } catch {
        if (!cancelled) setNeedsBootstrap(false)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('يرجى إدخال البريد الإلكتروني وكلمة المرور')
      return
    }
    if (needsBootstrap) {
      if (password.length < 8) {
        setError('كلمة المرور 8 أحرف على الأقل لحساب المسؤول الأول')
        return
      }
    } else if (password.length < 6) {
      setError('كلمة المرور 6 أحرف على الأقل')
      return
    }
    setLoading(true)
    try {
      const res = needsBootstrap
        ? await bootstrapAdmin({
            email: email.trim(),
            password,
            display_name: displayName.trim() || undefined,
          })
        : await login({ email: email.trim(), password })
      setAuth(res.accessToken, res.refreshToken ?? null, res.user, remember)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدخول')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="w-full max-w-md mx-auto px-2 text-center text-gray-500 dark:text-gray-400 py-12">
        جاري التحقق...
      </div>
    )
  }

  return (
    <div className="w-full max-w-md mx-auto px-2 sm:px-0">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-5 sm:p-8 border border-gray-200 dark:border-gray-700">
        <h1 className="text-2xl font-bold text-center mb-2">
          {needsBootstrap ? 'إنشاء حساب المسؤول الأول' : 'تسجيل الدخول'}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-center text-sm mb-6">
          {needsBootstrap
            ? 'لا يوجد مستخدمون بعد. أنشئ حساب المسؤول ثم سجّل الدخول لاحقاً من هذه الشاشة.'
            : 'لوحة تحكم الصيدلية البيطرية'}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
          {needsBootstrap && (
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium mb-1">
                الاسم المعروض
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={cn(
                  'w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-900',
                  'border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100',
                  'focus:ring-2 focus:ring-primary-500 focus:border-transparent'
                )}
                placeholder="مدير النظام"
                dir="rtl"
              />
            </div>
          )}
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              البريد الإلكتروني
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(
                'w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-900',
                'border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100',
                'focus:ring-2 focus:ring-primary-500 focus:border-transparent'
              )}
              placeholder="admin@example.com"
              autoComplete="email"
              dir="ltr"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              {needsBootstrap ? 'كلمة المرور (8 أحرف على الأقل)' : 'كلمة المرور'}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(
                'w-full px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-900',
                'border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100',
                'focus:ring-2 focus:ring-primary-500 focus:border-transparent'
              )}
              placeholder="••••••••"
              autoComplete={needsBootstrap ? 'new-password' : 'current-password'}
              dir="ltr"
              required
            />
          </div>
          {!needsBootstrap && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm">تذكرني</span>
            </label>
          )}
          <button
            type="submit"
            disabled={loading}
            className={cn(
              'w-full py-2.5 rounded-lg font-medium text-white',
              'bg-primary-600 hover:bg-primary-700 focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {loading
              ? needsBootstrap
                ? 'جاري الإنشاء...'
                : 'جاري الدخول...'
              : needsBootstrap
                ? 'إنشاء الحساب والدخول'
                : 'تسجيل الدخول'}
          </button>
        </form>
        {!needsBootstrap && (
          <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
            <button type="button" className="hover:underline">
              نسيت كلمة المرور؟
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
