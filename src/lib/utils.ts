import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Western digits (0–9) for every `ar-EG` number/date in the UI. */
const AR_LATN = { numberingSystem: 'latn' as const }

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** YYYY-MM-DD in local timezone (avoid UTC drift from `toISOString().slice(0,10)`). */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatCurrency(value: number | null | undefined): string {
  const n = Number(value)
  const safe = Number.isFinite(n) ? Math.round(n) : 0
  return new Intl.NumberFormat('ar-EG', {
    ...AR_LATN,
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(safe) + ' ج.م'
}

/** Format numerics without noisy trailing zeros from DB numeric scale. */
export function formatNumber(value: number | string | null | undefined, maxFractionDigits = 2): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return new Intl.NumberFormat('ar-EG', {
    ...AR_LATN,
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(n)
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('ar-EG', {
    ...AR_LATN,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date))
}

/** DD/MM/YYYY with Western digits (كشف الحساب والتقارير المالية). */
export function formatStatementDate(date: string | Date): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return String(date)
  return new Intl.DateTimeFormat('ar-EG', {
    ...AR_LATN,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

/** الرصيد النهائي: سالب بصيغة «… ج.م-»، موجب أو صفر بصيغة «… ج.م». */
export function formatStatementRunningBalanceText(value: number | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(Math.round(n))
  const num = new Intl.NumberFormat('ar-EG', {
    ...AR_LATN,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs)
  if (n < 0) return `${num} ج.م-`
  return `${num} ج.م`
}

/** طريقة الدفع لعرضها تحت سطر «سداد» في كشف الحساب. */
export function formatStatementPaymentMethod(method: string | null | undefined): string {
  const m = String(method || '')
  if (m === 'cash') return 'كاش'
  if (m === 'deferred') return 'آجل'
  if (m === 'vodafone_cash') return 'فودافون كاش'
  if (m === 'instapay') return 'انستاباي'
  if (m === 'discount') return 'خصم من المديونية'
  if (m === 'historical_invoice_paid') return 'مدفوع (ترحيل)'
  return m.trim() ? m : '—'
}

/** سعر وحدة بند فاتورة في كشف الحساب من `total_price` و`quantity`. */
export function statementLineUnitPrice(item: {
  quantity: number
  total_price?: number
}): number | null {
  const q = Number(item.quantity)
  const tp = item.total_price != null ? Number(item.total_price) : NaN
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(tp)) return null
  return tp / q
}

/** إجمالي سطر البند (الكمية × سعر الوحدة) من `total_price` أو بالاشتقاق. */
export function statementLineTotal(item: {
  quantity: number
  total_price?: number
}): number | null {
  const tp = item.total_price != null ? Number(item.total_price) : NaN
  if (Number.isFinite(tp)) return tp
  const unit = statementLineUnitPrice(item)
  const q = Number(item.quantity)
  if (unit != null && Number.isFinite(q)) return q * unit
  return null
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('ar-EG', {
    ...AR_LATN,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

/** Convert DB date (YYYY-MM-DD) to month input value (YYYY-MM). */
export function toMonthInputValue(date: string | null | undefined): string {
  if (!date || date === '9999-12-31') return ''
  return String(date).slice(0, 7)
}

/** Convert month input value (YYYY-MM) to DB-safe date (YYYY-MM-01). */
export function fromMonthInputValue(month: string): string | null {
  const t = month.trim()
  if (!t) return null
  if (!/^\d{4}-\d{2}$/.test(t)) return null
  return `${t}-01`
}

/** Expiry label shown as MM/YYYY (or without date). */
export function formatExpiryMonth(date: string | null | undefined): string {
  if (!date || date === '9999-12-31') return 'بدون تاريخ'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return String(date)
  return new Intl.DateTimeFormat('ar-EG', {
    ...AR_LATN,
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

/** Warning message when a later batch is selected but an earlier one exists. */
export function getNearExpiryWarning(earliestExpiry: string): string {
  return `تنبيه: يوجد دفعة أخرى أقرب انتهاءً (${formatExpiryMonth(earliestExpiry)}) — يفضل بيعها أولاً`
}
