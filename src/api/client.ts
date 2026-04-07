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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  if (token) (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${getApiBase()}${path}`, {
    cache: 'no-store',
    ...options,
    headers,
  })
  if (res.status === 401) {
    const storageKey = 'vet-pharmacy-auth'
    localStorage.removeItem(storageKey)
    sessionStorage.removeItem(storageKey)
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; key?: string }
    let msg = err.message || res.statusText || 'Request failed'
    if (res.status === 404 && err.key) {
      msg = `${msg} (${err.key})`
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
