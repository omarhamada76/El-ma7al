import { api } from './client'
import type { BillingCycle } from '@/types/api'

export async function getClientBillingCycles(clientId: string): Promise<{
  data: BillingCycle[]
  open_cycle_id: number | null
}> {
  return api.get(`/clients/${clientId}/billing-cycles`)
}

export async function startBillingCycle(
  clientId: string,
  body?: { started_at?: string; carry_in?: number }
): Promise<BillingCycle> {
  return api.post(`/clients/${clientId}/billing-cycles/start`, body ?? {})
}

export async function endBillingCycle(
  clientId: string,
  body?: { ended_at?: string }
): Promise<BillingCycle> {
  return api.post(`/clients/${clientId}/billing-cycles/end`, body ?? {})
}
