import { useEffect } from 'react'
import Barcode from '@/components/Barcode'
import type { Product, ProductBatch, BagInstance } from '@/types/api'
import { getBatchBarcodeValue, getBagBarcodeValue, isExpiryWithinDays } from '@/lib/scanCodes'
import {
  LABEL_WIDTH_MM,
  LABEL_PAGE_HEIGHT_MM,
  LABEL_PRINT_MARGIN_MM,
} from '@/config/labels'

const PRINT_STYLE_ID = 'label-print-area-styles'

function formatPriceAr(n: number): string {
  return Number(n).toLocaleString('ar-EG', { maximumFractionDigits: 2 })
}

function formatDateAr(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function effectiveExpiry(
  batch: ProductBatch | null | undefined,
  bag: BagInstance | null | undefined,
  product: Product
): string | null {
  if (bag?.expiry_date && bag.expiry_date !== '9999-12-31') return bag.expiry_date
  if (batch?.expiry_date && batch.expiry_date !== '9999-12-31') return batch.expiry_date
  if (product.expiry_date && product.expiry_date !== '9999-12-31') return product.expiry_date
  return null
}

export { parseScannedBarcode, getBatchBarcodeValue, getBagBarcodeValue } from '@/lib/scanCodes'

interface ProductLabelPrintProps {
  product: Product
  /** Piece batches: encode `B{id}` only (no manufacturer barcode on labels). */
  batch?: ProductBatch | null
  /** Bulk bags: encode `G{id}` only. */
  bag?: BagInstance | null
  labelCount?: number
}

export default function ProductLabelPrint({
  product,
  batch,
  bag,
  labelCount = 1,
}: ProductLabelPrintProps) {
  if (!batch && !bag) return null

  const count = Math.max(1, Math.min(labelCount, 200))

  const barcodeValue = bag ? getBagBarcodeValue(bag.id) : getBatchBarcodeValue(batch!.id)

  const displayPrice =
    bag?.selling_price ?? batch?.selling_price ?? product.selling_price

  const expiryIso = effectiveExpiry(batch, bag, product)
  const warnExpiry = isExpiryWithinDays(expiryIso, 90)

  const secondLine = bag
    ? `${formatPriceAr(displayPrice)} ج.م/كيلو   ${formatPriceAr(bag.kg_total)} كيلو${expiryIso ? `   ${formatDateAr(expiryIso)}` : ''}`
    : `${formatPriceAr(displayPrice)} ج.م${expiryIso ? `   ${formatDateAr(expiryIso)}` : ''}`

  useEffect(() => {
    if (document.getElementById(PRINT_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = PRINT_STYLE_ID
    style.textContent = `
@media print {
  body * { visibility: hidden !important; }
  #label-print-area,
  #label-print-area * { visibility: visible !important; }
  #label-print-area {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: ${LABEL_WIDTH_MM}mm !important;
    background: white !important;
  }
  .no-print { display: none !important; }
  @page {
    size: ${LABEL_WIDTH_MM}mm ${LABEL_PAGE_HEIGHT_MM}mm;
    margin: ${LABEL_PRINT_MARGIN_MM}mm;
  }
}
`
    document.head.appendChild(style)
  }, [])

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-start justify-between gap-4 no-print">
        <div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">ملصق باركود Code 128 للطباعة</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            يظهر على الملصق رمز الدفعة (B) أو الشكارة (G) فقط — باركود المورد لا يُطبع هنا.
          </p>
          {count > 1 && (
            <p className="text-xs text-primary-600 dark:text-primary-400 mt-1">عدد الملصقات: {count}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handlePrint}
          className="shrink-0 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
        >
          طباعة الملصق
        </button>
      </div>

      <div id="label-print-area" className="mt-4 mx-auto" style={{ width: `${LABEL_WIDTH_MM}mm`, maxWidth: '100%' }}>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="label-sheet flex flex-col items-center text-center bg-white text-gray-900 py-1 px-1"
            style={{
              pageBreakAfter: i < count - 1 ? 'always' : 'auto',
              fontFamily: '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif',
            }}
          >
            <p
              className="font-bold leading-tight px-0.5"
              style={{ fontSize: '10pt', maxWidth: '100%', wordBreak: 'break-word' }}
            >
              {product.name}
            </p>
            <p className="text-gray-800 leading-tight mt-0.5 px-0.5" style={{ fontSize: '8pt' }}>
              {secondLine}
            </p>
            <div className="mt-1 w-full flex justify-center overflow-hidden">
              <Barcode value={barcodeValue} width={1.8} height={30} displayValue={false} />
            </div>
            <p className="text-gray-700 font-mono mt-0.5" style={{ fontSize: '7pt' }}>
              {barcodeValue}
            </p>
            {expiryIso && (
              <p
                className={`mt-0.5 font-semibold uppercase tracking-wide ${warnExpiry ? 'text-red-600' : 'text-gray-800'}`}
                style={{ fontSize: '7pt' }}
              >
                EXP: {expiryIso}
              </p>
            )}
            <p className="no-print text-xs text-gray-600 dark:text-gray-400 mt-2 font-medium">
              سعر البيع للعميل: {formatPriceAr(displayPrice)} ج.م
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
