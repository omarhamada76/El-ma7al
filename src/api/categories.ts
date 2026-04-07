import { api } from './client'

/** List of category names for filter and product form */
export async function getCategoryOptions(): Promise<string[]> {
  const res = await api.get<string[]>('/categories/options')
  return Array.isArray(res) ? res : []
}

/** Add a new category (الفئة) */
export async function createCategory(name_ar: string): Promise<{ id: number; name_ar: string }> {
  return api.post('/categories', { name_ar: name_ar.trim() })
}
