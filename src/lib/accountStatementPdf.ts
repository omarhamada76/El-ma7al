import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { AccountStatement, AccountStatementRow } from '@/types/api'
import {
  formatCurrency,
  formatNumber,
  formatStatementDate,
  formatStatementPaymentMethod,
  formatStatementRunningBalanceText,
  statementLineTotal,
  statementLineUnitPrice,
} from '@/lib/utils'
import { normalizeWhatsAppPhone } from '@/lib/invoicePdf'

const SHOP_NAME = 'الصيدلية البيطرية'

/**
 * Badges for html2canvas: flex centers Arabic label in the box (inline-block + line-height
 * often looks bottom-heavy / off-center in PDF capture).
 */
const BADGE_BASE =
  'display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:24px;padding:0 10px;font-size:10px;line-height:1;border-radius:4px;vertical-align:middle;white-space:nowrap;'
const BADGE_INV = `${BADGE_BASE}background:#f59e0b;color:#fff;`
const BADGE_PAY = `${BADGE_BASE}background:#16a34a;color:#fff;`
const BADGE_DEF = `${BADGE_BASE}background:#64748b;color:#fff;`

function formatPeriodLabel(from: string, to: string): string {
  const f = /^\d{4}-\d{2}-\d{2}/.test(String(from)) ? formatStatementDate(from) : from
  const t = /^\d{4}-\d{2}-\d{2}/.test(String(to)) ? formatStatementDate(to) : to
  return `${f} — ${t}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pdfCellQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return formatNumber(n, 3)
}

function pdfCellUnitPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return formatCurrency(n)
}

function pdfCellLineTotal(item: { quantity: number; total_price?: number }): string {
  const t = statementLineTotal(item)
  if (t == null || !Number.isFinite(t)) return '—'
  return formatCurrency(t)
}

function typeBadgeHtml(row: AccountStatementRow): string {
  if (row.type === 'invoice') {
    return `<span style="${BADGE_INV}">فاتورة</span>`
  }
  const def =
    row.payment_method === 'deferred' ||
    row.payment_method === 'آجل' ||
    row.payment_method === 'credit'
  if (def) {
    return `<span style="${BADGE_DEF}">آجل</span>`
  }
  return `<span style="${BADGE_PAY}">سداد</span>`
}

function tdBase(extra = ''): string {
  return `padding:6px 8px;border:1px solid #ddd;${extra}`
}

/** Thicker top border between movements (invoice / payment rows), not between line items. */
function movementRowTopBorder(rowIndex: number): string {
  return rowIndex > 0 ? 'border-top:2px solid #9ca3af;' : ''
}

/** One or more `<tr>` elements for a single statement row. */
function statementRowsHtml(row: AccountStatementRow, rowIndex: number): string {
  const isInv = row.type === 'invoice'
  const amtColor = row.direction === 'debit' ? '#b91c1c' : '#047857'
  const rbColor = Number(row.running_balance) < 0 ? '#dc2626' : '#047857'
  const rowBg = isInv ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)'
  const trOpen = `<tr style="background:${rowBg};">`
  const topMov = movementRowTopBorder(rowIndex)
  const typeBadge = typeBadgeHtml(row)

  if (isInv && row.items && row.items.length > 0) {
    const n = row.items.length
    const betweenItems = (k: number) =>
      k < n - 1 ? 'padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid #d1d5db;' : ''

    const descStack = row.items
      .map(
        (it, k) =>
          `<div style="color:#374151;font-size:12px;${betweenItems(k)}">${escapeHtml(String(it.product_name || '—'))}</div>`,
      )
      .join('')
    const qtyStack = row.items
      .map((it, k) => `<div style="${betweenItems(k)}">${pdfCellQty(it.quantity)}</div>`)
      .join('')
    const unitStack = row.items
      .map((it, k) => {
        const unit = statementLineUnitPrice(it)
        return `<div style="${betweenItems(k)}">${pdfCellUnitPrice(unit)}</div>`
      })
      .join('')
    const totalStack = row.items
      .map((it, k) => `<div style="color:${amtColor};font-weight:600;${betweenItems(k)}">${pdfCellLineTotal(it)}</div>`)
      .join('')

    return `${trOpen}
    <td style="${tdBase(topMov)}white-space:nowrap;vertical-align:top;">${formatStatementDate(row.date)}</td>
    <td style="${tdBase(topMov)}vertical-align:top;">${typeBadge}</td>
    <td style="${tdBase(topMov)}vertical-align:top;">${descStack}</td>
    <td style="${tdBase(topMov)}vertical-align:top;">${qtyStack}</td>
    <td style="${tdBase(topMov)}vertical-align:top;">${unitStack}</td>
    <td style="${tdBase(topMov)}vertical-align:top;">${totalStack}</td>
    <td style="${tdBase(topMov)}vertical-align:middle;text-align:center;color:${amtColor};font-weight:600;white-space:nowrap;">${formatCurrency(row.amount)}</td>
    <td style="${tdBase(topMov)}vertical-align:top;color:${rbColor};font-weight:600;">${formatStatementRunningBalanceText(row.running_balance)}</td>
  </tr>`
  }

  if (isInv) {
    const desc =
      row.description && String(row.description).trim()
        ? `<div style="color:#374151;font-size:12px;">${escapeHtml(String(row.description).trim())}</div>`
        : '<div style="color:#374151;font-size:12px;">—</div>'
    return `${trOpen}
    <td style="${tdBase(topMov)}white-space:nowrap;">${formatStatementDate(row.date)}</td>
    <td style="${tdBase(topMov)}">${typeBadge}</td>
    <td style="${tdBase(topMov)}">${desc}</td>
    <td style="${tdBase(topMov)}">${pdfCellQty(row.quantity)}</td>
    <td style="${tdBase(topMov)}">${pdfCellUnitPrice(row.unit_price)}</td>
    <td style="${tdBase(topMov)}color:${amtColor};font-weight:600;">${formatCurrency(row.amount)}</td>
    <td style="${tdBase(topMov)}color:${amtColor};font-weight:600;">${formatCurrency(row.amount)}</td>
    <td style="${tdBase(topMov)}color:${rbColor};font-weight:600;">${formatStatementRunningBalanceText(row.running_balance)}</td>
  </tr>`
  }

  const payLabel =
    row.payment_method === 'deferred' || row.payment_method === 'آجل' || row.payment_method === 'credit'
      ? 'آجل'
      : 'سداد'
  const paymentDesc = `<div style="line-height:1.35;">
    <div style="font-size:12px;color:#111827;">${payLabel} ${formatCurrency(row.amount)}</div>
    <div style="font-size:10px;color:#6b7280;margin-top:2px;">${escapeHtml(formatStatementPaymentMethod(row.payment_method))}</div>
    ${row.payment_method === 'deferred' && row.settled_at ? '<div style="font-size:10px;color:#059669;margin-top:2px;">(مُسدَّد)</div>' : ''}
  </div>`

  return `${trOpen}
    <td style="${tdBase(topMov)}white-space:nowrap;">${formatStatementDate(row.date)}</td>
    <td style="${tdBase(topMov)}">${typeBadge}</td>
    <td style="${tdBase(topMov)}">${paymentDesc}</td>
    <td style="${tdBase(topMov)}">${pdfCellQty(row.quantity)}</td>
    <td style="${tdBase(topMov)}">${pdfCellUnitPrice(row.unit_price)}</td>
    <td style="${tdBase(topMov)}color:${amtColor};font-weight:600;">${formatCurrency(row.amount)}</td>
    <td style="${tdBase(topMov)}color:#6b7280;">—</td>
    <td style="${tdBase(topMov)}color:${rbColor};font-weight:600;">${formatStatementRunningBalanceText(row.running_balance)}</td>
  </tr>`
}

function buildStatementHtml(
  titleLine: string,
  from: string,
  to: string,
  statement: AccountStatement,
): string {
  const rows = statement.rows.map((row, i) => statementRowsHtml(row, i)).join('')
  const extraNote = statement.cycle
    ? '<p style="margin:8px 0 14px;font-size:12px;color:#444;line-height:1.55;text-align:center;max-width:720px;margin-left:auto;margin-right:auto;">الحساب السابق يشمل المديونية المتراكمة (مدى الحياة) عند بدء الدورة. الجدول يعرض فقط الفواتير والسداد المسجّل ضمن هذه الدورة.</p>'
    : statement.after_cycle
      ? `<p style="margin:8px 0 14px;font-size:12px;color:#444;line-height:1.55;text-align:center;">حركات من بعد إغلاق الدورة حتى تاريخ نهاية التقرير.</p>`
      : ''

  const heading =
    /^كشف/.test(String(titleLine).trim()) ? titleLine.trim() : `كشف حساب العميل — ${titleLine.trim()}`

  return `
    <div style="text-align:center;font-size:18px;font-weight:700;margin-bottom:4px;">${escapeHtml(SHOP_NAME)}</div>
    <div style="text-align:center;font-size:15px;font-weight:700;margin-bottom:8px;">${escapeHtml(heading)}</div>
    ${extraNote}
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px;">
      <tr>
        <td style="padding:4px 0;color:#555;">الفترة</td>
        <td style="padding:4px 0;font-weight:600;">${escapeHtml(formatPeriodLabel(from, to))}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#555;">الحساب السابق</td>
        <td style="padding:4px 0;font-weight:700;">${formatCurrency(statement.opening_balance)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#555;">الرصيد الحالي</td>
        <td style="padding:4px 0;font-weight:700;">${formatCurrency(statement.closing_balance)}</td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:6px 8px;border:1px solid #ddd;">التاريخ</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">النوع</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">البيان</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">الكمية</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">سعر الوحدة</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">الإجمالي</th>
          <th style="padding:6px 8px;border:1px solid #ddd;text-align:center;">إجمالي الفاتورة</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">الرصيد النهائي</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="8" style="padding:12px;text-align:center;color:#666;">لا توجد حركات في الفترة المحددة</td></tr>'}
      </tbody>
    </table>
  `
}

const PDF_SLICE_EPS_MM = 0.35

/** Map each table row bottom to canvas Y so PDF pages can split only between rows, not through them. */
function collectRowBottomsCanvasPx(wrap: HTMLElement, canvasHeight: number): number[] {
  const wrapRect = wrap.getBoundingClientRect()
  const wrapH = wrap.offsetHeight
  if (wrapH <= 0) return [canvasHeight]

  const bottoms = new Set<number>()
  for (const tr of wrap.querySelectorAll('tr')) {
    const r = tr.getBoundingClientRect()
    const bottomCssPx = r.bottom - wrapRect.top
    const yCanvas = (bottomCssPx / wrapH) * canvasHeight
    const clamped = Math.min(canvasHeight, Math.max(0, yCanvas))
    bottoms.add(Math.round(clamped * 1000) / 1000)
  }
  bottoms.add(canvasHeight)
  return [...bottoms].sort((a, b) => a - b)
}

function rowBottomsPxToMm(bottomsPx: number[], canvasHeight: number, imgHeightMm: number): number[] {
  return bottomsPx.map((px) => (px / canvasHeight) * imgHeightMm)
}

/**
 * Build vertical slice ranges in mm so each slice ends at a row boundary when possible,
 * instead of fixed page height (which cuts html2canvas output mid-row).
 */
function computeStatementPdfSlicesMm(
  imgHeightMm: number,
  pageContentMm: number,
  rowBottomsMm: number[],
): Array<{ start: number; end: number }> {
  const eps = PDF_SLICE_EPS_MM
  const breaks = [...new Set(rowBottomsMm)]
    .filter((x) => x > eps && x < imgHeightMm - eps)
    .sort((a, b) => a - b)

  const slices: Array<{ start: number; end: number }> = []
  let y = 0

  while (y < imgHeightMm - eps) {
    const cap = y + pageContentMm
    let end = y
    for (const b of breaks) {
      if (b <= cap + eps && b > y + eps) end = b
    }
    if (end > y + eps) {
      slices.push({ start: y, end })
      y = end
      continue
    }

    const nextBreak = breaks.find((b) => b > y + eps) ?? imgHeightMm
    if (nextBreak - y <= pageContentMm + eps) {
      slices.push({ start: y, end: nextBreak })
      y = nextBreak
    } else {
      const hardEnd = Math.min(cap, imgHeightMm)
      slices.push({ start: y, end: hardEnd })
      y = hardEnd
    }
  }

  return slices
}

function canvasSliceToDataUrl(source: HTMLCanvasElement, y0Px: number, y1Px: number): string {
  const y0 = Math.max(0, Math.round(y0Px))
  const y1 = Math.min(source.height, Math.round(y1Px))
  const h = Math.max(1, y1 - y0)
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = h
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('canvas 2d')
  ctx.drawImage(source, 0, y0, source.width, h, 0, 0, source.width, h)
  return out.toDataURL('image/png')
}

export async function createStatementPdfBlob(
  clientName: string,
  from: string,
  to: string,
  statement: AccountStatement,
): Promise<Blob> {
  const wrap = document.createElement('div')
  wrap.setAttribute('dir', 'rtl')
  wrap.style.cssText = [
    'position:fixed',
    'left:-12000px',
    'top:0',
    'width:900px',
    'background:#ffffff',
    'color:#111827',
    'padding:28px',
    'font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif',
    'font-size:14px',
    'line-height:1.5',
    'box-sizing:border-box',
  ].join(';')

  wrap.innerHTML = buildStatementHtml(clientName, from, to, statement)
  document.body.appendChild(wrap)

  try {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const canvas = await html2canvas(wrap, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    })

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const marginMm = 8
    const usableHeightMm = Math.max(40, pageHeight - 2 * marginMm)
    const imgWidth = pageWidth
    const imgHeightMm = (canvas.height * imgWidth) / canvas.width

    const bottomsPx = collectRowBottomsCanvasPx(wrap, canvas.height)
    const bottomsMm = rowBottomsPxToMm(bottomsPx, canvas.height, imgHeightMm)
    let slices = computeStatementPdfSlicesMm(imgHeightMm, usableHeightMm, bottomsMm)
    if (slices.length === 0 && imgHeightMm > PDF_SLICE_EPS_MM) {
      slices = [{ start: 0, end: imgHeightMm }]
    }

    slices.forEach((slice, i) => {
      if (i > 0) pdf.addPage()
      const y0Px = (slice.start / imgHeightMm) * canvas.height
      const y1Px = (slice.end / imgHeightMm) * canvas.height
      const sliceData = canvasSliceToDataUrl(canvas, y0Px, y1Px)
      const sliceMm = slice.end - slice.start
      pdf.addImage(sliceData, 'PNG', 0, marginMm, imgWidth, sliceMm)
    })

    return pdf.output('blob')
  } finally {
    document.body.removeChild(wrap)
  }
}

function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function downloadPdfBlob(pdfBlob: Blob, filename: string): void {
  const url = URL.createObjectURL(pdfBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function downloadStatementPdf(
  pdfBlob: Blob,
  clientName: string,
  isSupplier?: boolean,
): Promise<void> {
  const filename = `كشف-حساب-${isSupplier ? 'المورد-' : ''}${clientName}.pdf`
  downloadPdfBlob(pdfBlob, filename)
}

export async function shareStatementToWhatsApp(
  pdfBlob: Blob,
  clientName: string,
  options?: { phone?: string | null; from?: string; to?: string; isSupplier?: boolean },
): Promise<void> {
  const isSupplier = !!options?.isSupplier
  const filename = `كشف-حساب-${isSupplier ? 'المورد-' : ''}${clientName}.pdf`
  const period = options?.from && options?.to ? ` (${options.from} — ${options.to})` : ''
  const caption = `كشف حساب ${isSupplier ? 'المورد' : 'العميل'}: ${clientName}${period} — ${SHOP_NAME}`
  const phone = normalizeWhatsAppPhone(options?.phone)
  const file = new File([pdfBlob], filename, { type: 'application/pdf' })

  let canShareFiles = false
  try {
    canShareFiles =
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
  } catch {
    canShareFiles = false
  }

  if (isMobileDevice() && canShareFiles) {
    try {
      await navigator.share({
        files: [file],
        title: `كشف حساب — ${clientName}`,
        text: caption,
      })
      return
    } catch (err) {
      const e = err as { name?: string }
      if (e?.name === 'AbortError') return
    }
  }

  downloadPdfBlob(pdfBlob, filename)

  const hint =
    'تم تحميل ملف PDF في مجلد التحميلات.\n' +
    'في واتساب: اضغط 📎 (إرفاق) واختر الملف لإرساله.'
  const body = `${caption}\n\n${hint}`
  const text = encodeURIComponent(body)

  if (isMobileDevice()) {
    const waUrl = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`
    window.open(waUrl, '_blank', 'noopener,noreferrer')
    return
  }

  const waUrl = phone
    ? `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${text}`
    : `https://web.whatsapp.com/send?text=${text}`
  window.open(waUrl, '_blank', 'noopener,noreferrer')
}
