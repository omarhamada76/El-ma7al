import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Menu, Moon, Sun, User } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils'

interface HeaderProps {
  onMenuClick?: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.classList.contains('dark')
  })

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleDark = () => {
    document.documentElement.classList.toggle('dark', !dark)
    setDark(!dark)
  }

  return (
    <header className="h-14 flex items-center justify-between px-3 sm:px-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
      <button
        type="button"
        className="md:hidden p-2.5 -m-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 touch-manipulation"
        onClick={onMenuClick}
        aria-label="فتح القائمة"
      >
        <Menu className="w-6 h-6" />
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={toggleDark}
          className="p-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 touch-manipulation"
          aria-label={dark ? 'وضع فاتح' : 'وضع داكن'}
        >
          {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen((o) => !o)}
            className="flex items-center gap-2 p-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 touch-manipulation min-h-[44px]"
          >
            <User className="w-5 h-5 flex-shrink-0" />
            <span className="hidden sm:inline text-sm truncate max-w-[120px] md:max-w-[180px]">
              {user?.display_name || user?.email}
            </span>
          </button>
          <div
            className={cn(
              'absolute top-full left-0 right-auto mt-1 py-1 w-48 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50',
              userMenuOpen ? 'block' : 'hidden'
            )}
          >
            <Link
              to="/settings"
              className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded min-h-[44px] items-center"
              onClick={() => setUserMenuOpen(false)}
            >
              <User className="w-4 h-4" />
              الإعدادات
            </Link>
            <button
              type="button"
              className="flex items-center gap-2 w-full px-3 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-red-600 dark:text-red-400 min-h-[44px] items-center text-right"
              onClick={() => {
                logout()
                setUserMenuOpen(false)
              }}
            >
              <LogOut className="w-4 h-4" />
              تسجيل الخروج
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
