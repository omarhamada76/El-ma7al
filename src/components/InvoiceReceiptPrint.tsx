import { useEffect } from 'react'
import { Printer } from 'lucide-react'
import type { Invoice, InvoiceItem } from '@/types/api'
import { cn, formatCurrency, formatDate, formatNumber } from '@/lib/utils'
import { paymentMethodLabel, isInvoiceCashPayment } from '@/lib/invoicePdf'
import {
  RECEIPT_WIDTH_MM,
  RECEIPT_MARGIN_MM,
  RECEIPT_EXTRA_INLINE_START_MM,
  RECEIPT_PAGE_HEIGHT_MM,
} from '@/config/receipt'

const STYLE_ID = 'invoice-receipt-print-styles'
const SHOP_NAME = 'الصيدلية البيطرية'

function itemQtyLabel(item: InvoiceItem): string {
  if (item.product_unit_type === 'bulk') {
    if (item.display_unit === 'gram' && item.display_quantity != null) {
      return `${formatNumber(item.display_quantity, 0)} جرام`
    }
    return `${formatNumber(item.quantity, 3)} كجم`
  }
  return formatNumber(item.quantity, 0)
}

interface InvoiceReceiptPrintProps {
  invoice: Invoice & { items?: InvoiceItem[] | null }
  warehouseName: string
  barnName?: string | null
  isCancelled?: boolean
  buttonClassName?: string
}

export default function InvoiceReceiptPrint({
  invoice,
  warehouseName,
  barnName,
  isCancelled = false,
  buttonClassName,
}: InvoiceReceiptPrintProps) {
  const items = invoice.items ?? []
  const discount = Number(invoice.discount_amount) || 0
  const barnLine =
    barnName?.trim() ||
    (invoice.barn_id != null ? `عنبر #${invoice.barn_id}` : '') ||
    null

  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
@media print {
  body * { visibility: hidden !important; }
  #invoice-receipt-print-area,
  #invoice-receipt-print-area * { visibility: visible !important; }
  #invoice-receipt-print-area {
    position: fixed !important;
    left: 0 !important;
    top: 0 !important;
    width: ${RECEIPT_WIDTH_MM}mm !important;
    max-width: ${RECEIPT_WIDTH_MM}mm !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding-block: ${RECEIPT_MARGIN_MM}mm !important;
    padding-inline-end: ${RECEIPT_MARGIN_MM}mm !important;
    padding-inline-start: ${RECEIPT_MARGIN_MM + RECEIPT_EXTRA_INLINE_START_MM}mm !important;
    overflow: visible !important;
    background: #fff !important;
    color: #111 !important;
    box-sizing: border-box !important;
    font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif !important;
  }
  #invoice-receipt-print-area .invoice-receipt-logo {
    display: block !important;
    margin: 0 auto 2mm !important;
    max-height: 11mm !important;
    width: auto !important;
    max-width: 42mm !important;
    object-fit: contain !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  #invoice-receipt-print-area .invoice-receipt-price-line {
    direction: ltr !important;
    unicode-bidi: isolate !important;
    text-align: right !important;
    display: block !important;
    width: 100% !important;
  }
  #invoice-receipt-print-area .invoice-receipt-meta-row {
    display: grid !important;
    grid-template-columns: auto minmax(0, 1fr) !important;
    gap: 2mm 1.5mm !important;
    align-items: baseline !important;
  }
  .invoice-receipt-no-print { display: none !important; }
  /* Page margin 0: inner padding lives on #invoice-receipt-print-area only (avoids double inset + clipping). */
  @page {
    margin: 0;
    size: ${RECEIPT_WIDTH_MM}mm ${RECEIPT_PAGE_HEIGHT_MM}mm;
  }
}
`
    document.head.appendChild(style)
  }, [])

  const handlePrint = () => {
    console.log('طباعة الفاتوره')
    window.print()
  }

  const btnClass =
    buttonClassName ??
    cn(
      'inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600',
      'bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-100',
      'hover:bg-gray-50 dark:hover:bg-gray-700'
    )

  return (
    <>
      <button type="button" onClick={handlePrint} className={cn(btnClass, 'invoice-receipt-no-print')}>
        <Printer className="w-4 h-4 shrink-0" />
        الكود بعت Feed بدون Print command
      </button>

      <div
        id="invoice-receipt-print-area"
        className="hidden print:block text-right leading-snug"
        dir="rtl"
        style={{ fontSize: '9pt' }}
      >
        <img
          src="/logo2.png"
          alt=""
          className="invoice-receipt-logo mx-auto mb-2 max-h-[11mm] max-w-[42mm] w-auto object-contain"
        />
        <div className="text-center font-bold text-[11pt] border-b border-dashed border-gray-800 pb-1.5 mb-2">
          {SHOP_NAME}
        </div>
        <div className="text-center font-semibold mb-1">فاتورة بيع #{invoice.id}</div>
        {isCancelled ? (
          <div className="text-center text-[8pt] font-bold text-red-700 mb-2">— ملغاة —</div>
        ) : null}

        <div className="space-y-0.5 text-[8pt] mb-2 border-b border-dashed border-gray-400 pb-2">
          <div className="invoice-receipt-meta-row flex justify-between gap-1">
            <span className="text-gray-600 shrink-0">التاريخ</span>
            <span className="font-medium text-left min-w-0">{formatDate(invoice.created_at)}</span>
          </div>
          <div className="invoice-receipt-meta-row flex justify-between gap-1">
            <span className="text-gray-600 shrink-0">العميل</span>
            <span className="font-medium break-words text-left min-w-0">{invoice.customer_name}</span>
          </div>
          <div className="invoice-receipt-meta-row flex justify-between gap-1">
            <span className="text-gray-600 shrink-0">المخزن</span>
            <span className="font-medium text-left min-w-0">{warehouseName}</span>
          </div>
          {barnLine ? (
            <div className="invoice-receipt-meta-row flex justify-between gap-1">
              <span className="text-gray-600 shrink-0">العنبر</span>
              <span className="font-medium text-left min-w-0">{barnLine}</span>
            </div>
          ) : null}
          <div className="invoice-receipt-meta-row flex justify-between gap-1">
            <span className="text-gray-600 shrink-0">الدفع</span>
            <span className="font-medium text-left min-w-0">{paymentMethodLabel(invoice.payment_method)}</span>
          </div>
        </div>

        <div className="font-bold text-[8pt] mb-1 border-b border-gray-800 pb-0.5">الأصناف</div>
        <ul className="space-y-2 mb-2">
          {items.length === 0 ? (
            <li className="text-[8pt] text-gray-500">لا أصناف</li>
          ) : (
            items.map((item) => (
              <li key={item.id} className="border-b border-dotted border-gray-300 pb-1.5 last:border-0">
                <p className="font-semibold text-[8.5pt] break-words">{item.product_name}</p>
                <span className="invoice-receipt-price-line text-[8pt] tabular-nums mt-0.5">
                  {itemQtyLabel(item)} × {formatCurrency(item.unit_price)} ={' '}
                  <span className="font-bold">{formatCurrency(item.total_price)}</span>
                </span>
              </li>
            ))
          )}
        </ul>

        <div className="border-t-2 border-gray-900 pt-1.5 space-y-0.5 text-[8.5pt] tabular-nums">
          <div className="invoice-receipt-meta-row flex justify-between font-bold">
            <span className="shrink-0">المجموع</span>
            <span className="min-w-0 text-left">{formatCurrency(invoice.total_amount)}</span>
          </div>
          {discount > 0 ? (
            <div className="invoice-receipt-meta-row flex justify-between">
              <span className="shrink-0">الخصم</span>
              <span className="min-w-0 text-left">{formatCurrency(discount)}</span>
            </div>
          ) : null}
          {isInvoiceCashPayment(invoice.payment_method) ? (
            <div className="invoice-receipt-meta-row flex justify-between text-[8pt]">
              <span className="shrink-0">مدفوع / متبقي</span>
              <span className="invoice-receipt-price-line min-w-0 text-left text-[8pt]">
                {formatCurrency(invoice.paid_amount)} / {formatCurrency(invoice.remaining_amount)}
              </span>
            </div>
          ) : null}
        </div>

        {invoice.notes?.trim() ? (
          <p className="text-[7pt] text-gray-600 mt-2 pt-2 border-t border-dashed border-gray-300 whitespace-pre-wrap break-words">
            {invoice.notes.trim()}
          </p>
        ) : null}

        <p className="text-center text-[8pt] text-gray-500 mt-3 pt-2 border-t border-dashed border-gray-300">
          شكراً لزيارتكم
        </p>
      </div>
    </>
  )
}
