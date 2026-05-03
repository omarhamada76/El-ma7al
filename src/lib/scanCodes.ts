const SCAN_SEP = '||'

export type ParsedScan =
  | { kind: 'batch'; batchId: number; rawToken?: string; isExplicit?: boolean }
  | { kind: 'bag'; bagInstanceId: number; rawToken?: string; isExplicit?: boolean }
  | {
      kind: 'product'
      code: string
      unitPrice: number | null
      productName: string | null
      batchId: number | null
      expiryDate: string | null
      rawToken?: string
    }

/** Remove invisible / direction marks often inserted by scanners or PDF paste. */
function stripInvisible(s: string): string {
  return s.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '')
}

/** When the string is not exactly `B123` (prefix/suffix), pick longest B… or G… token. */
function extractLongestBatchOrBagToken(t: string): ParsedScan | null {
  const b = [...t.matchAll(/B(\d+)/gi)].map((m) => ({
    kind: 'batch' as const,
    id: parseInt(m[1], 10),
    len: `B${m[1]}`.length,
  }))
  const g = [...t.matchAll(/G(\d+)/gi)].map((m) => ({
    kind: 'bag' as const,
    id: parseInt(m[1], 10),
    len: `G${m[1]}`.length,
  }))
  const all = [...b, ...g]
  if (all.length === 0) return null
  const best = all.reduce((a, x) => (x.len > a.len ? x : a))
  if (best.kind === 'batch') return { kind: 'batch', batchId: best.id, rawToken: t, isExplicit: true }
  return { kind: 'bag', bagInstanceId: best.id, rawToken: t, isExplicit: true }
}

/** Batch label / invoice scan: `B7` → batch id 7 */
export function getBatchBarcodeValue(batchId: number): string {
  return `B${batchId}`
}

/** Bulk bag label scan: `G15` → bag_instances.id 15 */
export function getBagBarcodeValue(bagInstanceId: number): string {
  return `G${bagInstanceId}`
}

/** True if string is YYYY-MM-DD and within `days` days from today (inclusive of today as day 0). */
export function isExpiryWithinDays(expiryDate: string | null | undefined, days: number): boolean {
  if (!expiryDate || expiryDate === '9999-12-31') return false
  const d = /^\d{4}-\d{2}-\d{2}$/.test(expiryDate) ? new Date(expiryDate + 'T12:00:00') : new Date(expiryDate)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(d)
  exp.setHours(0, 0, 0, 0)
  const diffMs = exp.getTime() - today.getTime()
  const diffDays = diffMs / (86400 * 1000)
  return diffDays >= 0 && diffDays <= days
}

export function parseScannedBarcode(raw: string): ParsedScan {
  const s = stripInvisible((raw || '').trim())
  if (!s) {
    return { kind: 'product', code: '', unitPrice: null, productName: null, batchId: null, expiryDate: null, rawToken: s }
  }

  const batchM = /^B(\d+)$/i.exec(s)
  if (batchM) {
    return { kind: 'batch', batchId: parseInt(batchM[1], 10), rawToken: s, isExplicit: true }
  }

  // Treat pure numeric codes (up to 8 digits) as potential Batch IDs (e.g. "418" or "0056")
  const numericBatchM = /^\d{1,8}$/.exec(s)
  if (numericBatchM) {
    return { kind: 'batch', batchId: parseInt(numericBatchM[0], 10), rawToken: s, isExplicit: false }
  }

  const bagM = /^G(\d+)$/i.exec(s)
  if (bagM) {
    return { kind: 'bag', bagInstanceId: parseInt(bagM[1], 10), rawToken: s, isExplicit: true }
  }

  // Prefix/suffix junk (no pipe composite): e.g. "]C1B47" or "scanB47end"
  if (!s.includes('|') && !s.includes(SCAN_SEP)) {
    const loose = extractLongestBatchOrBagToken(s)
    if (loose) return loose
  }

  const useDouble = s.includes(SCAN_SEP)
  const parts = useDouble ? s.split(SCAN_SEP) : s.split('|')

  const code = parts[0]?.trim() ?? ''
  const price = parts.length >= 2 ? parseFloat(parts[1].trim()) : NaN
  const unitPrice = Number.isFinite(price) ? price : null
  const productName = parts.length >= 3 ? parts[2].trim() || null : null
  const batchId = parts.length >= 4 ? (parseInt(parts[3].trim(), 10) || null) : null
  const expiryDate = parts.length >= 5 ? parts[4].trim() || null : null

  return { kind: 'product', code, unitPrice, productName, batchId, expiryDate, rawToken: s }
}
