import { api } from './client'
import type { BarnBillingCycle } from '@/types/api'

export async function getBarnBillingCycles(barnId: string): Promise<{
  data: BarnBillingCycle[]
  open_cycle_id: number | null
}> {
  return api.get(`/barns/${barnId}/billing-cycles`)
}

export async function startBarnBillingCycle(
  barnId: string,
  body?: { started_at?: string; carry_in?: number }
): Promise<BarnBillingCycle> {
  return api.post(`/barns/${barnId}/billing-cycles/start`, body ?? {})
}

export async function endBarnBillingCycle(
  barnId: string,
  body?: { ended_at?: string }
): Promise<BarnBillingCycle> {
  return api.post(`/barns/${barnId}/billing-cycles/end`, body ?? {})
}
