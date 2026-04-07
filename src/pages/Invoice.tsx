import { useMemo } from 'react'
import { useInvoiceStore } from '@/stores/invoiceStore'
import { formatCurrency } from '@/lib/utils'
import { quantityColumnLabels } from '@/lib/quantityColumnHeader'

export default function Invoice() {
  const lineItems = useInvoiceStore((s) => s.lineItems)
  const incrementQuantity = useInvoiceStore((s) => s.incrementQuantity)
  const decrementQuantity = useInvoiceStore((s) => s.decrementQuantity)
  const removeLineItem = useInvoiceStore((s) => s.removeLineItem)
  const clearInvoice = useInvoiceStore((s) => s.clearInvoice)

  const grandTotal = useMemo(
    () => lineItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
    [lineItems]
  )

  const quantityColumnHeader = useMemo(() => {
    const unitTypes = lineItems.map((li) =>
      li.product.unit_type === 'bulk' ? ('bulk' as const) : ('piece' as const)
    )
    return quantityColumnLabels(unitTypes).full
  }, [lineItems])

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold">فاتورة سريعة</h1>
        <button
          type="button"
          onClick={clearInvoice}
          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          مسح الفاتورة
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <th className="text-right py-2 px-3">المنتج</th>
              <th className="text-right py-2 px-3">الباركود</th>
              <th className="text-right py-2 px-3">{quantityColumnHeader}</th>
              <th className="text-right py-2 px-3">سعر الوحدة</th>
              <th className="text-right py-2 px-3">إجمالي السطر</th>
              <th className="text-right py-2 px-3">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 px-3 text-center text-gray-500 dark:text-gray-400">
                  امسح باركود منتج لإضافته تلقائيا.
                </td>
              </tr>
            )}
            {lineItems.map((item) => {
              const lineTotal = item.product.price * item.quantity
              return (
                <tr key={item.product.id} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="py-2 px-3">{item.product.name}</td>
                  <td className="py-2 px-3">{item.product.barcode || '—'}</td>
                  <td className="py-2 px-3">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => decrementQuantity(item.product.id)}
                        className="w-7 h-7 rounded border border-gray-300 dark:border-gray-600"
                      >
                        -
                      </button>
                      <span className="min-w-6 text-center">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => incrementQuantity(item.product.id)}
                        className="w-7 h-7 rounded border border-gray-300 dark:border-gray-600"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="py-2 px-3">{formatCurrency(item.product.price)}</td>
                  <td className="py-2 px-3 font-medium">{formatCurrency(lineTotal)}</td>
                  <td className="py-2 px-3">
                    <button
                      type="button"
                      onClick={() => removeLineItem(item.product.id)}
                      className="px-2 py-1 rounded border border-red-300 text-red-600"
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <div className="text-lg font-bold">الإجمالي الكلي: {formatCurrency(grandTotal)}</div>
      </div>
    </div>
  )
}
