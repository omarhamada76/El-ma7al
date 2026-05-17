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
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard', 'stats', from, to],
    queryFn: () => getDashboardStats({ from, to }),
  })

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">التقارير</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            نظرة عامة على الأداء والمؤشرات
          </p>
        </div>
        
        <div className="flex flex-wrap gap-4 items-end bg-white dark:bg-gray-800/50 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
          <div>
            <label className="block text-xs font-medium mb-1 text-gray-500">من تاريخ</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-gray-500">إلى تاريخ</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-primary-500 outline-none"
            />
          </div>
          {(from || to) && (
            <button
              onClick={() => {
                setFrom('')
                setTo('')
              }}
              className="px-4 py-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors border border-primary-200 dark:border-primary-800"
            >
              عرض الكل
            </button>
          )}
        </div>
      </div>

      <DashboardKpiGrid
        stats={stats}
        isLoading={statsLoading}
        showFinancials={showFinancials}
        periodFrom={from}
        periodTo={to}
      />

      <DashboardCharts from={from} to={to} />

      <p className="text-sm text-gray-500 dark:text-gray-400">
        الرسوم البيانية وبطاقتا المبيعات والأرباح تتبعان الفترة المحددة. باقي بطاقات المؤشرات (مديونيات، خزنة، مخزون، فواتير
        غير مسددة، إلخ) تعكس الوضع الحالي أو التراكمي في النظام وليست مقيدة بالفترة فقط. اضغط بطاقة لعرض تحليل مختصر وروابط
        مفلترة.
      </p>
    </div>
  )
}
