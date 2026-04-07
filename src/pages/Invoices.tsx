import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, ArrowLeft } from 'lucide-react'
import { getInvoices } from '@/api/invoices'
import { getWarehouses } from '@/api/warehouses'
import { formatCurrency, formatDate } from '@/lib/utils'

export default function Invoices() {
  const [status, setStatus] = useState('')
  const [warehouseId, setWarehouseId] = useState<number | undefined>(undefined)
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses,
  })
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', status, warehouseId],
    queryFn: () =>
      getInvoices({
        status: status || undefined,
        warehouse_id: warehouseId,
        limit: 50,
      }),
  })

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
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
        >
          <option value="">جميع الحالات</option>
          <option value="معلق">معلق</option>
          <option value="مدفوعة">مدفوعة</option>
          <option value="جزئي">جزئي</option>
          <option value="مكتمل">مكتمل</option>
        </select>
        <select
          value={warehouseId ?? ''}
          onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : undefined)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
        >
          <option value="">جميع المخازن</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name_ar}
            </option>
          ))}
        </select>
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="text-right py-3 px-4">#</th>
                  <th className="text-right py-3 px-4">التاريخ</th>
                  <th className="text-right py-3 px-4">العميل</th>
                  <th className="text-right py-3 px-4">المجموع</th>
                  <th className="text-right py-3 px-4">المدفوع</th>
                  <th className="text-right py-3 px-4">الحالة</th>
                  <th className="text-right py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30"
                  >
                    <td className="py-2 px-4 font-medium">{inv.id}</td>
                    <td className="py-2 px-4">{formatDate(inv.created_at)}</td>
                    <td className="py-2 px-4">{inv.customer_name}</td>
                    <td className="py-2 px-4">{formatCurrency(inv.total_amount)}</td>
                    <td className="py-2 px-4">{formatCurrency(inv.paid_amount)}</td>
                    <td className="py-2 px-4">{inv.status}</td>
                    <td className="py-2 px-4">
                      <Link
                        to={`/invoices/${inv.id}`}
                        className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline"
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
