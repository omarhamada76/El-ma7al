import { api } from './client'
import type { Payment } from '@/types/api'

export interface CreatePaymentBody {
  client_id: number
  barn_id: number | null
  amount: number
  payment_method: string
  notes?: string
  payment_date?: string
  invoice_id?: number
  wallet_id?: number | null
}

export interface PaymentsParams {
  page?: number
  limit?: number
  client_id?: number
  barn_id?: number
  payment_method?: string
  from?: string
  to?: string
}

export async function getPayments(params: PaymentsParams = {}): Promise<{
  data: Payment[]
  total: number
}> {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)) })
  return api.get(`/payments${q.toString() ? `?${q}` : ''}`)
}

export async function getPayment(id: string): Promise<Payment> {
  return api.get(`/payments/${id}`)
}

export async function createPayment(body: CreatePaymentBody): Promise<Payment> {
  return api.post('/payments', body)
}

export async function createClientPayment(
  clientId: string,
  body: Omit<CreatePaymentBody, 'client_id'>
): Promise<Payment> {
  return api.post(`/clients/${clientId}/payments`, body)
}
