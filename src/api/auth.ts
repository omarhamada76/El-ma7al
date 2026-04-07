import { api, getApiBase } from './client'
import type { User } from '@/types/api'

export interface LoginBody {
  email: string
  password: string
}

export interface LoginResponse {
  accessToken: string
  refreshToken?: string
  user: User
}

export async function getAuthStatus(): Promise<{ needsBootstrap: boolean; hasUsers: boolean }> {
  const res = await fetch(`${getApiBase()}/auth/status`)
  if (!res.ok) throw new Error('تعذر التحقق من حالة النظام')
  return res.json()
}

export async function bootstrapAdmin(body: {
  email: string
  password: string
  display_name?: string
}): Promise<LoginResponse> {
  const res = await fetch(`${getApiBase()}/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { message?: string }
  if (!res.ok) throw new Error(data.message || 'فشل إنشاء الحساب')
  return data as LoginResponse
}

export async function login(body: LoginBody): Promise<LoginResponse> {
  if (!body.email?.trim() || !body.password || body.password.length < 6) {
    throw new Error('البريد الإلكتروني وكلمة المرور (6 أحرف على الأقل) مطلوبان')
  }
  return api.post<LoginResponse>('/auth/login', body)
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout', {}).catch(() => {})
}

export async function getMe(): Promise<User> {
  return api.get<User>('/auth/me')
}
