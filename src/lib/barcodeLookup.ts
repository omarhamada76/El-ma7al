/**
 * Some scanners emit composite strings; only the first segment is the product barcode.
 * Example: `123456|12.50|Name` → `123456`
 */
export function extractProductBarcodeForLookup(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.includes('|')) return trimmed
  return trimmed.split('|')[0]?.trim() ?? ''
}
