import { useState } from 'react'
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
import KpiInsightDrawer, { type KpiInsightKey } from '@/components/dashboard/KpiInsightDrawer'

/** بطاقات بدون مبيعات/أرباح/مديونية/خزنة للموظف */
export const staffDashboardCardKeys = new Set([
  'product_count',
  'low_stock_count',
  'expiring_count',
  'unpaid_invoices_count',
])

const cardConfig: {
  key: KpiInsightKey
  label: string
  icon: typeof TrendingUp
  color: string
  light: string
  getValue: (s: DashboardStats) => string
}[] = [
  {
    key: 'total_sales',
    label: 'إجمالي المبيعات',
    icon: TrendingUp,
    color: 'bg-emerald-500',
    light: 'bg-emerald-50 dark:bg-emerald-900/20',
    getValue: (s) => formatCurrency(s.total_sales),
  },
  {
    key: 'total_profit',
    label: 'إجمالي الأرباح',
    icon: TrendingUp,
    color: 'bg-green-500',
    light: 'bg-green-50 dark:bg-green-900/20',
    getValue: (s) => formatCurrency(s.total_profit),
  },
  {
    key: 'client_debt',
    label: 'إجمالي مديونية العملاء',
    icon: Users,
    color: 'bg-amber-500',
    light: 'bg-amber-50 dark:bg-amber-900/20',
    getValue: (s) => formatCurrency(s.client_debt),
  },

  {
    key: 'safe_balance',
    label: 'رصيد الخزنه',
    icon: Wallet,
    color: 'bg-blue-500',
    light: 'bg-blue-50 dark:bg-blue-900/20',
    getValue: (s) => formatCurrency(s.safe_balance),
  },
  {
    key: 'supplier_payable',
    label: 'إجمالي المديونية للموردين',
    icon: Truck,
    color: 'bg-violet-500',
    light: 'bg-violet-50 dark:bg-violet-900/20',
    getValue: (s) => formatCurrency(s.supplier_payable),
  },
  {
    key: 'product_count',
    label: 'عدد المنتجات',
    icon: Package,
    color: 'bg-sky-500',
    light: 'bg-sky-50 dark:bg-sky-900/20',
    getValue: (s) => String(s.product_count),
  },
  {
    key: 'low_stock_count',
    label: 'منتجات منخفضة المخزون',
    icon: AlertTriangle,
    color: 'bg-orange-500',
    light: 'bg-orange-50 dark:bg-orange-900/20',
    getValue: (s) => String(s.low_stock_count),
  },
  {
    key: 'expiring_count',
    label: 'قاربت على الانتهاء',
    icon: AlertTriangle,
    color: 'bg-rose-500',
    light: 'bg-rose-50 dark:bg-rose-900/20',
    getValue: (s) => String(s.expiring_count),
  },
  {
    key: 'unpaid_invoices_count',
    label: 'فواتير غير مسددة',
    icon: FileText,
    color: 'bg-red-500',
    light: 'bg-red-50 dark:bg-red-900/20',
    getValue: (s) => String(s.unpaid_invoices_count),
  },
  {
    key: 'inventory_value_purchase',
    label: 'قيمة المخزون (شراء)',
    icon: Package,
    color: 'bg-indigo-500',
    light: 'bg-indigo-50 dark:bg-indigo-900/20',
    getValue: (s) => formatCurrency(s.inventory_value_purchase ?? 0),
  },
  {
    key: 'inventory_value_selling',
    label: 'قيمة المخزون (بيع)',
    icon: Package,
    color: 'bg-purple-500',
    light: 'bg-purple-50 dark:bg-purple-900/20',
    getValue: (s) => formatCurrency(s.inventory_value_selling ?? 0),
  },
]

export interface DashboardKpiGridProps {
  stats: DashboardStats | undefined
  isLoading: boolean
  showFinancials: boolean
  /** YYYY-MM-DD — يحدّث مبيعات/أرباح البطاقة وتحليل الدرج */
  periodFrom: string
  periodTo: string
}

export default function DashboardKpiGrid({
  stats,
  isLoading,
  showFinancials,
  periodFrom,
  periodTo,
}: DashboardKpiGridProps) {
  const [activeKpi, setActiveKpi] = useState<KpiInsightKey | null>(null)
  const kpiCards = showFinancials
    ? cardConfig
    : cardConfig.filter((c) => staffDashboardCardKeys.has(c.key))

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-4">
        {isLoading
          ? Array.from({ length: kpiCards.length }).map((_, i) => (
              <div
                key={i}
                className="h-20 sm:h-28 rounded-lg sm:rounded-xl bg-gray-200 dark:bg-gray-700 animate-pulse"
              />
            ))
          : kpiCards.map(({ key, label, icon: Icon, color, light, getValue }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveKpi(key)}
                className={cn(
                  'rounded-lg sm:rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden text-right',
                  'transition-colors hover:border-primary-400 dark:hover:border-primary-600',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900',
                  light
                )}
                aria-label={`${label} — عرض التحليل والانتقال`}
              >
                <div className="p-2.5 sm:p-4 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400">{label}</p>
                    <p className="text-base sm:text-xl font-bold mt-0.5 sm:mt-1 truncate">
                      {stats ? getValue(stats) : '—'}
                    </p>
                  </div>
                  <div className={cn('p-1.5 sm:p-2 rounded-lg text-white flex-shrink-0', color)}>
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden />
                  </div>
                </div>
              </button>
            ))}
      </div>

      <KpiInsightDrawer
        open={activeKpi != null}
        onClose={() => setActiveKpi(null)}
        kpiKey={activeKpi}
        stats={stats}
        periodFrom={periodFrom}
        periodTo={periodTo}
        showFinancials={showFinancials}
      />
    </>
  )
}
