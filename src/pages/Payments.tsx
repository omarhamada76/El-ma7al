import { useQuery } from '@tanstack/react-query'
import { Plus, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getPayments } from '@/api/payments'
import { formatCurrency, formatDate } from '@/lib/utils'
import { paymentMethodLabel } from '@/lib/invoicePdf'

export default function Payments() {
  const { data, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: () =>
      getPayments({
        limit: 50,
      }),
  })

  const payments = data?.data ?? []

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">سجل السداد</h1>
        <Link
          to="/payments/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
        >
          <Plus className="w-4 h-4" />
          تسجيل سداد
        </Link>
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
        ) : payments.length === 0 ? (
          <p className="p-8 text-center text-gray-500 dark:text-gray-400">
            لا يوجد سداد مسجّل.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="text-right py-3 px-4">التاريخ</th>
                  <th className="text-right py-3 px-4">العميل</th>
                  <th className="text-right py-3 px-4">العنبر</th>
                  <th className="text-right py-3 px-4">المبلغ</th>
                  <th className="text-right py-3 px-4">طريقة السداد</th>
                  <th className="text-right py-3 px-4 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30"
                  >
                    <td className="py-2 px-4">{formatDate(p.payment_date)}</td>
                    <td className="py-2 px-4">
                      {p.client_id ? (
                        <Link
                          to={`/clients/${p.client_id}`}
                          className="text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          {p.client_name ?? `#${p.client_id}`}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      {p.barn_id != null ? (
                        <Link
                          to={`/barns/${p.barn_id}`}
                          className="text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          {p.barn_name ?? `#${p.barn_id}`}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-4 font-medium">
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="py-2 px-4">{paymentMethodLabel(p.payment_method)}</td>
                    <td className="py-2 px-4">
                      <Link
                        to={`/payments/${p.id}`}
                        className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline text-sm"
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
        )}
      </div>
    </div>
  )
}
