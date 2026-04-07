import { api } from './client'
import type { Warehouse } from '@/types/api'

export async function getWarehouses(): Promise<Warehouse[]> {
  const res = await api.get<Warehouse[] | { data: Warehouse[] }>('/warehouses')
  return Array.isArray(res) ? res : (res as { data: Warehouse[] }).data ?? []
}
