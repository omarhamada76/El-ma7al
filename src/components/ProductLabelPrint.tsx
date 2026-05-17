import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Barcode from '@/components/Barcode'
import type { Product, ProductBatch, BagInstance } from '@/types/api'
import { getBatchBarcodeValue, getBagBarcodeValue, isExpiryWithinDays } from '@/lib/scanCodes'

export { parseScannedBarcode, getBatchBarcodeValue, getBagBarcodeValue } from '@/lib/scanCodes'

const PRINT_STYLE_ID = 'label-print-area-styles'
const LABEL_SETTINGS_VERSION = '4'

const LABEL_WIDTH_MM = 50
const LABEL_HEIGHT_MM = 50

// ⚠️ PRINTER HARDWARE OFFSET:
// Since your printer physically prints to the right edge, adjust this value to perfectly center it.
// - Negative values (-5, -7, -11) move the barcode to the LEFT.
// - Positive values move it to the RIGHT.

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
  barcodeWidth,
  barcodeHeight,
  horizontalOffset,
  fontSize,
  barcodeFormat,
}: {
  barcodeValue: string
  expiryShort: string | null
  warnExpiry: boolean
  shortCode: string | null
  barcodeWidth: number
  barcodeHeight: number
  horizontalOffset: number
  fontSize: number
  barcodeFormat: 'CODE128' | 'CODE39'
}) {
  return (
    <div
      dir="ltr"
      style={{
        width: '100%',
        height: '25mm',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        boxSizing: 'border-box',
        gap: '0',
        overflow: 'visible',
      }}
    >
      <div style={{ 
        position: 'relative', 
        display: 'inline-block', 
        lineHeight: 0,
        transform: `translateX(${horizontalOffset}mm)`,
      }}>
        <Barcode
          value={barcodeValue}
          width={Math.max(1.4, Math.min(2.0, barcodeWidth))}
          height={barcodeHeight}
          margin={0}
          marginLeft={8}
          marginRight={8}
          displayValue={false}
          format={barcodeFormat}
        />
      </div>

      <div
        style={{
          marginTop: '0',
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '4mm',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          lineHeight: 1,
          color: '#000000',
          fontSize: `${fontSize}pt`,
          fontWeight: 800,
          letterSpacing: '0.5px',
        }}
      >
        <div style={{ whiteSpace: 'nowrap' }}>
          {shortCode}
        </div>
        {expiryShort && (
          <div style={{ color: warnExpiry ? '#b91c1c' : 'inherit', whiteSpace: 'nowrap' }}>
            {expiryShort}
          </div>
        )}
      </div>
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

  // Print layout states with persistent localStorage settings.
  // We force a one-time migration to a safer profile for thermal scanners.
  const settingsVersion = localStorage.getItem('label_settings_version')
  const useMigratedDefaults = settingsVersion !== LABEL_SETTINGS_VERSION
  const [barcodeWidth, setBarcodeWidth] = useState<number>(() => {
    if (useMigratedDefaults) return 1.6
    const saved = localStorage.getItem('label_barcode_width')
    return saved ? parseFloat(saved) : 1.6
  })
  const [barcodeHeight, setBarcodeHeight] = useState<number>(() => {
    if (useMigratedDefaults) return 64
    const saved = localStorage.getItem('label_barcode_height')
    return saved ? parseInt(saved, 10) : 64
  })
  const [horizontalOffset, setHorizontalOffset] = useState<number>(() => {
    if (useMigratedDefaults) return 0
    const saved = localStorage.getItem('label_horizontal_offset')
    return saved ? parseInt(saved, 10) : 0
  })
  const [fontSize, setFontSize] = useState<number>(() => {
    if (useMigratedDefaults) return 13
    const saved = localStorage.getItem('label_font_size')
    return saved ? parseInt(saved, 10) : 13
  })
  const [barcodeFormat, setBarcodeFormat] = useState<'CODE128' | 'CODE39'>(() => {
    if (useMigratedDefaults) return 'CODE128'
    const saved = localStorage.getItem('label_barcode_format')
    return (saved === 'CODE39' ? 'CODE39' : 'CODE128') as 'CODE128' | 'CODE39'
  })
  const [showTips, setShowTips] = useState<boolean>(false)

  useEffect(() => {
    localStorage.setItem('label_barcode_width', String(barcodeWidth))
  }, [barcodeWidth])

  useEffect(() => {
    localStorage.setItem('label_barcode_height', String(barcodeHeight))
  }, [barcodeHeight])

  useEffect(() => {
    localStorage.setItem('label_horizontal_offset', String(horizontalOffset))
  }, [horizontalOffset])

  useEffect(() => {
    localStorage.setItem('label_font_size', String(fontSize))
  }, [fontSize])

  useEffect(() => {
    localStorage.setItem('label_barcode_format', barcodeFormat)
  }, [barcodeFormat])

  useEffect(() => {
    localStorage.setItem('label_settings_version', LABEL_SETTINGS_VERSION)
  }, [])

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

      <div className="print:hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700 pb-4">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
            طباعة الملصق المزدوج (معدل الفراغ)
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="shrink-0 w-full md:w-auto px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold shadow-sm transition"
        >
          طباعة الملصق
        </button>
      </div>

      {/* settings panel */}
      <div className="print:hidden mt-4 p-4 border border-gray-100 dark:border-gray-700/50 rounded-xl bg-gray-50 dark:bg-gray-900/30 flex flex-col gap-5" dir="rtl">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              عرض الباركود: <span className="text-primary-600 dark:text-primary-400 font-bold">{barcodeWidth.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="1.0"
              max="2.0"
              step="0.1"
              value={barcodeWidth}
              onChange={(e) => setBarcodeWidth(parseFloat(e.target.value))}
              className="w-full cursor-pointer"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              ارتفاع الباركود: <span className="text-primary-600 dark:text-primary-400 font-bold">{barcodeHeight}px</span>
            </label>
            <input
              type="range"
              min="40"
              max="80"
              step="5"
              value={barcodeHeight}
              onChange={(e) => setBarcodeHeight(parseInt(e.target.value, 10))}
              className="w-full cursor-pointer"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              إزاحة الباركود: <span className="text-primary-600 dark:text-primary-400 font-bold">{horizontalOffset > 0 ? `+${horizontalOffset}` : horizontalOffset}mm</span>
            </label>
            <input
              type="range"
              min="-25"
              max="25"
              step="1"
              value={horizontalOffset}
              onChange={(e) => setHorizontalOffset(parseInt(e.target.value, 10))}
              className="w-full cursor-pointer"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              حجم الخط: <span className="text-primary-600 dark:text-primary-400 font-bold">{fontSize}pt</span>
            </label>
            <input
              type="range"
              min="8"
              max="24"
              step="1"
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
              className="w-full cursor-pointer"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 border-t border-gray-200 dark:border-gray-700/50 pt-4">
          <div className="flex flex-col gap-2 w-full sm:w-auto">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              نوع التشفير (الباركود):
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setBarcodeFormat('CODE128')}
                className={`py-1.5 px-4 rounded-lg text-xs font-semibold border transition ${
                  barcodeFormat === 'CODE128'
                    ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                    : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                Code 128 (مدمج)
              </button>
              <button
                type="button"
                onClick={() => setBarcodeFormat('CODE39')}
                className={`py-1.5 px-4 rounded-lg text-xs font-semibold border transition ${
                  barcodeFormat === 'CODE39'
                    ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                    : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                Code 39 (متباعد)
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setBarcodeWidth(1.6)
              setBarcodeHeight(64)
              setHorizontalOffset(0)
              setFontSize(13)
              setBarcodeFormat('CODE128')
            }}
            className="w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-semibold text-gray-600 hover:text-red-600 dark:text-gray-300 dark:hover:text-red-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 transition shadow-sm"
          >
            إعادة تعيين الافتراضيات
          </button>
        </div>

        <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-lg text-xs text-amber-800 dark:text-amber-300 w-full">
          <button
            type="button"
            onClick={() => setShowTips(!showTips)}
            className="w-full flex items-center justify-between font-bold text-sm select-none focus:outline-none cursor-pointer"
          >
            <div className="flex items-center gap-1.5 justify-start">
              <span>💡</span>
              <span>نصائح هامة لضمان عمل الباركود مع القارئ:</span>
            </div>
            <span className={`transform transition-transform duration-200 ${showTips ? 'rotate-180' : ''}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </span>
          </button>
          
          {showTips && (
            <ul className="list-disc list-inside space-y-1.5 text-right flex flex-col gap-1 mt-3 border-t border-amber-200/50 dark:border-amber-900/30 pt-3">
              <li>
                <strong>عرض الباركود (Quiet Zone):</strong> تأكد أن الباركود <strong>لا يلامس</strong> حواف الملصق. الماسح الضوئي يحتاج إلى <strong>مساحة بيضاء فارغة</strong> على يمين ويسار الخطوط السوداء ليتمكن من القراءة. قم بتقليل "عرض الباركود" إذا كان يغطي الملصق بالكامل!
              </li>
              <li>
                <strong>التشويش (Ink Spread):</strong> الطابعات الحرارية تقوم بضخ حبر حراري زائد أحياناً مما يخفي الفراغات البيضاء الصغيرة بين الخطوط فلا يقرأها الماسح. في هذه الحالة بدّل التشفير بالأسفل إلى <strong>Code 39 (متباعد)</strong> لأنه مقاوم جداً للتشويش الحراري، أو قم بتقليل كثافة الحرارة (Darkness) من إعدادات الطابعة.
              </li>
              <li>
                <strong>تنظيف رأس الطابعة الحرارية:</strong> يظهر أحياناً خطوط بيضاء عمودية خفيفة تقطع الباركود. هذا الخلل يمنع المسح تماماً! يرجى مسح رأس الطباعة الحراري بقطنة مبللة بكحول طبي برفق.
              </li>
              <li>
                <strong>تبديل التشفير (Format):</strong> إذا كان جهاز المسح لديك (مثل Datalogic QuickScan) مبرمجاً على قراءة تشفير معين، يمكنك التبديل بين <strong>Code 128</strong> و <strong>Code 39</strong> لمعرفة أيهما يتعرف عليه القارئ بسرعة أكبر.
              </li>
            </ul>
          )}
        </div>
      </div>

      <div className="print:hidden mt-6 flex flex-col items-center gap-4 mx-auto" dir="rtl">
        <div className="flex flex-row flex-wrap items-end justify-center gap-4 mx-auto max-w-full" dir="ltr">
          {pages.slice(0, 3).map((page, i) => (
            <div
              key={i}
              className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/40 flex flex-col justify-start items-center overflow-hidden shadow-sm"
              style={{ width: `${LABEL_WIDTH_MM}mm`, height: `${LABEL_HEIGHT_MM}mm`, boxSizing: 'border-box' }}
            >
              <div className="w-full border-b border-dashed border-gray-200 dark:border-gray-700">
                <LabelStickerBody
                  barcodeValue={barcodeValue}
                  expiryShort={expiryShort}
                  warnExpiry={warnExpiry}
                  shortCode={shortCode}
                  barcodeWidth={barcodeWidth}
                  barcodeHeight={barcodeHeight}
                  horizontalOffset={horizontalOffset}
                  fontSize={fontSize}
                  barcodeFormat={barcodeFormat}
                />
              </div>
              <div className="w-full">
                {page[1] !== null ? (
                  <LabelStickerBody
                    barcodeValue={barcodeValue}
                    expiryShort={expiryShort}
                    warnExpiry={warnExpiry}
                    shortCode={shortCode}
                    barcodeWidth={barcodeWidth}
                    barcodeHeight={barcodeHeight}
                    horizontalOffset={horizontalOffset}
                    fontSize={fontSize}
                    barcodeFormat={barcodeFormat}
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
                barcodeWidth={barcodeWidth}
                barcodeHeight={barcodeHeight}
                horizontalOffset={horizontalOffset}
                fontSize={fontSize}
                barcodeFormat={barcodeFormat}
              />
              {page[1] !== null ? (
                <LabelStickerBody
                  barcodeValue={barcodeValue}
                  expiryShort={expiryShort}
                  warnExpiry={warnExpiry}
                  shortCode={shortCode}
                  barcodeWidth={barcodeWidth}
                  barcodeHeight={barcodeHeight}
                  horizontalOffset={horizontalOffset}
                  fontSize={fontSize}
                  barcodeFormat={barcodeFormat}
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
