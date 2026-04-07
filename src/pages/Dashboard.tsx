import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  PlusCircle,
  Receipt,
  CreditCard,
  FileSpreadsheet,
  Search,
  PackagePlus,
  PackageCheck,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  ArrowUpRight,
} from 'lucide-react'
import { getRecentInvoices } from '@/api/dashboard'
import { getClients } from '@/api/clients'
import { formatCurrency, formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import Modal from '@/components/Modal'
import { useAuthStore } from '@/stores/auth'
import { canViewFinancials } from '@/lib/roles'

type QuickActionBase = {
  key: string
  label: string
  hint: string
  icon: typeof PlusCircle
  color: string
  light: string
}

type QuickActionLink = QuickActionBase & {
  kind: 'link'
  to: string
}

type QuickActionButton = QuickActionBase & {
  kind: 'button'
}

type QuickAction = QuickActionLink | QuickActionButton

const quickActionDefinitions: QuickAction[] = [
  {
    kind: 'link',
    key: 'invoice_new',
    to: '/invoices/new',
    label: 'فاتورة بيع جديدة',
    hint: 'فتح صفحة الفاتورة',
    icon: PlusCircle,
    color: 'bg-emerald-500',
    light: 'bg-emerald-50 dark:bg-emerald-900/20',
  },
  {
    kind: 'link',
    key: 'invoices_list',
    to: '/invoices',
    label: 'سجل الفواتير',
    hint: 'عرض كل الفواتير',
    icon: Receipt,
    color: 'bg-teal-500',
    light: 'bg-teal-50 dark:bg-teal-900/20',
  },
  {
    kind: 'link',
    key: 'payment_new',
    to: '/payments/new',
    label: 'تسجيل دفعة عميل',
    hint: 'تسجيل دفعة',
    icon: CreditCard,
    color: 'bg-blue-500',
    light: 'bg-blue-50 dark:bg-blue-900/20',
  },
  {
    kind: 'button',
    key: 'account_statement',
    label: 'كشف الحساب',
    hint: 'اختر عميلاً',
    icon: FileSpreadsheet,
    color: 'bg-indigo-500',
    light: 'bg-indigo-50 dark:bg-indigo-900/20',
  },
  {
    kind: 'link',
    key: 'add_product',
    to: '/inventory?add=1',
    label: 'إضافة منتج',
    hint: 'فتح نموذج منتج جديد',
    icon: PackagePlus,
    color: 'bg-sky-500',
    light: 'bg-sky-50 dark:bg-sky-900/20',
  },
  {
    kind: 'link',
    key: 'receipt',
    to: '/receipt/new',
    label: 'استلام البضاعة',
    hint: 'تسجيل استلام',
    icon: PackageCheck,
    color: 'bg-amber-500',
    light: 'bg-amber-50 dark:bg-amber-900/20',
  },
]

type InvoicesWindowMode = 'docked' | 'minimized' | 'maximized'

export default function Dashboard() {
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.user?.role)
  const showFinancials = canViewFinancials(role)
  const [accountStatementOpen, setAccountStatementOpen] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [invoicesWindowMode, setInvoicesWindowMode] = useState<InvoicesWindowMode>('minimized')
  const { data: recentInvoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ['invoices', 'recent'],
    queryFn: getRecentInvoices,
  })
  const { data: clientsData, isLoading: clientsLoading } = useQuery({
    queryKey: ['clients', 'list'],
    queryFn: () => getClients({ limit: 200 }),
    enabled: accountStatementOpen,
  })
  const clients = clientsData?.data ?? []
  const quickActions = showFinancials
    ? quickActionDefinitions
    : quickActionDefinitions.filter((a) => a.key !== 'account_statement')
  const searchNorm = clientSearch.trim().toLowerCase()
  const filteredClients = searchNorm
    ? clients.filter(
        (c) =>
          c.name.toLowerCase().includes(searchNorm) ||
          (c.phone ?? '').toLowerCase().includes(searchNorm)
      )
    : clients

  const cardClass = (light: string) =>
    cn(
      'rounded-lg sm:rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden',
      'transition-colors hover:border-primary-400 dark:hover:border-primary-600',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900',
      'text-right w-full block',
      light
    )

  useEffect(() => {
    if (invoicesWindowMode !== 'maximized') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInvoicesWindowMode('minimized')
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [invoicesWindowMode])

  const arrowBtn =
    'inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-primary-100/80 dark:text-gray-300 dark:hover:bg-primary-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500'

  const recentSubtitle =
    invoicesLoading
      ? 'جاري التحميل…'
      : recentInvoices.length === 0
        ? 'لا توجد فواتير حديثة'
        : `${Math.min(5, recentInvoices.length)} من أحدث الفواتير`

  const invoicesListSection = (
    <>
      {invoicesLoading ? (
        <div className="space-y-2 p-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 rounded-xl bg-gray-100 dark:bg-gray-700/60 animate-pulse"
            />
          ))}
        </div>
      ) : recentInvoices.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-700/50 text-gray-400">
            <Receipt className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">لا توجد فواتير حديثة</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">ستظهر آخر الفواتير هنا بعد البيع</p>
        </div>
      ) : (
        <ul className="space-y-1.5 p-2 sm:p-3">
          {recentInvoices.slice(0, 5).map((inv) => (
            <li key={inv.id}>
              <Link
                to={`/invoices/${inv.id}`}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-3 sm:px-4',
                  'transition-all hover:border-primary-200/60 hover:bg-primary-50/50 dark:hover:border-primary-800/40 dark:hover:bg-primary-900/20',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900'
                )}
              >
                <div className="min-w-0 text-right">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">#{inv.id}</p>
                  <p className="truncate text-sm text-gray-500 dark:text-gray-400">{inv.customer_name}</p>
                </div>
                <div className="shrink-0 text-left">
                  <p className="font-semibold tabular-nums text-primary-700 dark:text-primary-300">
                    {formatCurrency(inv.total_amount)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(inv.created_at)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  const invoicesWindowHeader = (variant: 'docked' | 'overlay') => (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-gray-200/80 bg-gradient-to-l from-gray-50/95 to-white dark:border-gray-600/80 dark:from-gray-800 dark:to-gray-800/90',
        variant === 'overlay' ? 'shrink-0 border-b px-4 py-3.5' : 'border-b px-4 py-3.5'
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300'
          )}
        >
          <Receipt className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 text-right">
          <h2 id="invoices-window-title" className="text-base font-bold text-gray-900 dark:text-gray-100 sm:text-lg">
            آخر الفواتير
          </h2>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{recentSubtitle}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-2">
        <div className="flex items-center gap-0.5 rounded-full bg-gray-100/80 p-0.5 dark:bg-gray-900/50" role="group" aria-label="تحكم النافذة">
          {variant === 'docked' ? (
            <>
              <button
                type="button"
                className={arrowBtn}
                onClick={() => setInvoicesWindowMode('minimized')}
                title="طي القائمة"
                aria-label="طي القائمة"
              >
                <ChevronUp className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                className={arrowBtn}
                onClick={() => setInvoicesWindowMode('maximized')}
                title="تكبير في نافذة"
                aria-label="تكبير في نافذة منبثقة"
              >
                <ArrowUpRight className="h-5 w-5" aria-hidden />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={arrowBtn}
                onClick={() => setInvoicesWindowMode('docked')}
                title="العودة للوحة"
                aria-label="إغلاق النافذة المنبثقة وعرض القائمة في اللوحة"
              >
                <ChevronDown className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                className={arrowBtn}
                onClick={() => setInvoicesWindowMode('minimized')}
                title="طي إلى الشريط"
                aria-label="إغلاق النافذة المنبثقة والطي إلى الشريط"
              >
                <ChevronUp className="h-5 w-5" aria-hidden />
              </button>
            </>
          )}
        </div>
        <Link
          to="/invoices"
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/30"
        >
          عرض الكل
        </Link>
      </div>
    </div>
  )

  return (
    <div className="space-y-8" dir="rtl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">لوحة التحكم</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          {showFinancials
            ? 'اختصارات العمل اليومي والوصول السريع'
            : 'اختصارات العمل اليومي (فواتير، مخزون، مدفوعات)'}
        </p>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">إجراءات سريعة</h2>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon
            const inner = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400">
                    {action.label}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5 sm:mt-1 line-clamp-2">
                    {action.hint}
                  </p>
                </div>
                <div className={cn('p-1.5 sm:p-2 rounded-lg text-white flex-shrink-0', action.color)}>
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden />
                </div>
              </>
            )
            if (action.kind === 'link') {
              return (
                <Link
                  key={action.key}
                  to={action.to}
                  className={cardClass(action.light)}
                  aria-label={`${action.label} — ${action.hint}`}
                >
                  <div className="p-2.5 sm:p-4 flex items-start justify-between gap-2">{inner}</div>
                </Link>
              )
            }
            return (
              <button
                key={action.key}
                type="button"
                onClick={() => setAccountStatementOpen(true)}
                className={cardClass(action.light)}
                aria-label={`${action.label} — ${action.hint}`}
              >
                <div className="p-2.5 sm:p-4 flex items-start justify-between gap-2">{inner}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            امسح الباركود لفتح فاتورة جديدة وإضافة المنتج:
          </p>
          <input
            type="text"
            placeholder="امسح الباركود هنا..."
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-primary-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = (e.target as HTMLInputElement).value?.trim()
                if (v) {
                  ;(e.target as HTMLInputElement).value = ''
                  navigate(`/invoices/new?barcode=${encodeURIComponent(v)}`)
                }
              }
            }}
          />
          <Modal
            open={accountStatementOpen}
            onClose={() => {
              setAccountStatementOpen(false)
              setClientSearch('')
            }}
            title="كشف الحساب — اختر العميل"
          >
            {clientsLoading ? (
              <p className="text-gray-500 dark:text-gray-400 py-4">جاري تحميل العملاء...</p>
            ) : clients.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 py-4">لا يوجد عملاء. أضف عميلاً أولاً.</p>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 pb-3 ps-2 pe-1">
                  <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="بحث بالاسم أو رقم الهاتف..."
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 py-2 ps-2 pe-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
                    autoFocus
                  />
                </div>
                <ul className="space-y-1 max-h-80 overflow-y-auto">
                  {filteredClients.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAccountStatementOpen(false)
                          navigate(`/clients/${c.id}/account-statement`)
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-right',
                          'hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
                        )}
                      >
                        <span className="font-medium">{c.name}</span>
                        <ArrowLeft className="w-4 h-4 text-gray-400" />
                      </button>
                    </li>
                  ))}
                </ul>
                {filteredClients.length === 0 && searchNorm && (
                  <p className="text-gray-500 dark:text-gray-400 py-4 text-center">
                    لا توجد نتائج لـ «{clientSearch.trim()}»
                  </p>
                )}
              </>
            )}
          </Modal>
        </div>

        <div className="lg:col-span-2">
          {invoicesWindowMode === 'minimized' ? (
            <div
              className={cn(
                'overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-md shadow-gray-200/40',
                'ring-1 ring-black/[0.03] dark:border-gray-600 dark:bg-gray-800 dark:shadow-none dark:ring-white/10'
              )}
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:py-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                      'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300'
                    )}
                  >
                    <Receipt className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 text-right">
                    <p className="font-bold text-gray-900 dark:text-gray-100">آخر الفواتير</p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">{recentSubtitle}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-gray-100/90 p-0.5 dark:bg-gray-900/60">
                  <button
                    type="button"
                    className={arrowBtn}
                    onClick={() => setInvoicesWindowMode('docked')}
                    title="توسيع القائمة"
                    aria-label="توسيع القائمة في اللوحة"
                  >
                    <ChevronDown className="h-5 w-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={arrowBtn}
                    onClick={() => setInvoicesWindowMode('maximized')}
                    title="نافذة منبثقة"
                    aria-label="فتح في نافذة منبثقة"
                  >
                    <ArrowUpRight className="h-5 w-5" aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          ) : invoicesWindowMode === 'docked' ? (
            <div
              className={cn(
                'overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-lg shadow-gray-200/35',
                'ring-1 ring-black/[0.03] dark:border-gray-600 dark:bg-gray-800 dark:shadow-none dark:ring-white/10'
              )}
            >
              {invoicesWindowHeader('docked')}
              <div className="bg-white dark:bg-gray-800">{invoicesListSection}</div>
            </div>
          ) : (
            <div
              className={cn(
                'flex items-center justify-between gap-3 rounded-2xl border border-dashed border-primary-200/70 bg-primary-50/40 px-4 py-3.5',
                'dark:border-primary-800/50 dark:bg-primary-900/20'
              )}
            >
              <div className="flex min-w-0 items-center gap-2 text-right">
                <span className="flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary-500" aria-hidden />
                <span className="text-sm font-medium text-primary-800 dark:text-primary-200">
                  القائمة مفتوحة في نافذة منبثقة
                </span>
              </div>
              <button
                type="button"
                className={arrowBtn}
                onClick={() => setInvoicesWindowMode('minimized')}
                title="إغلاق المنبثقة والطي"
                aria-label="إغلاق النافذة المنبثقة"
              >
                <ChevronDown className="h-5 w-5" aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>

      {invoicesWindowMode === 'maximized' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/40 dark:bg-black/50 backdrop-blur-[2px]"
            role="presentation"
            onClick={() => setInvoicesWindowMode('minimized')}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="invoices-window-title"
              className={cn(
                'flex max-h-[min(88vh,760px)] w-full max-w-2xl flex-col overflow-hidden',
                'rounded-2xl border border-gray-200/90 bg-white shadow-2xl ring-1 ring-black/5',
                'dark:border-gray-600 dark:bg-gray-800 dark:ring-white/10'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {invoicesWindowHeader('overlay')}
              <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50/30 dark:bg-gray-900/20">
                {invoicesListSection}
              </div>
              <p className="border-t border-gray-200/80 bg-gray-50/90 px-4 py-2.5 text-xs text-gray-500 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
                Escape أو خارج النافذة: طي إلى الشريط — السهم للأسفل: عرض في اللوحة
              </p>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
