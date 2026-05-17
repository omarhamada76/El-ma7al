import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts'
import {
  getSalesByCategory,
  getTopProducts,
  getSalesByDay,
} from '@/api/dashboard'
import { formatCurrency } from '@/lib/utils'

const PIE_COLORS = ['#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#64748b']

function ChartTooltip({
  active,
  payload,
  label,
  valueKey = 'total_sales',
  labelFormatter,
}: {
  active?: boolean
  payload?: Array<{ payload: Record<string, unknown>; value?: number }>
  label?: string
  valueKey?: string
  labelFormatter?: (v: string) => string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const v = row[valueKey]
  const num = typeof v === 'number' ? v : Number(v)
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-gray-600 dark:bg-gray-800">
      <p className="font-medium text-gray-900 dark:text-white">
        {labelFormatter ? labelFormatter(String(label ?? '')) : label}
      </p>
      <p className="text-primary-600 dark:text-primary-400 tabular-nums">{formatCurrency(num)}</p>
      {typeof row.invoice_count === 'number' && row.invoice_count > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {row.invoice_count} فاتورة
        </p>
      )}
    </div>
  )
}

function shortDayLabel(isoDay: string) {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      numberingSystem: 'latn',
      month: 'numeric',
      day: 'numeric',
    }).format(
      new Date(isoDay + 'T12:00:00')
    )
  } catch {
    return isoDay.slice(5)
  }
}

export interface DashboardChartsProps {
  /** When both set, all charts use this period (e.g. Reports page). Otherwise last 30 days / all time for tables. */
  from?: string
  to?: string
}

export default function DashboardCharts({ from, to }: DashboardChartsProps) {
  const rangeActive = Boolean(from && to)

  const { data: daily = [], isLoading: dailyLoading } = useQuery({
    queryKey: rangeActive
      ? ['reports', 'charts', 'sales-by-day', from, to]
      : ['dashboard', 'sales-by-day', 30],
    queryFn: () =>
      rangeActive ? getSalesByDay({ from: from!, to: to! }) : getSalesByDay({ days: 30 }),
  })
  const { data: categories = [], isLoading: catLoading } = useQuery({
    queryKey: rangeActive
      ? ['reports', 'charts', 'by-category', from, to]
      : ['dashboard', 'sales-by-category'],
    queryFn: () =>
      rangeActive ? getSalesByCategory({ from, to }) : getSalesByCategory({}),
  })
  const { data: topProducts = [], isLoading: topLoading } = useQuery({
    queryKey: rangeActive
      ? ['reports', 'charts', 'top-products', from, to]
      : ['dashboard', 'top-products', 8],
    queryFn: () =>
      rangeActive
        ? getTopProducts({ from, to, limit: 8 })
        : getTopProducts({ limit: 8 }),
  })

  const pieData = useMemo(() => {
    const withSales = categories.filter((c) => c.total_sales > 0)
    if (withSales.length === 0) return []
    const sorted = [...withSales].sort((a, b) => b.total_sales - a.total_sales)
    const top = sorted.slice(0, 5)
    const rest = sorted.slice(5)
    const restSum = rest.reduce((s, r) => s + r.total_sales, 0)
    if (restSum > 0) {
      top.push({ category: 'أخرى', total_sales: restSum, total_quantity: 0 })
    }
    return top.map((c) => ({
      name: c.category,
      value: c.total_sales,
    }))
  }, [categories])

  const barData = useMemo(
    () =>
      topProducts
        .filter((p) => p.total_sales > 0)
        .map((p) => ({
          name: p.name.length > 22 ? p.name.slice(0, 20) + '…' : p.name,
          fullName: p.name,
          total_sales: p.total_sales,
        })),
    [topProducts]
  )

  const hasDaily = daily.some((d) => d.total_sales > 0)
  const hasPie = pieData.length > 0
  const hasBar = barData.length > 0

  return (
    <section className="space-y-4" aria-label="رسوم بيانية من قاعدة البيانات">
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">الرسوم والاتجاهات</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          مبيعات يومية، توزيع حسب التصنيف، وأكثر الأصناف مبيعاً
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
            المبيعات اليومية
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {rangeActive
              ? `من ${from} إلى ${to} — من جدول الفواتير`
              : 'آخر 30 يوماً — من جدول الفواتير'}
          </p>
          <div dir="ltr" className="h-[280px] w-full">
            {dailyLoading ? (
              <div className="h-full rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ) : !hasDaily ? (
              <p className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                {rangeActive
                   ? 'لا توجد مبيعات في الفترة المحددة'
                   : 'لا توجد مبيعات مسجلة مؤخراً'}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(d) => shortDayLabel(String(d))}
                    tick={{ fontSize: 10, fill: 'currentColor' }}
                    className="text-gray-500"
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    tick={{ fontSize: 10, fill: 'currentColor' }}
                    className="text-gray-500"
                    width={40}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip valueKey="total_sales" labelFormatter={shortDayLabel} />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="total_sales"
                    stroke="#0284c7"
                    strokeWidth={2}
                    fill="url(#salesFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
            المبيعات حسب التصنيف
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">من بنود الفواتير والمنتجات</p>
          <div dir="ltr" className="h-[280px] w-full">
            {catLoading ? (
              <div className="h-full rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ) : !hasPie ? (
              <p className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                لا توجد مبيعات حسب التصنيف بعد
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value ?? 0))}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb',
                      direction: 'rtl',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
          أكثر المنتجات مبيعاً
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">حسب إجمالي سعر البيع في البنود</p>
        <div dir="ltr" className="h-[min(360px,50vh)] w-full min-h-[200px]">
          {topLoading ? (
            <div className="h-full rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ) : !hasBar ? (
            <p className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400 py-12">
              لا توجد منتجات مبيعة بعد
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" horizontal />
                <XAxis type="number" tick={{ fontSize: 10 }} className="text-gray-500" />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tick={{ fontSize: 10 }}
                  className="text-gray-600 dark:text-gray-300"
                />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value ?? 0))}
                  labelFormatter={(_, payload) =>
                    (payload?.[0]?.payload as { fullName?: string })?.fullName ?? ''
                  }
                  contentStyle={{ borderRadius: '8px', direction: 'rtl' }}
                />
                <Bar dataKey="total_sales" fill="#0ea5e9" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  )
}
