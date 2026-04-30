import {
  deductStock,
  deductFromBatches,
  isNearExpiry,
  isBelowSafety,
  type Batch,
  type Product,
} from '../lib/inventory'

describe('Inventory logic', () => {
  it('deductStock decreases available quantity', () => {
    const batch: Batch = { id: 1, expiryDate: '2026-12-31', available: 100 }
    const result = deductStock(batch, 20)
    expect(result.available).toBe(80)
    expect(batch.available).toBe(100) // no mutation
  })

  it('deductStock throws on insufficient quantity', () => {
    const batch: Batch = { id: 1, expiryDate: '2026-12-31', available: 5 }
    expect(() => deductStock(batch, 6)).toThrow('Insufficient stock')
  })

  it('deductFromBatches follows LIFO (highest id first)', () => {
    const older: Batch = { id: 1, expiryDate: '2026-01-01', available: 10 }
    const newer: Batch = { id: 2, expiryDate: '2026-06-01', available: 20 }
    const result = deductFromBatches([older, newer], 15)
    const olderAfter = result.find((b) => b.id === 1)
    const newerAfter = result.find((b) => b.id === 2)

    expect(newerAfter?.available).toBe(5)
    expect(olderAfter?.available).toBe(10)
  })

  it('deductFromBatches throws when total stock is insufficient', () => {
    const a: Batch = { id: 1, expiryDate: '2026-01-01', available: 10 }
    const b: Batch = { id: 2, expiryDate: '2026-06-01', available: 20 }
    expect(() => deductFromBatches([a, b], 50)).toThrow('Insufficient stock across all batches')
  })

  it('isNearExpiry returns true when any in-stock batch is within threshold', () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 7)
    const product: Product = {
      id: 1,
      safetyStock: 50,
      batches: [
        { id: 1, expiryDate: soon.toISOString().split('T')[0], available: 2 },
        { id: 2, expiryDate: '2028-01-01', available: 10 },
      ],
    }
    expect(isNearExpiry(product, 30)).toBe(true)
  })

  it('isNearExpiry ignores empty and invalid-date batches', () => {
    const product: Product = {
      id: 1,
      safetyStock: 50,
      batches: [
        { id: 1, expiryDate: 'not-a-date', available: 10 },
        { id: 2, expiryDate: '2026-02-01', available: 0 },
      ],
    }
    expect(isNearExpiry(product, 30)).toBe(false)
  })

  it('isBelowSafety returns true when total available is below threshold', () => {
    const product: Product = {
      id: 1,
      safetyStock: 50,
      batches: [
        { id: 1, expiryDate: '2026-01-01', available: 20 },
        { id: 2, expiryDate: '2026-06-01', available: 10 },
      ],
    }
    expect(isBelowSafety(product)).toBe(true)
  })

  it('isBelowSafety returns false when total available meets threshold', () => {
    const product: Product = {
      id: 1,
      safetyStock: 30,
      batches: [
        { id: 1, expiryDate: '2026-01-01', available: 20 },
        { id: 2, expiryDate: '2026-06-01', available: 10 },
      ],
    }
    expect(isBelowSafety(product)).toBe(false)
  })
})
