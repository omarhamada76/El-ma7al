import { api } from './client'
import type { SupplierPurchase } from '@/types/api'

export interface CreateSupplierPurchaseBody {
  supplier_id: number
  warehouse_id: number
  total_amount: number
  notes?: string
  items: {
    product_id: number
    quantity: number
    unit_price: number
    total_price: number
  }[]
}

export async function createSupplierPurchase(
  body: CreateSupplierPurchaseBody
): Promise<SupplierPurchase> {
  return api.post('/supplier-purchases', body)
}

export async function getSupplierPurchase(
  id: string
): Promise<SupplierPurchase & { items?: unknown[] }> {
  return api.get(`/supplier-purchases/${id}`)
}

/** استلام بضاعة + توزيع على المخازن (اجهور / شبرا). يزيد مديونية المورد ويزيد المخزون. */
export interface CreateSupplierReceiptBody {
  supplier_id: number
  notes?: string
  items: {
    product_id: number
    quantity: number
    unit_price: number
    /** If set, applied to the new batch(es) and product; otherwise server uses default markup from settings. */
    selling_price?: number
    expiry_date: string
    distribution: Record<number, number> // warehouse_id -> quantity (sum must = quantity)
  }[]
}

export async function createSupplierReceiptWithDistribution(
  body: CreateSupplierReceiptBody
): Promise<SupplierPurchase[]> {
  const res = await api.post<SupplierPurchase[] | { id: number }>('/supplier-receipts', body)
  return Array.isArray(res) ? res : [res as unknown as SupplierPurchase]
}
