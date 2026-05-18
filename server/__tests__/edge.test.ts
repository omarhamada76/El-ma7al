import { normalizeInvoiceScanToken, extractProductBarcodeForLookup } from '../../src/lib/barcodeLookup'
import { parseScannedBarcode, isExpiryWithinDays } from '../../src/lib/scanCodes'

describe('Edge-case parsing behavior', () => {
  it('normalizes noisy scanner token to longest batch token', () => {
    expect(normalizeInvoiceScanToken(']C1B47XXB478YY')).toBe('B478')
  })

  it('normalizes noisy scanner token to longest bag token', () => {
    expect(normalizeInvoiceScanToken('abcG9xG123')).toBe('G123')
  })

  it('extractProductBarcodeForLookup keeps only first composite segment', () => {
    expect(extractProductBarcodeForLookup('123456|12.50|Product Name')).toBe('123456')
  })

  it('parseScannedBarcode reads pure batch shorthand digits', () => {
    expect(parseScannedBarcode('0124')).toEqual({ kind: 'batch', batchId: 124, isExplicit: false, rawToken: '0124' })
  })

  it('parseScannedBarcode reads bag barcode', () => {
    expect(parseScannedBarcode('G15')).toEqual({ kind: 'bag', bagInstanceId: 15, isExplicit: true, rawToken: 'G15' })
  })

  it('parseScannedBarcode reads composite product payload', () => {
    expect(parseScannedBarcode('ABC123||18.5||فيتامين||77||2026-12-31')).toEqual({
      kind: 'product',
      code: 'ABC123',
      unitPrice: 18.5,
      productName: 'فيتامين',
      batchId: 77,
      expiryDate: '2026-12-31',
      rawToken: 'ABC123||18.5||فيتامين||77||2026-12-31',
    })
  })

  it('isExpiryWithinDays returns false for placeholder never-expire date', () => {
    expect(isExpiryWithinDays('9999-12-31', 90)).toBe(false)
  })

  it('isExpiryWithinDays returns true for near date and false for far date', () => {
    const near = new Date()
    near.setDate(near.getDate() + 5)
    const far = new Date()
    far.setDate(far.getDate() + 120)
    expect(isExpiryWithinDays(near.toISOString().slice(0, 10), 30)).toBe(true)
    expect(isExpiryWithinDays(far.toISOString().slice(0, 10), 30)).toBe(false)
  })
})
