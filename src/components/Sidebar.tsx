import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  Package,
  PackageCheck,
  Truck,
  Wallet,
  FileText,
  Receipt,
  CreditCard,
  BarChart3,
  Settings,
  UserCog,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { canViewFinancials } from '@/lib/roles'

const navItemsAll = [
  { to: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
  { to: '/clients', label: 'العملاء', icon: Users },
  { to: '/inventory', label: 'المخزون', icon: Package },
  { to: '/suppliers', label: 'الموردون', icon: Truck },
  { to: '/safe', label: 'الخزنه', icon: Wallet },
  { to: '/invoices/new', label: 'فاتورة بيع جديدة', icon: FileText },
  { to: '/receipt/new', label: 'استلام البضاعة', icon: PackageCheck },
  { to: '/invoices', label: 'سجل الفواتير', icon: Receipt },
  { to: '/payments', label: 'سجل المدفوعات', icon: CreditCard },
  { to: '/reports', label: 'التقارير', icon: BarChart3 },
  { to: '/settings', label: 'الإعدادات', icon: Settings },
]

/** موظف: عمليات يومية فقط (بدون تقارير أرباح، خزنة، موردين كاملة، إعدادات نسبة الربح) */
const staffNavTos = new Set([
  '/dashboard',
  '/clients',
  '/inventory',
  '/invoices/new',
  '/receipt/new',
  '/invoices',
  '/payments',
])

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin'
  const navItems = canViewFinancials(user?.role)
    ? navItemsAll
    : navItemsAll.filter((item) => staffNavTos.has(item.to))

  return (
    <aside
      className={cn(
        'flex h-dvh max-h-dvh flex-col overflow-hidden border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        'w-[var(--sidebar-width)] max-w-[85vw] flex-shrink-0',
        'fixed top-0 right-0 z-50 transition-transform duration-200 ease-out',
        'md:static md:z-auto md:max-h-dvh md:translate-x-0',
        open ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
      )}
      dir="rtl"
    >
      <div className="flex-shrink-0 border-b border-gray-200 p-4 dark:border-gray-700">
        <h1 className="text-lg font-bold text-primary-600 dark:text-primary-400">
          الصيدلية البيطرية
        </h1>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-2">
        <ul className="space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] items-center',
                    isActive
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  )
                }
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
          {isAdmin && (
            <li>
              <NavLink
                to="/users"
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] items-center',
                    isActive
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  )
                }
              >
                <UserCog className="w-5 h-5 flex-shrink-0" />
                <span>إدارة المستخدمين</span>
              </NavLink>
            </li>
          )}
        </ul>
      </nav>
    </aside>
  )
}
