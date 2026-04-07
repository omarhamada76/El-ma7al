import { api } from './client'
import type { Barn } from '@/types/api'

export async function getBarn(id: string): Promise<Barn> {
  return api.get(`/barns/${id}`)
}

export async function createBarn(
  clientId: string,
  body: { name: string; initial_debt?: number }
): Promise<Barn> {
  return api.post(`/clients/${clientId}/barns`, body)
}

export async function updateBarn(id: string, body: Partial<Barn>): Promise<Barn> {
  return api.patch(`/barns/${id}`, body)
}

export async function deleteBarn(id: string): Promise<void> {
  return api.delete(`/barns/${id}`)
}
