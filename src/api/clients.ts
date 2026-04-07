import { api } from './client'
import type { Client, Barn } from '@/types/api'

export interface ClientsParams {
  page?: number
  limit?: number
  search?: string
  pinned?: boolean
  /** ترتيب حسب الرصيد المدين (أعلى ديناً أولاً) */
  sort?: 'debt_desc'
}

export async function getClients(params: ClientsParams = {}): Promise<{
  data: Client[]
  total: number
  debt_alert_threshold_egp?: number
}> {
  const q = new URLSearchParams()
  if (params.page != null) q.set('page', String(params.page))
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.search) q.set('search', params.search)
  if (params.pinned != null) q.set('pinned', String(params.pinned))
  if (params.sort) q.set('sort', params.sort)
  const query = q.toString()
  return api.get(`/clients${query ? `?${query}` : ''}`)
}

export async function getClient(id: string): Promise<Client> {
  return api.get(`/clients/${id}`)
}

export async function getClientBalance(id: string): Promise<{ balance: number }> {
  return api.get(`/clients/${id}/balance`)
}

export async function getClientBarns(clientId: string): Promise<Barn[]> {
  const res = await api.get<Barn[] | { data: Barn[] }>(`/clients/${clientId}/barns`)
  return Array.isArray(res) ? res : (res as { data: Barn[] }).data ?? []
}

export async function createClient(body: Partial<Client>): Promise<Client> {
  return api.post('/clients', body)
}

export async function updateClient(id: string, body: Partial<Client>): Promise<Client> {
  return api.patch(`/clients/${id}`, body)
}

export async function deleteClient(id: string): Promise<void> {
  return api.delete(`/clients/${id}`)
}

export async function togglePin(id: string): Promise<Client> {
  return api.patch(`/clients/${id}/pin`, {})
}

export async function toggleFavorite(id: string): Promise<Client> {
  return api.patch(`/clients/${id}/favorite`, {})
}
