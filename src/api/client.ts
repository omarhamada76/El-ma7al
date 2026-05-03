import { AUTH_STORAGE_KEY } from '@/stores/auth'

/** API base, e.g. `/api/v1` or `https://api.example.com/api/v1` when `VITE_API_ORIGIN` is set. */
export function getApiBase(): string {
  let o = import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, '')
  if (!o) return '/api/v1'
  // Avoid double /api/v1 when env is already `https://host/api/v1`
  if (o.endsWith('/api/v1')) {
    o = o.slice(0, -'/api/v1'.length).replace(/\/$/, '')
  }
  return `${o}/api/v1`
}

function getToken(): string | null {
  try {
    const raw =
      localStorage.getItem(AUTH_STORAGE_KEY) ??
      sessionStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { state?: { token?: string | null } }
    return data?.state?.token ?? null
  } catch {
    return null
  }
}

function normalizeDecimalStrings<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeDecimalStrings(v)) as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeDecimalStrings(v)
    }
    return out as T
  }
  if (typeof value === 'string' && /^-?\d+\.\d+$/.test(value)) {
    const n = Number(value)
    if (Number.isFinite(n)) return n as T
  }
  return value
}

export class ApiError extends Error {
  status: number
  code?: string
  can_force?: boolean
  details?: unknown

  constructor(message: string, status: number, opts?: { code?: string; can_force?: boolean; details?: unknown }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = opts?.code
    this.can_force = opts?.can_force
    this.details = opts?.details
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  // Supabase Edge Functions require apikey and Authorization headers
  if (anonKey) {
    headers['apikey'] = anonKey
    if (!token) {
      headers['Authorization'] = `Bearer ${anonKey}`
    }
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${getApiBase()}${path}`, {
    cache: 'no-store',
    ...options,
    headers,
  })
  const readErrBody = async () => {
    try {
      return (await res.json()) as { message?: string; error?: string; key?: string; code?: string; can_force?: boolean; references?: unknown }
    } catch {
      return {}
    }
  }
  if (res.status === 401) {
    const err = await readErrBody()
    const msg = err.message || err.error || 'Unauthorized'
    // Keep login UX clear: show backend reason instead of forcing generic unauthorized.
    if (path.startsWith('/auth/login') || path.startsWith('/auth/bootstrap')) {
      throw new Error(msg)
    }
    const storageKey = 'vet-pharmacy-auth'
    localStorage.removeItem(storageKey)
    sessionStorage.removeItem(storageKey)
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    throw new Error(msg)
  }
  if (!res.ok) {
    const err = await readErrBody()
    let msg = err.message || err.error || res.statusText || 'Request failed'
    if (res.status === 404 && err.key) {
      msg = `${msg} (${err.key})`
    }
    throw new ApiError(msg, res.status, {
      code: err.code,
      can_force: err.can_force,
      details: err.references,
    })
  }
  if (res.status === 204) return undefined as T
  const data = (await res.json()) as T
  return normalizeDecimalStrings(data)
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
