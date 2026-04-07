import { api } from './client'
import type { AccountStatement } from '@/types/api'

function stmtQuery(params: { from?: string; to?: string }): string {
  const q = new URLSearchParams()
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  const s = q.toString()
  return s ? `?${s}` : ''
}

function isAccountStatementPayload(data: unknown): data is AccountStatement {
  return (
    data != null &&
    typeof data === 'object' &&
    Array.isArray((data as AccountStatement).rows)
  )
}

function normalizeStatement(data: AccountStatement): AccountStatement {
  const ob = Number(data.opening_balance)
  const cb = Number(data.closing_balance)
  return {
    opening_balance: Number.isFinite(ob) ? ob : 0,
    closing_balance: Number.isFinite(cb) ? cb : 0,
    rows: Array.isArray(data.rows) ? data.rows : [],
    cycle: data.cycle,
    after_cycle: data.after_cycle,
  }
}

/** Tries canonical URL first, then legacy routes (some proxies / older servers mis-route `/clients/:id/account-statement` to the client profile). */
async function getStatement(paths: string[]): Promise<AccountStatement> {
  let lastError: unknown
  for (const path of paths) {
    try {
      const data = await api.get<unknown>(path)
      if (isAccountStatementPayload(data)) {
        return normalizeStatement(data)
      }
    } catch (e) {
      lastError = e
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('تعذر تحميل كشف الحساب — استجابة غير صالحة من الخادم')
}

export async function getClientAccountStatement(
  clientId: string,
  params: { from?: string; to?: string } = {}
): Promise<AccountStatement> {
  const q = stmtQuery(params)
  return getStatement([
    `/clients/${clientId}/account-statement${q}`,
    `/account-statement/client/${clientId}${q}`,
  ])
}

export async function getBarnAccountStatement(
  barnId: string,
  params: { from?: string; to?: string } = {}
): Promise<AccountStatement> {
  const q = stmtQuery(params)
  return getStatement([
    `/barns/${barnId}/account-statement${q}`,
    `/account-statement/barn/${barnId}${q}`,
  ])
}

export async function getBillingCycleAccountStatement(cycleId: number): Promise<AccountStatement> {
  const data = await api.get<unknown>(`/billing-cycles/${cycleId}/account-statement`)
  if (isAccountStatementPayload(data)) {
    return normalizeStatement(data)
  }
  throw new Error('تعذر تحميل كشف الدورة')
}

export async function getClientStatementAfterCycle(
  clientId: string,
  cycleId: number
): Promise<AccountStatement> {
  const data = await api.get<unknown>(
    `/clients/${clientId}/statement-after-cycle?cycle_id=${encodeURIComponent(String(cycleId))}`
  )
  if (isAccountStatementPayload(data)) {
    return normalizeStatement(data)
  }
  throw new Error('تعذر تحميل كشف ما بعد الدورة')
}

export async function getBarnBillingCycleAccountStatement(cycleId: number): Promise<AccountStatement> {
  const data = await api.get<unknown>(`/barn-billing-cycles/${cycleId}/account-statement`)
  if (isAccountStatementPayload(data)) {
    return normalizeStatement(data)
  }
  throw new Error('تعذر تحميل كشف دورة العنبر')
}

export async function getBarnStatementAfterCycle(
  barnId: string,
  cycleId: number
): Promise<AccountStatement> {
  const data = await api.get<unknown>(
    `/barns/${barnId}/statement-after-cycle?cycle_id=${encodeURIComponent(String(cycleId))}`
  )
  if (isAccountStatementPayload(data)) {
    return normalizeStatement(data)
  }
  throw new Error('تعذر تحميل كشف ما بعد الدورة')
}
