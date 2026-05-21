import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, ArrowLeft, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getPayments } from '@/api/payments'
import { formatCurrency, formatDate, normalizeSearchText } from '@/lib/utils'
import { cn } from '@/lib/utils'

export default function Discounts() {
  const [search, setSearch] = useState('')
  const [filterDate, setFilterDate] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['payments', 'discount-only'],
    queryFn: () =>
      getPayments({
        payment_method: 'discount',
        limit: 500,
      }),
  })

  // Hard client-side guard — only show discount records, never cash payments
  // Also sort newest first so the most recent discount is always visible at top
  const allDiscounts = (data?.data ?? [])
    .filter((p) => p.payment_method === 'discount')
    .sort((a, b) => {
      const da = new Date(a.payment_date + 'T00:00:00').getTime()
      const db = new Date(b.payment_date + 'T00:00:00').getTime()
      if (db !== da) return db - da           // newest payment_date first
      return b.id - a.id                      // tie-break: highest id first
    })

  const discounts = useMemo(() => {
    let result = allDiscounts
    const norm = normalizeSearchText(search)
    if (norm) {
      result = result.filter(
        (p) =>
          normalizeSearchText(p.client_name ?? '').includes(norm) ||
          normalizeSearchText(p.barn_name ?? '').includes(norm) ||
          normalizeSearchText(p.notes ?? '').includes(norm)
      )
    }
    if (filterDate) {
      result = result.filter((p) => p.payment_date.startsWith(filterDate))
    }
    return result
  }, [allDiscounts, search, filterDate])

  const activeFilters = (search ? 1 : 0) + (filterDate ? 1 : 0)
  const totalAmount = discounts.reduce((sum, d) => sum + d.amount, 0)

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">سجل الخصومات</h1>
          {!isLoading && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {discounts.length} خصم
              {discounts.length > 0 && (
                <> — إجمالي: <span className="font-semibold text-red-600 dark:text-red-400">{formatCurrency(totalAmount)}</span></>
              )}
            </p>
          )}
        </div>
        <Link
          to="/payments/new?method=discount"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          تسجيل خصم جديد
        </Link>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالعميل أو العنبر أو الملاحظات..."
            className="w-full py-2.5 pr-10 pl-4 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
          />
        </div>
        <div className="relative">
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="w-full sm:w-44 py-2.5 px-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-amber-500 text-sm"
          />
        </div>
        {activeFilters > 0 && (
          <button
            type="button"
            onClick={() => { setSearch(''); setFilterDate('') }}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-4 h-4" />
            مسح الفلاتر
            <span className={cn(
              'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold',
              'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
            )}>
              {activeFilters}
            </span>
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : discounts.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              {activeFilters > 0 ? 'لا توجد نتائج للبحث الحالي' : 'لا توجد خصومات مسجّلة.'}
            </p>
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={() => { setSearch(''); setFilterDate('') }}
                className="text-sm text-amber-600 dark:text-amber-400 hover:underline"
              >
                مسح الفلاتر
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300">
                  <th className="text-right py-3 px-4 font-semibold">التاريخ</th>
                  <th className="text-right py-3 px-4 font-semibold">العميل</th>
                  <th className="text-right py-3 px-4 font-semibold">العنبر</th>
                  <th className="text-right py-3 px-4 font-semibold">قيمة الخصم</th>
                  <th className="text-right py-3 px-4 font-semibold">ملاحظات / السبب</th>
                  <th className="text-right py-3 px-4 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-amber-50/30 dark:hover:bg-amber-900/10 transition-colors"
                  >
                    <td className="py-3 px-4 text-gray-600 dark:text-gray-400">{formatDate(p.payment_date)}</td>
                    <td className="py-3 px-4">
                      {p.client_id ? (
                        <Link
                          to={`/clients/${p.client_id}`}
                          className="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                        >
                          {p.client_name ?? `#${p.client_id}`}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-medium">
                      {p.barn_id != null ? (
                        <Link
                          to={`/barns/${p.barn_id}`}
                          className="text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          {p.barn_name ?? `#${p.barn_id}`}
                        </Link>
                      ) : (
                        <span className="text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-xs font-normal">عام</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-bold text-red-600 dark:text-red-400">
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="py-3 px-4 text-gray-700 dark:text-gray-300 max-w-xs truncate" title={p.notes || ''}>
                      {p.notes || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        to={`/payments/${p.id}`}
                        className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline font-medium text-sm"
                      >
                        عرض التفاصيل
                        <ArrowLeft className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
