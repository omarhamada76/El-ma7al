import { Link } from 'react-router-dom'
import {
  TrendingUp,
  Wallet,
  Users,
  Package,
  AlertTriangle,
  FileText,
  Truck,
} from 'lucide-react'
import type { DashboardStats } from '@/types/api'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'

/** بطاقات بدون مبيعات/أرباح/مديونية/خزنة للموظف */
export const staffDashboardCardKeys = new Set([
  'product_count',
  'low_stock_count',
  'expiring_count',
  'unpaid_invoices_count',
])

const cardConfig = [
  {
    key: 'total_sales',
    label: 'إجمالي المبيعات',
    to: '/invoices',
    icon: TrendingUp,
    color: 'bg-emerald-500',
    light: 'bg-emerald-50 dark:bg-emerald-900/20',
    getValue: (s: DashboardStats) => formatCurrency(s.total_sales),
  },
  {
    key: 'total_profit',
    label: 'إجمالي الأرباح',
    to: '/reports',
    icon: TrendingUp,
    color: 'bg-green-500',
    light: 'bg-green-50 dark:bg-green-900/20',
    getValue: (s: DashboardStats) => formatCurrency(s.total_profit),
  },
  {
    key: 'client_debt',
    label: 'إجمالي مديونية العملاء',
    to: '/clients',
    icon: Users,
    color: 'bg-amber-500',
    light: 'bg-amber-50 dark:bg-amber-900/20',
    getValue: (s: DashboardStats) => formatCurrency(s.client_debt),
  },
  {
    key: 'total_deferred_receivable',
    label: 'إجمالي الآجل المستحق',
    to: '/clients',
    icon: Users,
    color: 'bg-orange-600',
    light: 'bg-orange-50 dark:bg-orange-950/20',
    getValue: (s: DashboardStats) => formatCurrency(s.total_deferred_receivable ?? 0),
  },
  {
    key: 'safe_balance',
    label: 'رصيد الخزنه',
    to: '/safe',
    icon: Wallet,
    color: 'bg-blue-500',
    light: 'bg-blue-50 dark:bg-blue-900/20',
    getValue: (s: DashboardStats) => formatCurrency(s.safe_balance),
  },
  {
    key: 'supplier_payable',
    label: 'إجمالي مديونية الموردين',
    to: '/suppliers',
    icon: Truck,
    color: 'bg-violet-500',
    light: 'bg-violet-50 dark:bg-violet-900/20',
    getValue: (s: DashboardStats) => formatCurrency(s.supplier_payable),
  },
  {
    key: 'product_count',
    label: 'عدد المنتجات',
    to: '/inventory',
    icon: Package,
    color: 'bg-sky-500',
    light: 'bg-sky-50 dark:bg-sky-900/20',
    getValue: (s: DashboardStats) => String(s.product_count),
  },
  {
    key: 'low_stock_count',
    label: 'منتجات منخفضة المخزون',
    to: '/inventory',
    icon: AlertTriangle,
    color: 'bg-orange-500',
    light: 'bg-orange-50 dark:bg-orange-900/20',
    getValue: (s: DashboardStats) => String(s.low_stock_count),
  },
  {
    key: 'expiring_count',
    label: 'قاربت على الانتهاء',
    to: '/inventory?expiring=1',
    icon: AlertTriangle,
    color: 'bg-rose-500',
    light: 'bg-rose-50 dark:bg-rose-900/20',
    getValue: (s: DashboardStats) => String(s.expiring_count),
  },
  {
    key: 'unpaid_invoices_count',
    label: 'فواتير غير مسددة',
    to: '/invoices',
    icon: FileText,
    color: 'bg-red-500',
    light: 'bg-red-50 dark:bg-red-900/20',
    getValue: (s: DashboardStats) => String(s.unpaid_invoices_count),
  },
] as const

export interface DashboardKpiGridProps {
  stats: DashboardStats | undefined
  isLoading: boolean
  showFinancials: boolean
}

export default function DashboardKpiGrid({ stats, isLoading, showFinancials }: DashboardKpiGridProps) {
  const kpiCards = showFinancials
    ? cardConfig
    : cardConfig.filter((c) => staffDashboardCardKeys.has(c.key))

  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4">
      {isLoading
        ? Array.from({ length: kpiCards.length }).map((_, i) => (
            <div
              key={i}
              className="h-20 sm:h-28 rounded-lg sm:rounded-xl bg-gray-200 dark:bg-gray-700 animate-pulse"
            />
          ))
        : kpiCards.map(({ label, to, icon: Icon, color, light, getValue }) => (
            <Link
              key={label}
              to={to}
              className={cn(
                'rounded-lg sm:rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden',
                'transition-colors hover:border-primary-400 dark:hover:border-primary-600',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900',
                light
              )}
              aria-label={`${label} — الانتقال إلى الصفحة`}
            >
              <div className="p-2.5 sm:p-4 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400">
                    {label}
                  </p>
                  <p className="text-base sm:text-xl font-bold mt-0.5 sm:mt-1 truncate">
                    {stats ? getValue(stats) : '—'}
                  </p>
                </div>
                <div className={cn('p-1.5 sm:p-2 rounded-lg text-white flex-shrink-0', color)}>
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden />
                </div>
              </div>
            </Link>
          ))}
    </div>
  )
}
