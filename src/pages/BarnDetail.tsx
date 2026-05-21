import { useParams, Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ArrowLeft, FileSpreadsheet, Pencil, Trash2 } from 'lucide-react'
import { getBarn, updateBarn, deleteBarn } from '@/api/barns'
import { getBarnBillingCycles, startBarnBillingCycle, endBarnBillingCycle } from '@/api/barnBillingCycles'
import AddBarnModal from '@/components/AddBarnModal'
import { getPayments } from '@/api/payments'
import { formatCurrency, localISODate, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { canViewFinancials } from '@/lib/roles'

export default function BarnDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showFinancials = canViewFinancials(useAuthStore((s) => s.user?.role))
  const [cycleStartDate, setCycleStartDate] = useState(() => localISODate())
  const [cycleEndDate, setCycleEndDate] = useState(() => localISODate())
  const [cycleNotice, setCycleNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const { data: barn, isLoading } = useQuery({
    queryKey: ['barn', id],
    queryFn: () => getBarn(id!),
    enabled: !!id,
  })

  const updateBarnMutation = useMutation({
    mutationFn: (body: { name: string; initial_debt: number }) => updateBarn(id!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barn', id] })
      if (barn?.client_id) {
        queryClient.invalidateQueries({ queryKey: ['client', barn.client_id, 'barns'] })
      }
      setEditOpen(false)
    },
  })

  const deleteBarnMutation = useMutation({
    mutationFn: () => deleteBarn(id!),
    onSuccess: () => {
      if (barn?.client_id) {
        queryClient.invalidateQueries({ queryKey: ['client', barn.client_id, 'barns'] })
        navigate(`/clients/${barn.client_id}`)
      } else {
        navigate('/')
      }
    },
  })

  const handleDeleteBarn = () => {
    if (window.confirm('هل أنت متأكد من حذف هذا العنبر؟')) {
      deleteBarnMutation.mutate()
    }
  }



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

  const { data: discountsData, isLoading: isDiscountsLoading } = useQuery({
    queryKey: ['barn', id, 'discounts'],
    queryFn: () => getPayments({ barn_id: Number(id), payment_method: 'discount', limit: 20 }),
    enabled: !!id && showFinancials,
  })
  const barnDiscounts = discountsData?.data ?? []

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
        <div className="flex flex-wrap gap-2">
          {showFinancials && (
            <Link
              to={`/barns/${id}/account-statement`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium text-sm"
            >
              <FileSpreadsheet className="w-4 h-4" />
              كشف حساب العنبر
            </Link>
          )}
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium text-sm"
          >
            <Pencil className="w-4 h-4" />
            تعديل
          </button>
          <button
            type="button"
            onClick={handleDeleteBarn}
            disabled={deleteBarnMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium text-sm disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            حذف
          </button>
        </div>
      </div>
      
      <AddBarnModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        hideInitialDebt={!showFinancials}
        initialValues={{
          name: barn.name,
          initial_debt: barn.initial_debt || 0,
        }}
        onSubmit={async (data) => {
          await updateBarnMutation.mutateAsync({
            name: data.name,
            ...(showFinancials ? { initial_debt: data.initial_debt } : {}),
          } as any)
        }}
      />

      {showFinancials && (
      <div className="p-4 rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-950/20">
        <h2 className="text-lg font-semibold mb-2">الدورة المحاسبية</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          عند بدء دورة يُحفظ تاريخ البداية، وتُسجَّل فواتير وسداد هذا العنبر ضمن الدورة المفتوحة. عند الإغلاق يُحتسب
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
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
        {showFinancials && (
          <>
            <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <p className="text-sm text-gray-500 dark:text-gray-400">الحساب</p>
              <p className="text-xl font-bold mt-1 text-gray-900 dark:text-white">
                {formatCurrency(barn.total_account)}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <p className="text-sm text-gray-500 dark:text-gray-400">السداد</p>
              <p className="text-xl font-bold mt-1 text-blue-600 dark:text-blue-400">
                {formatCurrency(barn.total_paid)}
              </p>
            </div>
            <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <p className="text-sm text-gray-500 dark:text-gray-400">المديونية</p>
              <p className="text-xl font-bold mt-1 text-red-600 dark:text-red-400">
                {formatCurrency(barn.balance)}
              </p>
            </div>
          </>
        )}
      </div>
      {showFinancials && (
        <>
          <p className="text-gray-500 dark:text-gray-400">
            قائمة الفواتير والسداد لهذا العنبر يمكن عرضها من كشف الحساب أو سجل الفواتير.
          </p>

          <div className="mt-8 space-y-4">
            <div className="flex items-center justify-between mb-2 bg-gray-50/50 dark:bg-gray-800/30 p-3 rounded-xl border border-gray-100 dark:border-gray-700/50">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">الخصومات المسجلة لهذا العنبر</h2>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
              {isDiscountsLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                  ))}
                </div>
              ) : barnDiscounts.length === 0 ? (
                <p className="p-6 text-center text-gray-500 dark:text-gray-400">
                  لا توجد خصومات مسجّلة لهذا العنبر.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300">
                        <th className="text-right py-3 px-4 font-semibold">التاريخ</th>
                        <th className="text-right py-3 px-4 font-semibold">قيمة الخصم</th>
                        <th className="text-right py-3 px-4 font-semibold">ملاحظات / السبب</th>
                        <th className="text-right py-3 px-4 w-24"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {barnDiscounts.map((p) => (
                        <tr
                          key={p.id}
                          className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                        >
                          <td className="py-2.5 px-4 text-gray-600 dark:text-gray-400">{formatDate(p.payment_date)}</td>
                          <td className="py-2.5 px-4 font-bold text-red-600 dark:text-red-400">
                            {formatCurrency(p.amount)}
                          </td>
                          <td className="py-2.5 px-4 text-gray-700 dark:text-gray-300 max-w-xs truncate" title={p.notes || ''}>
                            {p.notes || <span className="text-gray-400">—</span>}
                          </td>
                          <td className="py-2.5 px-4">
                            <Link
                              to={`/payments/${p.id}`}
                              className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline font-medium text-sm"
                            >
                              عرض
                              <ArrowLeft className="w-4 h-4" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
