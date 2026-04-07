import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDashboardStats } from '@/api/dashboard'
import DashboardCharts from '@/components/dashboard/DashboardCharts'
import DashboardKpiGrid from '@/components/dashboard/DashboardKpiGrid'
import { useAuthStore } from '@/stores/auth'
import { canViewFinancials } from '@/lib/roles'

export default function Reports() {
  const role = useAuthStore((s) => s.user?.role)
  const showFinancials = canViewFinancials(role)
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: getDashboardStats,
  })

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">التقارير</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          نظرة عامة على الأداء والمؤشرات
        </p>
      </div>

      <DashboardKpiGrid stats={stats} isLoading={statsLoading} showFinancials={showFinancials} />

      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-medium mb-1">من تاريخ</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
          />
        </div>
      </div>

      <DashboardCharts from={from} to={to} />

      <p className="text-sm text-gray-500 dark:text-gray-400">
        الرسوم البيانية تتبع الفترة المحددة. أرقام بطاقات المؤشرات أعلاه ملخص إجمالي من النظام.
      </p>
    </div>
  )
}
