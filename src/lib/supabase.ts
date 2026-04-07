/**
 * Supabase has been removed. The app uses only the local backend (Node + SQLite).
 * These exports exist so existing imports do not break.
 */

export const useLocalBackend = (): boolean => true
export const isSupabaseConfigured = false
export const supabase = null
