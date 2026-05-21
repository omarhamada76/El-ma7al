import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Menu, Moon, Sun, User, Settings } from 'lucide-react'
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
    const newDark = !dark
    document.documentElement.classList.toggle('dark', newDark)
    setDark(newDark)
    localStorage.setItem('theme', newDark ? 'dark' : 'light')
  }

  return (
    <header className="h-14 flex items-center justify-between px-3 sm:px-4 border-b border-gray-200/50 dark:border-gray-700/50 bg-white/70 dark:bg-gray-800/70 backdrop-blur-md flex-shrink-0">
      <button
        type="button"
        className="md:hidden p-2.5 -m-2.5 rounded-xl hover:bg-gray-100/70 dark:hover:bg-gray-700/70 touch-manipulation transition-colors"
        onClick={onMenuClick}
        aria-label="فتح القائمة"
      >
        <Menu className="w-6 h-6" />
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-1 sm:gap-2">

        {/* Scanner Active Badge */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40"
          title="قارئ الباركود نشط"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-glow flex-shrink-0" />
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">الماسح نشط</span>
        </div>

        <button
          type="button"
          onClick={toggleDark}
          className="p-2.5 rounded-xl hover:bg-gray-100/70 dark:hover:bg-gray-700/70 touch-manipulation transition-colors"
          aria-label={dark ? 'وضع فاتح' : 'وضع داكن'}
        >
          {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen((o) => !o)}
            className="flex items-center gap-2 p-2.5 rounded-xl hover:bg-gray-100/70 dark:hover:bg-gray-700/70 touch-manipulation min-h-[44px] transition-colors"
          >
            <User className="w-5 h-5 flex-shrink-0" />
            <span className="hidden sm:inline text-sm truncate max-w-[120px] md:max-w-[180px]">
              {user?.display_name || user?.email}
            </span>
          </button>
          <div
            className={cn(
              'absolute top-full left-0 mt-3 py-1.5 w-56 max-w-[calc(100vw-2rem)] glass-modal rounded-2xl shadow-2xl z-50',
              'transition-all origin-top-left',
              userMenuOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0 pointer-events-none'
            )}
          >
            <div className="px-3 py-2 border-b border-gray-100/50 dark:border-gray-700/50 mb-1 sm:hidden">
              <p className="text-xs font-bold text-gray-500 uppercase">المستخدم</p>
              <p className="text-sm font-semibold truncate">{user?.display_name || user?.email}</p>
            </div>
            <Link
              to="/settings"
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-gray-50/70 dark:hover:bg-gray-700/50 transition-colors rounded-xl mx-1"
              onClick={() => setUserMenuOpen(false)}
            >
              <Settings className="w-4 h-4 text-gray-400" />
              <span>الإعدادات</span>
            </Link>
            <button
              type="button"
              className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium hover:bg-red-50/70 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors text-right rounded-xl mx-1"
              onClick={() => {
                logout()
                setUserMenuOpen(false)
              }}
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
