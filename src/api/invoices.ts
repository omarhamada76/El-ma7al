import { api } from './client'
import type { Invoice, InvoiceItem } from '@/types/api'

export interface InvoicesParams {
  page?: number
  limit?: number
  client_id?: number
  barn_id?: number
  warehouse_id?: number
  /** فلترة حسب طريقة الدفع للفاتورة: `cash` (كاش) أو `آجل` (يشمل credit/deferred في الخادم) */
  payment_method?: string
  status?: string
  from?: string
  to?: string
  /** فواتير عليها متبقي (غير مسددة بالكامل) */
  unpaid?: boolean
}

export interface CreateInvoiceBody {
  client_id: number
  barn_id?: number
  warehouse_id: number
  customer_name: string
  payment_method: string
  paid_amount: number
  /** عند وجود متبقي: يجب أن يكون true لتسجيل الآجل */
  register_deferred?: boolean
  /** طريقة السداد الفوري (الجزء المدفوع الآن) */
  immediate_payment_method?: 'cash' | 'vodafone_cash' | 'instapay'
  wallet_id?: number | null
  due_date?: string | null
  discount_amount?: number
  notes?: string
  items: {
    product_id: number
    product_name: string
    quantity: number
    unit_price: number
    total_price: number
    batch_id?: number | null
    /** Bulk: deduct kilos from this bag (barcode `G{id}`). */
    bag_id?: number | null
    /** Original input for print; `quantity` remains kilos. */
    display_quantity?: number
    display_unit?: 'kg' | 'gram'
  }[]
}

export async function getInvoices(params: InvoicesParams = {}): Promise<{
  data: Invoice[]
  total: number
}> {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === '') return
    if (k === 'unpaid' && v === true) {
      q.set('unpaid', '1')
      return
    }
    if (k === 'unpaid') return
    q.set(k, String(v))
  })
  return api.get(`/invoices${q.toString() ? `?${q}` : ''}`)
}

export async function getInvoice(id: string): Promise<Invoice & { items: InvoiceItem[] }> {
  return api.get(`/invoices/${id}`)
}

export async function createInvoice(body: CreateInvoiceBody): Promise<Invoice> {
  return api.post('/invoices', body)
}

/** Partial fields or full replace with `items` (same shape as create). */
export type InvoiceUpdateBody = Partial<Invoice> | (Partial<CreateInvoiceBody> & { items?: CreateInvoiceBody['items'] })

export async function updateInvoice(id: string, body: InvoiceUpdateBody): Promise<Invoice> {
  return api.patch(`/invoices/${id}`, body)
}

/** Soft-cancel invoice (admin/super_admin). Returns updated invoice with `invoice_lifecycle: 'cancelled'`. */
export async function cancelInvoice(id: string): Promise<Invoice & { items: InvoiceItem[] }> {
  return api.delete(`/invoices/${id}`)
}

export async function deleteInvoiceItem(
  invoiceId: string,
  itemId: number
): Promise<Invoice & { items: InvoiceItem[] }> {
  return api.delete(`/invoices/${invoiceId}/items/${itemId}`)
}

export async function returnPartialInvoiceItem(
  invoiceId: string,
  itemId: number,
  body: { returned_quantity: number; notes?: string | null }
): Promise<Invoice & { items: InvoiceItem[] }> {
  return api.post(`/invoices/${invoiceId}/items/${itemId}/return`, body)
}

/** @deprecated Use cancelInvoice — kept for call sites that still import deleteInvoice */
export async function deleteInvoice(id: string): Promise<Invoice & { items: InvoiceItem[] }> {
  return cancelInvoice(id)
}
