import { Link } from 'react-router-dom'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { AccountStatementRow } from '@/types/api'

function cellMoney(n: number | undefined) {
  const v = Number(n) || 0
  if (v <= 0) return '—'
  return formatCurrency(v)
}

export default function AccountStatementTable({
  rows,
  isLoading,
}: {
  rows: AccountStatementRow[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="p-8 animate-pulse space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
        ))}
      </div>
    )
  }

  if (!rows.length) {
    return (
      <p className="p-8 text-center text-gray-500 dark:text-gray-400">
        لا توجد حركات في الفترة المحددة
      </p>
    )
  }

  return (
    <table className="w-full text-sm min-w-[760px]">
      <thead>
        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
          <th className="text-right py-3 px-3 whitespace-nowrap">التاريخ</th>
          <th className="text-right py-3 px-3 whitespace-nowrap">النوع</th>
          <th className="text-right py-3 px-3 whitespace-nowrap min-w-[7rem]">العنبر</th>
          <th className="text-right py-3 px-3">البيان</th>
          <th className="text-right py-3 px-3 whitespace-nowrap">مدين</th>
          <th className="text-right py-3 px-3 whitespace-nowrap">دائن</th>
          <th className="text-right py-3 px-3 whitespace-nowrap">إجمالي الفاتورة</th>
          <th className="text-right py-3 px-3 whitespace-nowrap">المدفوع</th>
          <th className="text-right py-3 px-3 whitespace-nowrap">المتبقي</th>
          <th className="text-right py-3 px-3 whitespace-nowrap">الرصيد</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const dd = row.display_debit ?? row.debit
          const dc = row.display_credit ?? row.credit
          return (
            <tr
              key={
                row.type === 'invoice' && row.invoice_id != null
                  ? `inv-${row.invoice_id}`
                  : row.type === 'payment' && row.payment_id != null
                    ? `pay-${row.payment_id}-${i}`
                    : `row-${i}`
              }
              className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30"
            >
              <td className="py-2 px-3 whitespace-nowrap">{formatDate(row.date)}</td>
              <td className="py-2 px-3 whitespace-nowrap">
                {row.type === 'invoice' ? 'فاتورة' : 'دفعة'}
              </td>
              <td className="py-2 px-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                {row.barn_name ? (
                  <span className="font-medium text-gray-800 dark:text-gray-200">{row.barn_name}</span>
                ) : (
                  '—'
                )}
              </td>
              <td className="py-2 px-3">
                {row.type === 'invoice' && row.invoice_id != null ? (
                  <div>
                    <Link
                      to={`/invoices/${row.invoice_id}`}
                      className="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                    >
                      فاتورة #{row.invoice_id}
                    </Link>
                    {row.items && row.items.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {row.items.map((item, idx) => (
                          <li key={idx} className="flex items-center gap-1">
                            <span className="text-gray-400 dark:text-gray-500">·</span>
                            <span>{item.product_name}</span>
                            <span className="text-gray-400 dark:text-gray-500">×{item.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <span>
                    {row.description}
                    {row.payment_method === 'deferred' && row.settled_at ? (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 mr-2">(مُسدَّد)</span>
                    ) : null}
                  </span>
                )}
              </td>
              <td className="py-2 px-3 whitespace-nowrap">{cellMoney(dd)}</td>
              <td className="py-2 px-3 whitespace-nowrap">{cellMoney(dc)}</td>
              <td className="py-2 px-3 whitespace-nowrap">
                {row.type === 'invoice' ? formatCurrency(row.invoice_total ?? row.debit) : '—'}
              </td>
              <td className="py-2 px-3 whitespace-nowrap">
                {row.type === 'invoice' ? formatCurrency(row.paid ?? 0) : '—'}
              </td>
              <td className="py-2 px-3 whitespace-nowrap">
                {row.type === 'invoice' ? formatCurrency(row.remaining ?? 0) : '—'}
              </td>
              <td className="py-2 px-3 font-medium whitespace-nowrap">{formatCurrency(row.balance)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
