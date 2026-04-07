import { useParams, Link } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, FileSpreadsheet } from 'lucide-react'
import { getBarn } from '@/api/barns'
import { getBarnBillingCycles, startBarnBillingCycle, endBarnBillingCycle } from '@/api/barnBillingCycles'
import { formatCurrency, localISODate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { canViewFinancials } from '@/lib/roles'

export default function BarnDetail() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const showFinancials = canViewFinancials(useAuthStore((s) => s.user?.role))
  const [cycleStartDate, setCycleStartDate] = useState(() => localISODate())
  const [cycleEndDate, setCycleEndDate] = useState(() => localISODate())
  const [cycleNotice, setCycleNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: barn, isLoading } = useQuery({
    queryKey: ['barn', id],
    queryFn: () => getBarn(id!),
    enabled: !!id,
  })

  const {
    data: cyclesPayload,
    isError: cyclesQueryError,
    error: cyclesQueryErr,
  } = useQuery({
    queryKey: ['barn', id, 'billing-cycles'],
    queryFn: () => getBarnBillingCycles(id!),
    enabled: !!id && showFinancials,
    retry: 1,
  })
  const billingCycles = cyclesPayload?.data ?? []
  const openCycleId = cyclesPayload?.open_cycle_id ?? null
  const openCycle = openCycleId != null ? billingCycles.find((c) => c.id === openCycleId) : undefined

  const startCycleMutation = useMutation({
    mutationFn: () => startBarnBillingCycle(id!, { started_at: cycleStartDate }),
    onSuccess: () => {
      setCycleNotice({ type: 'success', text: 'تم بدء الدورة بنجاح.' })
      queryClient.invalidateQueries({ queryKey: ['barn', id, 'billing-cycles'] })
      queryClient.invalidateQueries({ queryKey: ['barn', id] })
    },
    onError: (e: Error) => {
      setCycleNotice({ type: 'error', text: e.message || 'تعذر بدء الدورة' })
    },
  })
  const endCycleMutation = useMutation({
    mutationFn: () => endBarnBillingCycle(id!, { ended_at: cycleEndDate }),
    onSuccess: () => {
      setCycleNotice({ type: 'success', text: 'تم إغلاق الدورة وحفظ الرصيد الختامي.' })
      queryClient.invalidateQueries({ queryKey: ['barn', id, 'billing-cycles'] })
      queryClient.invalidateQueries({ queryKey: ['barn', id] })
    },
    onError: (e: Error) => {
      setCycleNotice({ type: 'error', text: e.message || 'تعذر إغلاق الدورة' })
    },
  })

  if (!id) return null
  if (isLoading || !barn)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    )

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link to={`/clients/${barn.client_id}`} className="hover:underline">
          العميل
        </Link>
        <ArrowRight className="w-4 h-4" />
        <span className="text-gray-900 dark:text-gray-100 font-medium">
          {barn.name}
        </span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">{barn.name}</h1>
        {showFinancials && (
          <Link
            to={`/barns/${id}/account-statement`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium text-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            كشف حساب العنبر
          </Link>
        )}
      </div>

      {showFinancials && (
      <div className="p-4 rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-950/20">
        <h2 className="text-lg font-semibold mb-2">الدورة المحاسبية</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          عند بدء دورة يُحفظ تاريخ البداية، وتُسجَّل فواتير ودفعات هذا العنبر ضمن الدورة المفتوحة. عند الإغلاق يُحتسب
          الرصيد الختامي؛ المبلغ غير المسوّى يُعرض كمديونية متراكمة في بداية الدورة التالية عند بدئها.
        </p>
        {cyclesQueryError && (
          <div className="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm">
            {cyclesQueryErr instanceof Error
              ? cyclesQueryErr.message
              : 'تعذر تحميل بيانات الدورات. تأكد من تشغيل الخادم وأنك مسجّل الدخول.'}
          </div>
        )}
        {cycleNotice && (
          <div
            className={
              cycleNotice.type === 'success'
                ? 'mb-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-100 text-sm'
                : 'mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm'
            }
            role="status"
          >
            {cycleNotice.text}
          </div>
        )}
        {openCycle ? (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="font-medium text-emerald-700 dark:text-emerald-300">دورة مفتوحة</span>
              <span className="mx-2">من {openCycle.started_at.slice(0, 10)}</span>
              <span className="text-gray-500">
                — رصيد افتتاحي للدورة: {formatCurrency(openCycle.carry_in)}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">تاريخ إغلاق الدورة</label>
                <input
                  type="date"
                  value={cycleEndDate}
                  onChange={(e) => setCycleEndDate(e.target.value)}
                  className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                />
              </div>
              <button
                type="button"
                disabled={endCycleMutation.isPending}
                onClick={() => {
                  setCycleNotice(null)
                  endCycleMutation.mutate()
                }}
                className="px-3 py-2 rounded-lg border border-amber-600 text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/30 text-sm font-medium disabled:opacity-50"
              >
                {endCycleMutation.isPending ? 'جاري…' : 'إنهاء الدورة'}
              </button>
              <Link
                to={`/barns/${id}/account-statement?cycleId=${openCycle.id}`}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 text-sm font-medium"
              >
                كشف حساب الدورة
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">تاريخ بدء الدورة</label>
              <input
                type="date"
                value={cycleStartDate}
                onChange={(e) => setCycleStartDate(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              />
            </div>
            <button
              type="button"
              disabled={startCycleMutation.isPending}
              onClick={() => {
                setCycleNotice(null)
                startCycleMutation.mutate()
              }}
              className="px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 text-sm font-medium disabled:opacity-50"
            >
              {startCycleMutation.isPending ? 'جاري الحفظ…' : 'بدء دورة'}
            </button>
          </div>
        )}
        {billingCycles.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-primary-600 dark:text-primary-400">سجل الدورات السابقة</summary>
            <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-400">
              {billingCycles.map((c) => (
                <li key={c.id}>
                  دورة #{c.id}: {c.started_at.slice(0, 10)} —{' '}
                  {c.ended_at ? c.ended_at.slice(0, 10) : 'مفتوحة'}
                  {c.carryover_out != null && (
                    <span className="mr-2"> — ختامي: {formatCurrency(c.carryover_out)}</span>
                  )}
                  <Link
                    to={`/barns/${id}/account-statement?cycleId=${c.id}`}
                    className="mr-2 text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    كشف
                  </Link>
                  {c.ended_at && (
                    <Link
                      to={`/barns/${id}/account-statement?afterCycleId=${c.id}`}
                      className="text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      بعد الدورة
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">إجمالي الفواتير</p>
          <p className="text-xl font-bold mt-1">{barn.total_invoices}</p>
        </div>
        {showFinancials && (
          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">إجمالي الربح</p>
            <p className="text-xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
              {formatCurrency(barn.total_profit)}
            </p>
          </div>
        )}
      </div>
      {showFinancials && (
        <p className="text-gray-500 dark:text-gray-400">
          قائمة الفواتير والمدفوعات لهذا العنبر يمكن عرضها من كشف الحساب أو سجل الفواتير.
        </p>
      )}
    </div>
  )
}
