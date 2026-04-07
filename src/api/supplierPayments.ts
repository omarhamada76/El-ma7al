import { api } from './client'
import type { SupplierPayment } from '@/types/api'

export interface CreateSupplierPaymentBody {
  supplier_id: number
  amount: number
  payment_method?: string
  notes?: string
  payment_date?: string
}

export async function createSupplierPayment(
  body: CreateSupplierPaymentBody
): Promise<SupplierPayment> {
  return api.post('/supplier-payments', body)
}
