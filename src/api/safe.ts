import { api } from './client'
import type { SafeTransaction } from '@/types/api'

export async function getSafeBalance(): Promise<{ balance: number }> {
  return api.get('/safe/balance')
}

export async function getSafeTransactions(params?: {
  from?: string
  to?: string
  type?: string
  page?: number
  limit?: number
}): Promise<{ data: SafeTransaction[]; total: number }> {
  const q = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)) })
  return api.get(`/safe/transactions${q.toString() ? `?${q}` : ''}`)
}

export async function setInitialBalance(body: { amount: number; notes?: string }): Promise<void> {
  return api.post('/safe/initial', body)
}

export async function safeAdjustment(body: {
  type: 'adjustment_in' | 'adjustment_out'
  amount: number
  notes?: string
}): Promise<void> {
  return api.post('/safe/adjustment', body)
}

export async function deleteSafeTransaction(id: number): Promise<void> {
  return api.delete(`/safe/transactions/${id}`)
}

/** Removes all deletable log rows (not linked to customer/supplier payments). */
export async function clearSafeDeletableHistory(): Promise<{ deleted: number }> {
  return api.post('/safe/clear-history', {})
}
