import { api } from './client'
import type { DailySalesPoint, DashboardStats } from '@/types/api'
import type { Invoice } from '@/types/api'

export interface CategoryReportRow {
  category: string
  total_sales: number
  total_quantity: number
}

export interface TopProductRow {
  product_id: number
  name: string
  total_sales: number
  total_quantity: number
}

const MOCK_STATS: DashboardStats = {
  total_sales: 0,
  total_profit: 0,
  client_debt: 0,
  total_deferred_receivable: 0,
  product_count: 0,
  low_stock_count: 0,
  expiring_count: 0,
  unpaid_invoices_count: 0,
  safe_balance: 0,
  supplier_payable: 0,
  clients_count: 0,
  invoices_count: 0,
}

export async function getDashboardStats(params: { from?: string; to?: string } = {}): Promise<DashboardStats> {
  const q = new URLSearchParams()
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  const query = q.toString()
  try {
    return await api.get<DashboardStats>(`/reports/dashboard${query ? `?${query}` : ''}`)
  } catch {
    return MOCK_STATS
  }
}

export async function getSalesByCategory(params: { from?: string; to?: string } = {}): Promise<CategoryReportRow[]> {
  const q = new URLSearchParams()
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  const query = q.toString()
  const res = await api.get<{ data: CategoryReportRow[] } | CategoryReportRow[]>(
    `/reports/by-category${query ? `?${query}` : ''}`
  )
  return Array.isArray(res) ? res : res.data ?? []
}

export async function getTopProducts(
  params: { from?: string; to?: string; limit?: number; warehouse_id?: number } = {}
): Promise<TopProductRow[]> {
  const q = new URLSearchParams()
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.warehouse_id != null) q.set('warehouse_id', String(params.warehouse_id))
  const query = q.toString()
  const res = await api.get<{ data: TopProductRow[] } | TopProductRow[]>(
    `/reports/top-products${query ? `?${query}` : ''}`
  )
  return Array.isArray(res) ? res : res.data ?? []
}

export async function getSalesByDay(
  params: { days?: number; from?: string; to?: string } = {}
): Promise<DailySalesPoint[]> {
  const q = new URLSearchParams()
  if (params.from && params.to) {
    q.set('from', params.from)
    q.set('to', params.to)
  } else if (params.days != null) {
    q.set('days', String(params.days))
  }
  const query = q.toString()
  try {
    const res = await api.get<{ data: DailySalesPoint[] } | DailySalesPoint[]>(
      `/reports/sales-by-day${query ? `?${query}` : ''}`
    )
    return Array.isArray(res) ? res : res.data ?? []
  } catch {
    return []
  }
}

export async function getRecentInvoices(): Promise<Invoice[]> {
  try {
    const res = await api.get<{ data: Invoice[] } | Invoice[]>('/invoices?limit=5')
    return Array.isArray(res) ? res : (res as { data: Invoice[] }).data ?? []
  } catch {
    return []
  }
}
