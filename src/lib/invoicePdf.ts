import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { Invoice, InvoiceItem } from '@/types/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { quantityColumnHeaderFromInvoiceItems } from '@/lib/quantityColumnHeader'

const SHOP_NAME = 'الصيدلية البيطرية'

export function paymentMethodLabel(raw: string): string {
  if (raw === 'cash') return 'كاش'
  if (raw === 'آجل' || raw === 'credit') return 'آجل'
  return raw
}

/** E.164 digits for wa.me (e.g. 2010xxxxxxxx), no + */
export function normalizeWhatsAppPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined
  let d = phone.replace(/\D/g, '')
  if (!d) return undefined
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('20')) return d
  if (d.startsWith('0')) return `20${d.slice(1)}`
  if (d.length === 10 && d.startsWith('1')) return `20${d}`
  return d
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildInvoiceHtml(
  invoice: Invoice & { items: InvoiceItem[] },
  warehouseName: string,
  barnName?: string | null
): string {
  const discount = Number(invoice.discount_amount) || 0
  const barnLine =
    barnName?.trim() ||
    (invoice.barn_id != null ? `عنبر #${invoice.barn_id}` : '')
  const rows =
    invoice.items?.map(
      (item) => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(item.product_name)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${item.quantity}</td>
        <td style="padding:8px;border:1px solid #ddd;">${formatCurrency(item.unit_price)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${formatCurrency(item.total_price)}</td>
      </tr>`
    ) ?? []

  const qtyColHeader = escapeHtml(
    quantityColumnHeaderFromInvoiceItems(invoice.items ?? [])
  )

  return `
    <div style="text-align:center;font-size:18px;font-weight:700;margin-bottom:16px;">${escapeHtml(SHOP_NAME)}</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:12px;">فاتورة #${invoice.id}</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px;">
      <tr><td style="padding:4px 0;color:#555;">التاريخ</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(formatDate(invoice.created_at))}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">المخزن</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(warehouseName)}</td></tr>
      ${
        barnLine
          ? `<tr><td style="padding:4px 0;color:#555;">العنبر</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(barnLine)}</td></tr>`
          : ''
      }
      <tr><td style="padding:4px 0;color:#555;">اسم العميل</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(invoice.customer_name)}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">طريقة الدفع</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(paymentMethodLabel(invoice.payment_method))}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">المجموع</td><td style="padding:4px 0;font-weight:700;">${formatCurrency(invoice.total_amount)}</td></tr>
      ${discount > 0 ? `<tr><td style="padding:4px 0;color:#555;">الخصم</td><td style="padding:4px 0;">${formatCurrency(discount)}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#555;">المدفوع / المتبقي</td><td style="padding:4px 0;">${formatCurrency(invoice.paid_amount)} / ${formatCurrency(invoice.remaining_amount)}</td></tr>
      <tr><td style="padding:4px 0;color:#555;">الحالة</td><td style="padding:4px 0;">${escapeHtml(invoice.status)}</td></tr>
    </table>
    <div style="font-size:14px;font-weight:700;margin:12px 0 8px;">الأصناف</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:8px;border:1px solid #ddd;">المنتج</th>
          <th style="padding:8px;border:1px solid #ddd;">${qtyColHeader}</th>
          <th style="padding:8px;border:1px solid #ddd;">سعر الوحدة</th>
          <th style="padding:8px;border:1px solid #ddd;">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rows.join('') || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#666;">لا توجد أصناف</td></tr>'}</tbody>
    </table>
  `
}

export async function createInvoicePdfBlob(
  invoice: Invoice & { items: InvoiceItem[] },
  warehouseName: string,
  barnName?: string | null
): Promise<Blob> {
  const wrap = document.createElement('div')
  wrap.setAttribute('dir', 'rtl')
  wrap.style.cssText = [
    'position:fixed',
    'left:-12000px',
    'top:0',
    'width:720px',
    'background:#ffffff',
    'color:#111827',
    'padding:28px',
    'font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif',
    'font-size:14px',
    'line-height:1.5',
    'box-sizing:border-box',
  ].join(';')

  wrap.innerHTML = buildInvoiceHtml(invoice, warehouseName, barnName)
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

/** Download PDF locally (required for WhatsApp Web — it cannot attach files via URL). */
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

/**
 * Share invoice PDF toward WhatsApp.
 * - WhatsApp Web (PC) cannot receive a file via link; we download the PDF and open web.whatsapp.com with a message asking the user to attach the file (📎).
 * - On phones, native share with the PDF is tried first when supported.
 */
export async function shareInvoicePdfToWhatsApp(
  pdfBlob: Blob,
  invoiceId: number,
  options?: { phoneDigits?: string }
): Promise<void> {
  const filename = `فاتورة-${invoiceId}.pdf`
  const caption = `فاتورة بيع رقم ${invoiceId} — ${SHOP_NAME}`
  const phone = options?.phoneDigits
  const file = new File([pdfBlob], filename, { type: 'application/pdf' })

  const hint =
    'تم تحميل ملف PDF في مجلد التحميلات.\n' +
    'في واتساب: اضغط 📎 (إرفاق) واختر الملف لإرساله.'

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

  // Phones: try OS share sheet (can target WhatsApp when installed)
  if (isMobileDevice() && canShareFiles) {
    try {
      await navigator.share({
        files: [file],
        title: `فاتورة #${invoiceId}`,
        text: caption,
      })
      return
    } catch (err) {
      const e = err as { name?: string }
      if (e?.name === 'AbortError') return
    }
  }

  downloadPdfBlob(pdfBlob, filename)

  const body = `${caption}\n\n${hint}`
  const text = encodeURIComponent(body)

  if (isMobileDevice()) {
    const waUrl = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`
    window.open(waUrl, '_blank', 'noopener,noreferrer')
    return
  }

  // PC / desktop: open WhatsApp Web directly (no wa.me redirect)
  const waUrl = phone
    ? `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${text}`
    : `https://web.whatsapp.com/send?text=${text}`
  window.open(waUrl, '_blank', 'noopener,noreferrer')
}
