import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { AccountStatement, AccountStatementRow } from '@/types/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { normalizeWhatsAppPhone } from '@/lib/invoicePdf'

const SHOP_NAME = 'الصيدلية البيطرية'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pdfMoney(n: number | undefined) {
  const v = Number(n) || 0
  return v > 0 ? formatCurrency(v) : '—'
}

function rowHtml(row: AccountStatementRow): string {
  const itemsList =
    row.type === 'invoice' && row.items?.length
      ? `<div style="margin-top:2px;font-size:10px;color:#666;">${row.items.map((it) => `${escapeHtml(it.product_name)} ×${it.quantity}`).join('، ')}</div>`
      : ''
  const barnCell = row.barn_name
    ? `<span style="font-weight:600;">${escapeHtml(row.barn_name)}</span>`
    : '—'
  const dd = row.display_debit ?? row.debit
  const dc = row.display_credit ?? row.credit

  return `<tr>
    <td style="padding:6px 8px;border:1px solid #ddd;white-space:nowrap;">${formatDate(row.date)}</td>
    <td style="padding:6px 8px;border:1px solid #ddd;">${row.type === 'invoice' ? 'فاتورة' : 'دفعة'}</td>
    <td style="padding:6px 8px;border:1px solid #ddd;white-space:nowrap;">${barnCell}</td>
    <td style="padding:6px 8px;border:1px solid #ddd;">${escapeHtml(row.description)}${itemsList}</td>
    <td style="padding:6px 8px;border:1px solid #ddd;">${pdfMoney(dd)}</td>
    <td style="padding:6px 8px;border:1px solid #ddd;">${pdfMoney(dc)}</td>
    <td style="padding:6px 8px;border:1px solid #ddd;">${row.type === 'invoice' ? formatCurrency(row.invoice_total ?? row.debit) : '—'}</td>
    <td style="padding:6px 8px;border:1px solid #ddd;">${row.type === 'invoice' ? formatCurrency(row.paid ?? 0) : '—'}</td>
    <td style="padding:6px 8px;border:1px solid #ddd;">${row.type === 'invoice' ? formatCurrency(row.remaining ?? 0) : '—'}</td>
    <td style="padding:6px 8px;border:1px solid #ddd;font-weight:600;">${formatCurrency(row.balance)}</td>
  </tr>`
}

function buildStatementHtml(
  clientName: string,
  from: string,
  to: string,
  statement: AccountStatement,
): string {
  const rows = statement.rows.map(rowHtml).join('')
  const extraNote = statement.cycle
    ? '<p style="margin:8px 0 14px;font-size:12px;color:#444;line-height:1.55;text-align:center;max-width:720px;margin-left:auto;margin-right:auto;">الرصيد الافتتاحي يشمل المديونية المتراكمة (مدى الحياة) عند بدء الدورة. الجدول يعرض فقط الفواتير والدفعات المسجّلة ضمن هذه الدورة.</p>'
    : statement.after_cycle
      ? `<p style="margin:8px 0 14px;font-size:12px;color:#444;line-height:1.55;text-align:center;">حركات من بعد إغلاق الدورة حتى تاريخ نهاية التقرير.</p>`
      : ''

  return `
    <div style="text-align:center;font-size:18px;font-weight:700;margin-bottom:4px;">${escapeHtml(SHOP_NAME)}</div>
    <div style="text-align:center;font-size:15px;font-weight:700;margin-bottom:8px;">كشف حساب العميل — ${escapeHtml(clientName)}</div>
    ${extraNote}
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px;">
      <tr>
        <td style="padding:4px 0;color:#555;">الفترة</td>
        <td style="padding:4px 0;font-weight:600;">${escapeHtml(from)} — ${escapeHtml(to)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#555;">الرصيد الافتتاحي</td>
        <td style="padding:4px 0;font-weight:700;">${formatCurrency(statement.opening_balance)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#555;">الرصيد الختامي</td>
        <td style="padding:4px 0;font-weight:700;">${formatCurrency(statement.closing_balance)}</td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:6px 8px;border:1px solid #ddd;">التاريخ</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">النوع</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">العنبر</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">البيان</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">مدين</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">دائن</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">إجمالي الفاتورة</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">المدفوع</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">المتبقي</th>
          <th style="padding:6px 8px;border:1px solid #ddd;">الرصيد</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="8" style="padding:12px;text-align:center;color:#666;">لا توجد حركات في الفترة المحددة</td></tr>'}
      </tbody>
    </table>
  `
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

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    let heightLeft = imgHeight
    let position = 0
    let page = 0

    while (heightLeft > 0) {
      if (page > 0) pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
      position -= pageHeight
      page++
    }

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
): Promise<void> {
  const filename = `كشف-حساب-${clientName}.pdf`
  downloadPdfBlob(pdfBlob, filename)
}

export async function shareStatementToWhatsApp(
  pdfBlob: Blob,
  clientName: string,
  options?: { phone?: string | null; from?: string; to?: string },
): Promise<void> {
  const filename = `كشف-حساب-${clientName}.pdf`
  const period = options?.from && options?.to ? ` (${options.from} — ${options.to})` : ''
  const caption = `كشف حساب العميل: ${clientName}${period} — ${SHOP_NAME}`
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
