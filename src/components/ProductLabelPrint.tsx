import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Barcode from '@/components/Barcode'
import type { Product, ProductBatch, BagInstance } from '@/types/api'
import { getBatchBarcodeValue, getBagBarcodeValue, isExpiryWithinDays } from '@/lib/scanCodes'
import { formatNumber } from '@/lib/utils'

export { parseScannedBarcode, getBatchBarcodeValue, getBagBarcodeValue } from '@/lib/scanCodes'

const PRINT_STYLE_ID = 'label-print-area-styles'

const LABEL_WIDTH_MM = 50
const LABEL_HEIGHT_MM = 50

// ⚠️ PRINTER HARDWARE OFFSET:
// Since your printer physically prints to the right edge, adjust this value to perfectly center it.
// - Negative values (-5, -7, -11) move the barcode to the LEFT.
// - Positive values move it to the RIGHT.
const HORIZONTAL_OFFSET_MM = -11

/** Returns MM-YYYY from an ISO date string without timezone shifting. */
function formatExpiryMonthYear(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === '') return null
  const cal = String(raw).trim().match(/^(\d{4})-(\d{2})-\d{2}/)
  if (cal) return `${cal[2]}-${cal[1]}`
  const d = new Date(String(raw).trim())
  if (Number.isNaN(d.getTime())) return null
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${mm}-${yyyy}`
}

function effectiveExpiry(
  batch: ProductBatch | null | undefined,
  bag: BagInstance | null | undefined,
  product: Product
): string | null {
  if (batch?.expiry_date) return batch.expiry_date
  if (bag?.expiry_date) return bag.expiry_date
  if (product.expiry_date) return product.expiry_date
  return null
}

function LabelStickerBody({
  barcodeValue,
  expiryShort,
  warnExpiry,
  shortCode,
}: {
  barcodeValue: string
  expiryShort: string | null
  warnExpiry: boolean
  shortCode: string | null
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '25mm',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        boxSizing: 'border-box',
        overflow: 'hidden',
        transform: `translateX(${HORIZONTAL_OFFSET_MM}mm)`,
      }}
    >
      <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
        <Barcode
          value={barcodeValue}
          width={1.5}
          height={35}
          displayValue={false}
        />
        {shortCode && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'white',
              padding: '0 6px',
              fontSize: '13pt',
              fontWeight: 700,
              fontFamily: 'monospace, "Courier New"',
              letterSpacing: '2px',
              zIndex: 10,
              lineHeight: 1,
            }}
          >
            {shortCode}
          </div>
        )}
      </div>

      {expiryShort && (
        <div
          style={{
            marginTop: '1mm',
            fontSize: '12pt',
            fontWeight: warnExpiry ? 750 : 600,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            color: warnExpiry ? '#b91c1c' : '#1f2937',
            fontFamily: 'monospace, "Courier New"',
          }}
        >
          {expiryShort}
        </div>
      )}
    </div>
  )
}

interface ProductLabelPrintProps {
  product: Product
  batch?: ProductBatch | null
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
  const expiryIso = effectiveExpiry(batch, bag, product)
  const warnExpiry = isExpiryWithinDays(expiryIso, 90)
  const expiryShort = formatExpiryMonthYear(expiryIso)

  let shortCode: string | null = null
  if (bag) {
    shortCode = String(bag.id).padStart(4, '0')
  } else if (batch) {
    shortCode = String(batch.id).padStart(4, '0')
  }

  // Group by 2 for double sticker
  const pages = []
  for (let i = 0; i < count; i += 2) {
    pages.push([i, i + 1 < count ? i + 1 : null])
  }

  // Inject print CSS once
  useEffect(() => {
    if (document.getElementById(PRINT_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = PRINT_STYLE_ID
    style.textContent = `
@media print {
  body > #root { display: none !important; }
  body, html { 
    margin: 0 !important; 
    padding: 0 !important; 
    background: white !important; 
    width: ${LABEL_WIDTH_MM}mm !important;
    height: ${LABEL_HEIGHT_MM}mm !important;
  }

  @page {
    size: ${LABEL_WIDTH_MM}mm ${LABEL_HEIGHT_MM}mm;
    margin: 0mm;
  }

  #label-print-root,
  #label-print-root * { visibility: visible !important; }

  #label-print-root {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  .label-print-page {
    width: ${LABEL_WIDTH_MM}mm !important;
    height: ${LABEL_HEIGHT_MM}mm !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: flex-start !important;
    align-items: center !important;
    padding: 0 !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
    page-break-after: always !important;
    break-after: page !important;
    margin: 0 !important;
    direction: ltr !important;
  }

  .label-print-page:last-child {
    page-break-after: avoid !important;
    break-after: avoid !important;
  }
}
`
    document.head.appendChild(style)
  }, [])

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">

      <div className="print:hidden flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
            طباعة الملصق المزدوج (معدل الفراغ)
          </p>
          <p className="text-[10px] text-red-500 font-bold mt-1">
            ⚠️ في إعدادات كروم للطباعة: تأكد أن Margins (الهوامش) مضبوطة على None (بلا).
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="shrink-0 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
        >
          طباعة الملصق
        </button>
      </div>

      <div className="print:hidden mt-6 flex flex-col items-center gap-4 mx-auto" dir="rtl">
        <div className="flex flex-row flex-wrap items-end justify-center gap-4 mx-auto max-w-full">
          {pages.slice(0, 3).map((page, i) => (
            <div
              key={i}
              className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/40 flex flex-col justify-start items-center overflow-hidden"
              style={{ width: `${LABEL_WIDTH_MM}mm`, height: `${LABEL_HEIGHT_MM}mm`, boxSizing: 'border-box' }}
            >
              <div className="w-full border-b border-dashed border-gray-200 dark:border-gray-700">
                <LabelStickerBody
                  barcodeValue={barcodeValue}
                  expiryShort={expiryShort}
                  warnExpiry={warnExpiry}
                  shortCode={shortCode}
                />
              </div>
              <div className="w-full">
                {page[1] !== null ? (
                  <LabelStickerBody
                    barcodeValue={barcodeValue}
                    expiryShort={expiryShort}
                    warnExpiry={warnExpiry}
                    shortCode={shortCode}
                  />
                ) : (
                  <div style={{ height: '25mm', width: '100%' }} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {typeof document !== 'undefined' && createPortal(
        <div id="label-print-root" className="hidden print:block" aria-hidden dir="ltr">
          {pages.map((page, i) => (
            <div
              key={i}
              className="label-print-page"
              style={{ fontFamily: '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif' }}
            >
              <LabelStickerBody
                barcodeValue={barcodeValue}
                expiryShort={expiryShort}
                warnExpiry={warnExpiry}
                shortCode={shortCode}
              />
              {page[1] !== null ? (
                <LabelStickerBody
                  barcodeValue={barcodeValue}
                  expiryShort={expiryShort}
                  warnExpiry={warnExpiry}
                  shortCode={shortCode}
                />
              ) : (
                <div style={{ height: '25mm', width: '100%' }} />
              )}
            </div>
          ))}
        </div>,
        document.body
      )}

    </div>
  )
}
