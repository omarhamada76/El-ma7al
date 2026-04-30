import { Link } from 'react-router-dom'
import {
  cn,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatStatementDate,
  formatStatementPaymentMethod,
  formatStatementRunningBalanceText,
  statementLineTotal,
  statementLineUnitPrice,
} from '@/lib/utils'
import type { AccountStatementRow } from '@/types/api'

function cellQty(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return formatNumber(n, 3)
}

function cellUnitPrice(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return formatCurrency(n)
}

function cellLineTotal(item: { quantity: number; total_price?: number }) {
  const t = statementLineTotal(item)
  if (t == null || !Number.isFinite(Number(t))) return '—'
  return formatCurrency(t)
}

const badgeBase =
  'inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium leading-normal shrink-0'

export default function AccountStatementTable({
  rows,
  isLoading,
}: {
  rows: AccountStatementRow[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div
        className="w-full min-w-[34rem] sm:min-w-[40rem] py-2 px-3 sm:px-0 animate-pulse space-y-3"
        aria-busy="true"
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 bg-gray-200 dark:bg-gray-700 rounded-md" />
        ))}
      </div>
    )
  }

  if (!rows.length) {
    return (
      <p className="py-10 sm:py-12 px-3 sm:px-0 text-center text-gray-500 dark:text-gray-400 text-right text-sm sm:text-base">
        لا توجد حركات في الفترة المحددة
      </p>
    )
  }

  /** Sticky `<thead>` scrolls with dashboard `<main>`; avoid wrapping this table in `overflow-x-auto` or sticky breaks. */
  const thClass = cn(
    'text-right py-2.5 px-2 sm:py-4 sm:px-3 align-bottom text-xs sm:text-sm',
    'bg-gray-50 dark:bg-gray-800',
    'border-b border-gray-200 dark:border-gray-700',
    'shadow-[0_1px_0_0_rgb(229_231_235)] dark:shadow-[0_1px_0_0_rgb(55_65_81)]'
  )

  const tdPad = 'py-2.5 px-2 sm:py-3.5 sm:px-3'

  return (
    <div className="w-full min-w-[34rem] sm:min-w-[40rem]">
      <div className="sm:hidden w-full px-3 pb-2 box-border">
        <p className="block w-full text-[11px] text-gray-500 dark:text-gray-400 text-right leading-snug rounded-md border border-gray-100 dark:border-gray-700/80 bg-gray-50/90 dark:bg-gray-900/40 px-2.5 py-1.5">
          مرّر أفقياً لعرض جميع أعمدة الجدول
        </p>
      </div>
      <table
        className="w-full text-xs sm:text-sm min-w-[34rem] sm:min-w-[40rem] text-right border-separate border-spacing-0"
        dir="rtl"
      >
        <thead className="sticky top-0 z-20">
          <tr>
            <th className={cn(thClass, 'whitespace-nowrap')}>التاريخ</th>
            <th className={cn(thClass, 'whitespace-nowrap')}>النوع</th>
            <th className={cn(thClass, 'min-w-[8.5rem] sm:min-w-[10rem]')}>البيان</th>
            <th className={cn(thClass, 'whitespace-nowrap')}>الكمية</th>
            <th className={cn(thClass, 'whitespace-nowrap')}>سعر الوحدة</th>
            <th className={cn(thClass, 'whitespace-nowrap')}>الإجمالي</th>
            <th className={cn(thClass, 'whitespace-nowrap text-center')}>إجمالي الفاتورة</th>
            <th className={cn(thClass, 'whitespace-nowrap')}>الرصيد النهائي</th>
          </tr>
        </thead>
        <tbody
          className={cn(
            '[&_tr:not(:first-child)_td]:border-t-2 [&_tr:not(:first-child)_td]:border-t-gray-400 dark:[&_tr:not(:first-child)_td]:border-t-gray-500',
            '[&_tr:last-child_td]:border-b [&_tr:last-child_td]:border-gray-200 dark:[&_tr:last-child_td]:border-gray-700/80'
          )}
        >
          {rows.map((row, i) => {
            const isInv = row.type === 'invoice'
            const isDeferredLikePayment =
              !isInv &&
              (row.payment_method === 'deferred' ||
                row.payment_method === 'آجل' ||
                row.payment_method === 'credit')
            const rb = Number(row.running_balance)
            const rbNeg = Number.isFinite(rb) && rb < 0
            const rbCls = rbNeg ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
            const amtCls =
              row.direction === 'debit'
                ? 'text-red-700 dark:text-red-300 font-medium'
                : 'text-emerald-700 dark:text-emerald-400 font-medium'
            const rowBg = isInv ? 'bg-red-500/[0.05]' : 'bg-green-500/[0.05]'
            const trClass = cn(
              'hover:brightness-[0.98] transition-all duration-200',
              rowBg
            )
            const baseKey =
              row.type === 'invoice' && row.invoice_id != null
                ? `inv-${row.invoice_id}`
                : row.type === 'payment' && row.payment_id != null
                  ? `pay-${row.payment_id}-${i}`
                  : `row-${row.id}-${i}`

            const typeBadge = isInv ? (
              <span className={cn(badgeBase, 'bg-amber-500 text-white')}>فاتورة</span>
            ) : isDeferredLikePayment ? (
              <span className={cn(badgeBase, 'bg-slate-500 text-white')}>آجل</span>
            ) : (
              <span className={cn(badgeBase, 'bg-green-600 text-white')}>سداد</span>
            )

            const itemDivider = 'border-b border-gray-200 dark:border-gray-600 pb-2 mb-2 last:border-b-0 last:pb-0 last:mb-0'

            if (isInv && row.items && row.items.length > 0) {
              const lines = row.items.map((item, idx) => (
                <div key={idx} className={cn('text-right', itemDivider)}>
                  <span
                    className={cn(
                      'text-xs sm:text-sm leading-snug break-words',
                      row.invoice_id != null
                        ? 'text-primary-600 dark:text-primary-400'
                        : 'text-gray-900 dark:text-gray-100'
                    )}
                  >
                    {item.product_name}
                  </span>
                </div>
              ))
              const qtyLines = row.items.map((item, idx) => (
                <div key={idx} className={cn('tabular-nums whitespace-nowrap', itemDivider)}>
                  {cellQty(item.quantity)}
                </div>
              ))
              const unitLines = row.items.map((item, idx) => (
                <div key={idx} className={cn('tabular-nums whitespace-nowrap', itemDivider)}>
                  {cellUnitPrice(statementLineUnitPrice(item))}
                </div>
              ))
              const totalLines = row.items.map((item, idx) => (
                <div key={idx} className={cn('tabular-nums whitespace-nowrap', itemDivider, amtCls)}>
                  {cellLineTotal(item)}
                </div>
              ))

              const descStack =
                row.invoice_id != null ? (
                  <Link
                    to={`/invoices/${row.invoice_id}`}
                    className="block w-full text-right text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    {lines}
                  </Link>
                ) : (
                  lines
                )

              return (
                <tr key={baseKey} className={trClass}>
                  <td
                    className={cn(tdPad, 'whitespace-nowrap align-top')}
                    title={row.sort_at ? formatDateTime(row.sort_at) : undefined}
                  >
                    {formatStatementDate(row.date)}
                  </td>
                  <td className={cn(tdPad, 'align-top')}>{typeBadge}</td>
                  <td className={cn(tdPad, 'align-top text-right max-w-[14rem] sm:max-w-none')}>{descStack}</td>
                  <td className={cn(tdPad, 'align-top')}>{qtyLines}</td>
                  <td className={cn(tdPad, 'align-top')}>{unitLines}</td>
                  <td className={cn(tdPad, 'align-top tabular-nums')}>{totalLines}</td>
                  <td
                    className={cn(
                      tdPad,
                      'whitespace-nowrap align-middle text-center tabular-nums',
                      amtCls
                    )}
                  >
                    {formatCurrency(row.amount)}
                  </td>
                  <td className={cn(tdPad, 'font-medium whitespace-nowrap align-top tabular-nums', rbCls)}>
                    {formatStatementRunningBalanceText(row.running_balance)}
                  </td>
                </tr>
              )
            }

            return (
              <tr key={baseKey} className={trClass}>
                <td
                  className={cn(tdPad, 'whitespace-nowrap align-top')}
                  title={row.sort_at ? formatDateTime(row.sort_at) : undefined}
                >
                  {formatStatementDate(row.date)}
                </td>
                <td className={cn(tdPad, 'align-top')}>{typeBadge}</td>
                <td className={cn(tdPad, 'align-top text-right max-w-[14rem] sm:max-w-none')}>
                  {isInv && row.invoice_id != null ? (
                    <Link
                      to={`/invoices/${row.invoice_id}`}
                      className="block w-full text-right text-primary-600 dark:text-primary-400 hover:underline text-xs sm:text-sm"
                    >
                      عرض الفاتورة
                    </Link>
                  ) : isInv ? (
                    <div className="text-xs sm:text-sm leading-snug text-gray-900 dark:text-gray-100 break-words">
                      {row.description?.trim() ? row.description : '—'}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <div className="text-xs sm:text-sm leading-snug text-gray-900 dark:text-gray-100">
                        {isDeferredLikePayment ? 'آجل' : 'سداد'} {formatCurrency(row.amount)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {formatStatementPaymentMethod(row.payment_method)}
                      </div>
                      {row.payment_method === 'deferred' && row.settled_at ? (
                        <div className="text-xs text-emerald-600 dark:text-emerald-400">(مُسدَّد)</div>
                      ) : null}
                    </div>
                  )}
                </td>
                <td className={cn(tdPad, 'whitespace-nowrap align-top tabular-nums')}>{cellQty(row.quantity)}</td>
                <td className={cn(tdPad, 'whitespace-nowrap align-top tabular-nums')}>
                  {cellUnitPrice(row.unit_price)}
                </td>
                <td className={cn(tdPad, 'whitespace-nowrap align-top tabular-nums', amtCls)}>
                  {formatCurrency(row.amount)}
                </td>
                <td className={cn(tdPad, 'whitespace-nowrap align-top tabular-nums', isInv ? amtCls : '')}>
                  {isInv ? formatCurrency(row.amount) : '—'}
                </td>
                <td className={cn(tdPad, 'font-medium whitespace-nowrap align-top tabular-nums', rbCls)}>
                  {formatStatementRunningBalanceText(row.running_balance)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
