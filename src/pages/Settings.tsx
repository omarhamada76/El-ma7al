import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'
import { User, Moon, Sun, Percent, FileText } from 'lucide-react'

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()
  const [dark, setDark] = useState(false)

  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.get<Record<string, string>>('/settings'),
  })
  const [markupDraft, setMarkupDraft] = useState('')
  const [invoiceEditDaysDraft, setInvoiceEditDaysDraft] = useState('7')
  useEffect(() => {
    if (appSettings?.default_markup_percent != null) setMarkupDraft(appSettings.default_markup_percent)
  }, [appSettings?.default_markup_percent])
  useEffect(() => {
    if (appSettings?.invoice_edit_window_days != null) {
      setInvoiceEditDaysDraft(appSettings.invoice_edit_window_days)
    }
  }, [appSettings?.invoice_edit_window_days])

  const saveMarkup = useMutation({
    mutationFn: (val: string) => api.patch('/settings', { default_markup_percent: val }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
  })

  const saveInvoiceEditWindow = useMutation({
    mutationFn: (val: string) => api.patch('/settings', { invoice_edit_window_days: val }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['app-settings'] }),
  })

  function toggleDark() {
    document.documentElement.classList.toggle('dark', !dark)
    setDark(!dark)
  }

  return (
    <div className="space-y-8 max-w-xl" dir="rtl">
      <h1 className="text-2xl font-bold">الإعدادات</h1>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <User className="w-5 h-5" />
          الملف الشخصي
        </h2>
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-gray-500 dark:text-gray-400">البريد: </span>
            <span className="font-medium" dir="ltr">{user?.email}</span>
          </p>
          <p>
            <span className="text-gray-500 dark:text-gray-400">الاسم: </span>
            <span className="font-medium">{user?.display_name ?? '—'}</span>
          </p>
          <p>
            <span className="text-gray-500 dark:text-gray-400">الدور: </span>
            <span className="font-medium">{user?.role}</span>
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          {dark ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          المظهر
        </h2>
        <button
          type="button"
          onClick={toggleDark}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
        >
          {dark ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
        </button>
      </section>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5" />
          إعدادات الفواتير
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          يمكن تعديل الفاتورة خلال هذه المدة من تاريخ إنشائها
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            saveInvoiceEditWindow.mutate(invoiceEditDaysDraft)
          }}
        >
          <div>
            <label htmlFor="invoice-edit-window" className="block text-sm font-medium mb-1">
              مدة السماح بتعديل الفاتورة
            </label>
            <div className="flex items-center gap-2">
              <input
                id="invoice-edit-window"
                type="number"
                min={1}
                max={365}
                step={1}
                value={invoiceEditDaysDraft}
                onChange={(e) => setInvoiceEditDaysDraft(e.target.value)}
                className="w-24 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">يوم</span>
            </div>
          </div>
          <button
            type="submit"
            disabled={
              saveInvoiceEditWindow.isPending ||
              invoiceEditDaysDraft === (appSettings?.invoice_edit_window_days ?? '')
            }
            className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium text-sm disabled:opacity-50"
          >
            حفظ
          </button>
          {saveInvoiceEditWindow.isSuccess && (
            <span className="text-sm text-green-600">تم الحفظ</span>
          )}
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Percent className="w-5 h-5" />
          نسبة الربح التلقائية
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          عند استلام بضاعة جديدة، يُحسب سعر البيع تلقائياً من سعر الشراء + هذه النسبة.
        </p>
        <form
          className="flex items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            saveMarkup.mutate(markupDraft)
          }}
        >
          <div className="relative">
            <input
              type="number"
              min={0}
              max={1000}
              step="any"
              value={markupDraft}
              onChange={(e) => setMarkupDraft(e.target.value)}
              className="w-24 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm pl-8"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
          </div>
          <button
            type="submit"
            disabled={saveMarkup.isPending || markupDraft === (appSettings?.default_markup_percent ?? '')}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium text-sm disabled:opacity-50"
          >
            حفظ
          </button>
          {saveMarkup.isSuccess && <span className="text-sm text-green-600">تم الحفظ</span>}
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-2">تسجيل الخروج</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          سيتم تسجيل خروجك من الجهاز الحالي.
        </p>
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault()
            useAuthStore.getState().logout()
            window.location.href = '/login'
          }}
          className="inline-block px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium"
        >
          تسجيل الخروج
        </a>
      </section>
    </div>
  )
}
