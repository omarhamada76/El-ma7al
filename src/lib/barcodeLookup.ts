import { normalizeArabicNumbers } from './utils'

/**
 * Some scanners emit composite strings; only the first segment is the product barcode.
 * Example: `123456|12.50|Name` → `123456`
 */
export function extractProductBarcodeForLookup(raw: string): string {
  const trimmed = raw.trim()
  const sep = trimmed.includes('||') ? '||' : '|'
  if (!trimmed.includes(sep)) return trimmed
  return trimmed.split(sep)[0]?.trim() ?? ''
}

/** Session backup when `?barcode=` is missing or stripped before InvoiceNew processes the scan. */
export const INVOICE_NEW_PENDING_BARCODE_STORAGE_KEY = 'invoiceNewPendingBarcode'

export function readInvoiceNewPendingBarcode(): string {
  if (typeof window === 'undefined') return ''
  try {
    return sessionStorage.getItem(INVOICE_NEW_PENDING_BARCODE_STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function setInvoiceNewPendingBarcode(value: string): void {
  try {
    const v = value.trim()
    if (v) {
      sessionStorage.setItem(INVOICE_NEW_PENDING_BARCODE_STORAGE_KEY, v)
    } else {
      sessionStorage.removeItem(INVOICE_NEW_PENDING_BARCODE_STORAGE_KEY)
    }
  } catch {
    /* ignore */
  }
}

export function clearInvoiceNewPendingBarcode(): void {
  try {
    sessionStorage.removeItem(INVOICE_NEW_PENDING_BARCODE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Prefer embedded `B{id}` / `G{id}` when scanners add prefix/suffix junk around the token.
 * Uses longest B…/G… match so `…B12…B123…` resolves to B123 not B12.
 */
export function normalizeInvoiceScanToken(raw: string): string {
  // 1. Strip invisible control characters and BOM, and normalize Arabic numerals
  let t = normalizeArabicNumbers(raw.trim()).replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '')
  
  // 2. Strip common scanner symbology prefixes (ISO/IEC 15424)
  // ]C1 = Code 128, ]E0 = EAN, ]G0 = Code 39, ]Q1 = QR, ]I0 = I2of5
  t = t.replace(/^\][A-Z][0-9]/, '')
  
  // 3. Strip leading/trailing non-alphanumeric junk (often scanners send stray characters)
  // but keep B/G at start if followed by digits.
  if (!t) return ''
  
  const b = [...t.matchAll(/B(\d+)/gi)].map((m) => 'B' + m[1])
  const g = [...t.matchAll(/G(\d+)/gi)].map((m) => 'G' + m[1])
  const all = [...b, ...g]
  
  if (all.length === 0) {
    // If no B/G found, just return the cleaned string. 
    // We might want to strip any remaining leading symbols for numeric barcodes.
    return t.replace(/^[^a-zA-Z0-9]+/, '').replace(/[^a-zA-Z0-9]+$/, '')
  }
  
  const best = all.reduce((a, x) => (x.length > a.length ? x : a))
  return best[0].toUpperCase() + best.slice(1)
}
