import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getPayments } from '@/api/payments'
import { formatCurrency, formatDate } from '@/lib/utils'

export default function Payments() {
  const [clientId] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['payments', clientId],
    queryFn: () =>
      getPayments({
        client_id: clientId ? Number(clientId) : undefined,
        limit: 50,
      }),
  })

  const payments = data?.data ?? []

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">سجل المدفوعات</h1>
        <Link
          to="/payments/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
        >
          <Plus className="w-4 h-4" />
          تسجيل دفعة
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
            لا توجد مدفوعات مسجلة.
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
                  <th className="text-right py-3 px-4">طريقة الدفع</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30"
                  >
                    <td className="py-2 px-4">{formatDate(p.payment_date)}</td>
                    <td className="py-2 px-4">—</td>
                    <td className="py-2 px-4">—</td>
                    <td className="py-2 px-4 font-medium">
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="py-2 px-4">{p.payment_method}</td>
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
