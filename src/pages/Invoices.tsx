import { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, ArrowLeft } from 'lucide-react'
import { getInvoices } from '@/api/invoices'
import { getWarehouses } from '@/api/warehouses'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { paymentMethodLabel } from '@/lib/invoicePdf'

export default function Invoices() {
  const [searchParams, setSearchParams] = useSearchParams()
  /** فلترة آجل / كاش حسب payment_method في الفاتورة */
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('')
  const [warehouseId, setWarehouseId] = useState<number | undefined>(undefined)
  const [dateInput, setDateInput] = useState('')
  /** نطاق التاريخ المرسل للـ API (من — إلى) */
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [unpaidOnly, setUnpaidOnly] = useState(false)

  const syncFromUrl = useCallback(() => {
    setPaymentMethodFilter(searchParams.get('payment_method') || '')
    const w = searchParams.get('warehouse_id')
    setWarehouseId(w && w !== '' ? Number(w) : undefined)
    const f = searchParams.get('from') || ''
    const t = searchParams.get('to') || ''
    setFilterFrom(f)
    setFilterTo(t)
    if (f && t && f === t) setDateInput(f)
    else if (f && !t) {
      setDateInput(f)
    }
    setUnpaidOnly(searchParams.get('unpaid') === '1')
  }, [searchParams])

  useEffect(() => {
    syncFromUrl()
  }, [syncFromUrl])

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses,
  })
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', paymentMethodFilter, warehouseId, filterFrom, filterTo, unpaidOnly],
    queryFn: () =>
      getInvoices({
        payment_method: paymentMethodFilter || undefined,
        warehouse_id: warehouseId,
        from: filterFrom || undefined,
        to: filterTo || undefined,
        unpaid: unpaidOnly || undefined,
        limit: 50,
      }),
  })

  function writeUrl(next: {
    payment_method?: string
    warehouse_id?: number | undefined
    from?: string
    to?: string
    unpaid?: boolean
  }) {
    const p = new URLSearchParams(searchParams)
    const setOrDel = (key: string, val: string | undefined) => {
      if (val != null && val !== '') p.set(key, val)
      else p.delete(key)
    }
    if (next.payment_method !== undefined) setOrDel('payment_method', next.payment_method || undefined)
    if (next.warehouse_id !== undefined) {
      if (next.warehouse_id != null && Number.isFinite(next.warehouse_id)) {
        p.set('warehouse_id', String(next.warehouse_id))
      } else p.delete('warehouse_id')
    }
    if (next.from !== undefined) setOrDel('from', next.from || undefined)
    if (next.to !== undefined) setOrDel('to', next.to || undefined)
    if (next.unpaid !== undefined) {
      if (next.unpaid) p.set('unpaid', '1')
      else p.delete('unpaid')
    }
    setSearchParams(p, { replace: true })
  }

  const invoices = data?.data ?? []

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">سجل الفواتير</h1>
        <Link
          to="/invoices/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
        >
          <Plus className="w-4 h-4" />
          فاتورة جديدة
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={paymentMethodFilter}
          onChange={(e) => {
            const v = e.target.value
            setPaymentMethodFilter(v)
            writeUrl({ payment_method: v })
          }}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
        >
          <option value="">جميع الحالات</option>
          <option value="آجل">آجل</option>
          <option value="cash">كاش</option>
        </select>
        <select
          value={warehouseId ?? ''}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : undefined
            setWarehouseId(id)
            writeUrl({ warehouse_id: id })
          }}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
        >
          <option value="">جميع المخازن</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name_ar}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
        />
        <button
          type="button"
          onClick={() => {
            if (!dateInput) return
            setFilterFrom(dateInput)
            setFilterTo(dateInput)
            writeUrl({ from: dateInput, to: dateInput })
          }}
          className="px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 text-sm font-medium"
        >
          بحث بالتاريخ
        </button>
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={unpaidOnly}
            onChange={(e) => {
              const v = e.target.checked
              setUnpaidOnly(v)
              writeUrl({ unpaid: v })
            }}
            className="rounded border-gray-400"
          />
          غير مسددة فقط
        </label>
        {(filterFrom || filterTo || unpaidOnly) && (
          <button
            type="button"
            onClick={() => {
              setDateInput('')
              setFilterFrom('')
              setFilterTo('')
              setUnpaidOnly(false)
              const p = new URLSearchParams(searchParams)
              p.delete('from')
              p.delete('to')
              p.delete('unpaid')
              setSearchParams(p, { replace: true })
            }}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          >
            مسح التاريخ والمتبقي
          </button>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-14 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
              />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <p className="p-8 text-center text-gray-500 dark:text-gray-400">
            لا توجد فواتير. أنشئ فاتورة جديدة.
          </p>
        ) : (
          <div>
            {/* Mobile View: Card List */}
            <div className="grid grid-cols-1 gap-3 p-3 sm:hidden">
              {invoices.map((inv) => (
                <Link
                  key={inv.id}
                  to={`/invoices/${inv.id}`}
                  className="mobile-card"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-bold text-gray-900 dark:text-gray-100 text-base">#{inv.id}</p>
                      <p className="text-gray-500 dark:text-gray-400 text-xs">{formatDate(inv.created_at)}</p>
                    </div>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                      inv.payment_method === 'cash' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    )}>
                      {paymentMethodLabel(inv.payment_method)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="min-w-0">
                      <p className="mobile-card-label">العميل</p>
                      <p className="mobile-card-value truncate">{inv.customer_name}</p>
                    </div>
                    <div>
                      <p className="mobile-card-label">العنبر</p>
                      <p className="mobile-card-value truncate text-gray-700 dark:text-gray-300">
                        {inv.barn_id ? (inv.barn_name ?? `#${inv.barn_id}`) : <span className="text-gray-400 dark:text-gray-600">—</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-between gap-4 pt-1">
                    <div>
                      <p className="mobile-card-label">المجموع</p>
                      <p className="mobile-card-value text-primary-600 dark:text-primary-400">{formatCurrency(inv.total_amount)}</p>
                    </div>
                    <div className="text-left">
                      <p className="mobile-card-label">المدفوع</p>
                      <p className="mobile-card-value">{formatCurrency(inv.paid_amount)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Desktop View: Table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    <th className="text-right py-3.5 px-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">#</th>
                    <th className="text-right py-3.5 px-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">التاريخ</th>
                    <th className="text-right py-3.5 px-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">العميل</th>
                    <th className="text-right py-3.5 px-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">العنبر</th>
                    <th className="text-right py-3.5 px-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">المجموع</th>
                    <th className="text-right py-3.5 px-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">المدفوع</th>
                    <th className="text-right py-3.5 px-4 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">النوع</th>
                    <th className="text-right py-3.5 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium">{inv.id}</td>
                      <td className="py-3 px-4 text-gray-500 dark:text-gray-400">{formatDate(inv.created_at)}</td>
                      <td className="py-3 px-4 font-medium">
                        {inv.client_id ? (
                          <Link
                            to={`/clients/${inv.client_id}`}
                            className="text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            {inv.customer_name}
                          </Link>
                        ) : (
                          inv.customer_name
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {inv.barn_id ? (
                          <Link
                            to={`/barns/${inv.barn_id}`}
                            className="text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            {inv.barn_name ?? `#${inv.barn_id}`}
                          </Link>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-primary-600 dark:text-primary-400 font-bold">{formatCurrency(inv.total_amount)}</td>
                      <td className="py-3 px-4">{formatCurrency(inv.paid_amount)}</td>
                      <td className="py-3 px-4">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-xs font-medium",
                          inv.payment_method === 'cash' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        )}>
                          {paymentMethodLabel(inv.payment_method)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left">
                        <Link
                          to={`/invoices/${inv.id}`}
                          className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline font-medium"
                        >
                          عرض
                          <ArrowLeft className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
