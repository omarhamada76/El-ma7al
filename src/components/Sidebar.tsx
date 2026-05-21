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
  ArrowRightLeft,
  ClipboardList,
  RotateCcw,
  Tag,
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
  { to: '/returns/new', label: 'مرتجع مبيعات', icon: RotateCcw },
  { to: '/transfer-to-shobra', label: 'تحويل بضاعه لشبرا', icon: ArrowRightLeft },
  { to: '/transfer-history', label: 'سجل التحويلات', icon: ClipboardList },
  { to: '/invoices', label: 'سجل الفواتير', icon: Receipt },
  { to: '/payments', label: 'سجل السداد', icon: CreditCard },
  { to: '/discounts', label: 'سجل الخصومات', icon: Tag },
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
  '/transfer-to-shobra',
  '/transfer-history',
  '/invoices',
  '/returns/new',
  '/payments',
  '/discounts',
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
        'flex h-dvh max-h-dvh flex-col overflow-hidden glass-sidebar',
        'w-[var(--sidebar-width)] max-w-[85vw] flex-shrink-0',
        'fixed top-0 right-0 z-50 transition-transform duration-200 ease-out',
        'md:static md:z-auto md:max-h-dvh md:translate-x-0',
        open ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
      )}
      dir="rtl"
    >
      {/* Same height + border as <Header /> so the horizontal rule is one continuous line across the top bar */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-gray-200/50 px-3 dark:border-gray-700/50 bg-transparent sm:gap-3 sm:px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/80 p-1 shadow-sm dark:bg-gray-800/80 sm:h-10 sm:w-10">
          <img src="/logo2.png" alt="الشعار" className="h-7 w-7 object-contain sm:h-8 sm:w-8" />
        </div>
        <h1 className="min-w-0 truncate text-base font-bold text-primary-600 dark:text-primary-400 sm:text-lg">
          الصيدلية البيطرية
        </h1>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-2">
        <ul className="space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-[44px] items-center group',
                    isActive
                      ? 'bg-primary-50 dark:bg-primary-950/20 text-primary-700 dark:text-primary-300 shadow-sm border-r-4 border-primary-500'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50/80 dark:hover:bg-gray-800/80 hover:translate-x-[-2px] hover:text-primary-600 dark:hover:text-primary-400'
                  )
                }
              >
                <Icon className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
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
                    'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 min-h-[44px] items-center group',
                    isActive
                      ? 'bg-primary-50 dark:bg-primary-950/20 text-primary-700 dark:text-primary-300 shadow-sm border-r-4 border-primary-500'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50/80 dark:hover:bg-gray-800/80 hover:translate-x-[-2px] hover:text-primary-600 dark:hover:text-primary-400'
                  )
                }
              >
                <UserCog className="w-5 h-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
                <span>إدارة المستخدمين</span>
              </NavLink>
            </li>
          )}
        </ul>
      </nav>
    </aside>
  )
}
