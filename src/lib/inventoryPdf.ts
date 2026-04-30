import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { Product } from '@/types/api'
import { formatNumber } from '@/lib/utils'

const SHOP_NAME = 'الصيدلية البيطرية'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Generates an Inventory PDF report as a Blob.
 * Excludes selling prices as requested by the user.
 */
export async function createInventoryPdfBlob(
  products: Product[],
  filterTitle: string,
  options: {
    warehouseName?: string
    warehouseStockMap?: Record<number, number>
  } = {}
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
    'padding:40px',
    'font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif',
    'font-size:14px',
    'line-height:1.5',
    'box-sizing:border-box',
  ].join(';')

  const date = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const rows = products.map((p, i) => {
    // If a specific warehouse is selected, use the quantity from the stock map
    const stock = options.warehouseName && options.warehouseStockMap
      ? (options.warehouseStockMap[p.id] ?? 0)
      : (p.batch_total_quantity ?? 0)
    
    const unit = p.unit_type === 'bulk' ? 'كجم' : 'قطعة'
    return `
      <tr style="${i % 2 === 1 ? 'background-color:#f9fafb;' : ''}">
        <td style="padding:12px 10px;border:1px solid #e5e7eb;text-align:center;width:40px;color:#6b7280;">${i + 1}</td>
        <td style="padding:12px 10px;border:1px solid #e5e7eb;font-weight:500;color:#111827;">${escapeHtml(p.name)}</td>
        <td style="padding:12px 10px;border:1px solid #e5e7eb;text-align:center;color:#4b5563;">${escapeHtml(p.category || '—')}</td>
        <td style="padding:12px 10px;border:1px solid #e5e7eb;text-align:center;direction:ltr;font-weight:600;color:#374151;">
          ${formatNumber(Number(stock), p.unit_type === 'bulk' ? 2 : 0)} ${unit}
        </td>
      </tr>
    `
  }).join('')

  wrap.innerHTML = `
    <div style="text-align:center;margin-bottom:40px;border-bottom:2px solid #f3f4f6;padding-bottom:30px;">
      <div style="font-size:28px;font-weight:700;margin-bottom:8px;color:#111827;letter-spacing:-0.02em;">${escapeHtml(SHOP_NAME)}</div>
      <div style="font-size:20px;font-weight:600;margin-bottom:6px;color:#ef4444;">${escapeHtml(filterTitle)}</div>
      <div style="font-size:14px;color:#6b7280;">
        <span>تاريخ التقرير: ${date}</span>
        ${options.warehouseName ? `<span style="margin:0 12px;color:#e5e7eb;">|</span><span>المخزن: ${escapeHtml(options.warehouseName)}</span>` : ''}
      </div>
    </div>
    
    <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
      <thead>
        <tr style="background:#f8fafc;color:#475569;">
          <th style="padding:14px 10px;border:1px solid #e5e7eb;width:40px;text-align:center;font-weight:700;">#</th>
          <th style="padding:14px 10px;border:1px solid #e5e7eb;text-align:right;font-weight:700;">المنتج</th>
          <th style="padding:14px 10px;border:1px solid #e5e7eb;text-align:center;font-weight:700;">الفئة</th>
          <th style="padding:14px 10px;border:1px solid #e5e7eb;text-align:center;font-weight:700;">المخزون</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="4" style="padding:30px;text-align:center;color:#9ca3af;font-style:italic;">لا توجد منتجات مطابقة للبحث</td></tr>'}
      </tbody>
    </table>
    
    <div style="margin-top:60px;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:20px;">
      تقرير إداري — سرّي وللاستخدام الداخلي فقط
    </div>
  `

  document.body.appendChild(wrap)

  try {
    // Wait for two animation frames to ensure styles and layouts are baked for html2canvas
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    
    const canvas = await html2canvas(wrap, {
      scale: 2.5, // Higher scale for crisper text
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    })

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ 
      orientation: 'portrait', 
      unit: 'mm', 
      format: 'a4',
      compress: true
    })
    
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
