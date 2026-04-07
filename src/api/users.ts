import { api } from './client'
import type { User, UserRole } from '@/types/api'

export async function getUsers(): Promise<{ data: User[] }> {
  return api.get('/users')
}

export async function createUser(body: {
  email: string
  password: string
  display_name?: string
  role: UserRole
}): Promise<User> {
  return api.post('/users', body)
}

export async function updateUser(
  id: string,
  body: Partial<{
    display_name: string
    role: UserRole
    is_active: boolean
    password: string
  }>
): Promise<User> {
  return api.patch(`/users/${id}`, body)
}

export async function deleteUser(id: string): Promise<void> {
  return api.delete(`/users/${id}`)
}
