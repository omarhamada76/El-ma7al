import { api } from './client'

export interface TransferItem {
  product_id: number
  product_name: string
  quantity: number
}

export interface CreateTransferBody {
  from_warehouse_id: number
  to_warehouse_id: number
  notes?: string
  items: Omit<TransferItem, 'product_name'>[]
}

export interface InventoryTransfer {
  id: number
  from_warehouse_id: number
  to_warehouse_id: number
  from_warehouse_name?: string
  to_warehouse_name?: string
  notes: string | null
  created_at: string
  items: TransferItem[]
}

export async function createInventoryTransfer(
  body: CreateTransferBody
): Promise<InventoryTransfer> {
  return api.post('/inventory-transfers', body)
}

export async function getInventoryTransfers(
  limit = 50
): Promise<InventoryTransfer[]> {
  const res = await api.get<{ data: InventoryTransfer[] }>(
    `/inventory-transfers?limit=${limit}`
  )
  return res.data
}
