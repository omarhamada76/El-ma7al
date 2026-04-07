import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

export const AUTH_STORAGE_KEY = 'vet-pharmacy-auth'

export type UserRole = 'super_admin' | 'admin' | 'staff'

export interface User {
  id: string
  email: string
  display_name: string | null
  role: UserRole
}

/** Prefer localStorage (remember me); fall back to session-only session */
const hybridStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name) ?? sessionStorage.getItem(name),
  setItem: (name, value) => {
    try {
      const parsed = JSON.parse(value) as { state?: { rememberMe?: boolean } }
      const remember = parsed.state?.rememberMe !== false
      if (remember) {
        localStorage.setItem(name, value)
        sessionStorage.removeItem(name)
      } else {
        sessionStorage.setItem(name, value)
        localStorage.removeItem(name)
      }
    } catch {
      localStorage.setItem(name, value)
    }
  },
  removeItem: (name) => {
    localStorage.removeItem(name)
    sessionStorage.removeItem(name)
  },
}

interface AuthState {
  token: string | null
  refreshToken: string | null
  user: User | null
  /** When true, session is stored in localStorage and survives browser restarts */
  rememberMe: boolean
  setAuth: (
    token: string,
    refreshToken: string | null,
    user: User,
    rememberMe: boolean
  ) => void
  logout: () => void
  setUser: (user: User) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      rememberMe: true,
      setAuth: (token, refreshToken, user, rememberMe) =>
        set({ token, refreshToken, user, rememberMe }),
      logout: () =>
        set({ token: null, refreshToken: null, user: null, rememberMe: true }),
      setUser: (user) => set({ user }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => hybridStorage),
    }
  )
)
