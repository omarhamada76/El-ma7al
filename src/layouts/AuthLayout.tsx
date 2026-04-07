import { Outlet, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'

export default function AuthLayout() {
  const token = useAuthStore((s) => s.token)

  if (token) return <Navigate to="/dashboard" replace />

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 dark:from-gray-900 dark:to-gray-800 p-3 sm:p-4 safe-area-padding">
      <Outlet />
    </div>
  )
}
