export interface Batch {
  id: number;
  expiryDate: string | null; // YYYY-MM-DD
  available: number;
}

export function deductStock(batch: Batch, qty: number): Batch {
  if (qty > batch.available) {
    throw new Error('Insufficient stock');
  }
  return { ...batch, available: batch.available - qty };
}

/**
 * Deducts quantity from batches using LIFO (Last-In, First-Out) logic
 * as requested for warehouse transfers.
 */
export function deductFromBatches(batches: Batch[], qty: number): Batch[] {
  const totalAvailable = batches.reduce((sum, b) => sum + (b.available ?? 0), 0);
  if (totalAvailable < qty) {
    throw new Error('Insufficient stock across all batches');
  }

  // Sort batches by ID descending (LIFO - newest first)
  const sortedBatches = [...batches].sort((a, b) => b.id - a.id);
  
  let remainingToDeduct = qty;
  const result: Batch[] = [];

  for (const batch of sortedBatches) {
    if (remainingToDeduct <= 0) {
      result.push({ ...batch });
      continue;
    }

    const available = batch.available ?? 0;
    if (available >= remainingToDeduct) {
      result.push({ ...batch, available: available - remainingToDeduct });
      remainingToDeduct = 0;
    } else {
      result.push({ ...batch, available: 0 });
      remainingToDeduct -= available;
    }
  }

  return result;
}

export interface Product {
  id: number;
  safetyStock: number;
  batches: Batch[];
}

export function isNearExpiry(product: Product, thresholdDays: number = 30): boolean {
  if (!product.batches || product.batches.length === 0) return false;
  
  const now = new Date();
  const thresholdTime = now.getTime() + thresholdDays * 24 * 60 * 60 * 1000;

  return product.batches.some(batch => {
    if (!batch.expiryDate || batch.available <= 0) return false;
    const expiryTime = new Date(batch.expiryDate).getTime();
    if (isNaN(expiryTime)) return false;
    return expiryTime <= thresholdTime;
  });
}

export function isBelowSafety(product: Product): boolean {
  if (!product.batches) return true;
  const totalAvailable = product.batches.reduce((sum, b) => sum + (b.available ?? 0), 0);
  return totalAvailable < product.safetyStock;
}

