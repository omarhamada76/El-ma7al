import { api } from './client'
import type { Supplier, SupplierPurchase, SupplierPurchaseWithItems, SupplierPayment } from '@/types/api'

export interface SuppliersParams {
  page?: number
  limit?: number
  search?: string
}

export async function getSuppliers(params: SuppliersParams = {}): Promise<{
  data: Supplier[]
  total: number
}> {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)) })
  return api.get(`/suppliers${q.toString() ? `?${q}` : ''}`)
}

export async function getSupplier(id: string): Promise<Supplier> {
  return api.get(`/suppliers/${id}`)
}

export async function getSupplierBalance(id: string): Promise<{ balance: number }> {
  return api.get(`/suppliers/${id}/balance`)
}

export async function getSupplierPurchases(
  id: string,
  params?: { page?: number; limit?: number }
): Promise<{ data: SupplierPurchase[]; total: number }> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  return api.get(`/suppliers/${id}/purchases${q.toString() ? `?${q}` : ''}`)
}

export async function getSupplierPurchasesWithItems(
  id: string,
  params?: { limit?: number }
): Promise<{ data: SupplierPurchaseWithItems[]; total: number }> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  return api.get(`/suppliers/${id}/purchases/with-items${q.toString() ? `?${q}` : ''}`)
}

export async function getSupplierPayments(
  id: string,
  params?: { page?: number; limit?: number }
): Promise<{ data: SupplierPayment[]; total: number }> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  return api.get(`/suppliers/${id}/payments${q.toString() ? `?${q}` : ''}`)
}

export async function createSupplier(body: Partial<Supplier>): Promise<Supplier> {
  return api.post('/suppliers', body)
}

export async function updateSupplier(id: string, body: Partial<Supplier>): Promise<Supplier> {
  return api.patch(`/suppliers/${id}`, body)
}

export async function deleteSupplier(id: string): Promise<void> {
  return api.delete(`/suppliers/${id}`)
}
