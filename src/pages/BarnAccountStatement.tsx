import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Share2, ArrowRight } from 'lucide-react'
import {
  getBarnAccountStatement,
  getBarnBillingCycleAccountStatement,
  getBarnStatementAfterCycle,
} from '@/api/accountStatement'
import { getBarnBillingCycles } from '@/api/barnBillingCycles'
import { getBarn } from '@/api/barns'
import { getClient } from '@/api/clients'
import AccountStatementTable from '@/components/AccountStatementTable'
import { formatCurrency, localISODate } from '@/lib/utils'
import type { AccountStatement } from '@/types/api'
import {
  createStatementPdfBlob,
  downloadStatementPdf,
  shareStatementToWhatsApp,
} from '@/lib/accountStatementPdf'

type StmtMode = 'custom' | 'cycle' | 'after'

function pdfPeriod(
  statement: AccountStatement | undefined,
  from: string,
  to: string
): { from: string; to: string } {
  if (!statement) return { from, to }
  if (statement.cycle) {
    const f = statement.cycle.started_at.slice(0, 10)
    const t = statement.cycle.ended_at ? statement.cycle.ended_at.slice(0, 10) : 'مفتوحة'
    return { from: f, to: t }
  }
  if (statement.after_cycle) {
    return { from: statement.after_cycle.from, to: statement.after_cycle.to }
  }
  return { from, to }
}

export default function BarnAccountStatement() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const initialCycle = searchParams.get('cycleId')
  const initialAfter = searchParams.get('afterCycleId')

  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return localISODate(d)
  })
  const [to, setTo] = useState(() => localISODate())
  const [pdfBusy, setPdfBusy] = useState(false)

  const [mode, setMode] = useState<StmtMode>(() => {
    if (initialAfter && /^\d+$/.test(initialAfter.trim())) return 'after'
    if (initialCycle && /^\d+$/.test(initialCycle.trim())) return 'cycle'
    return 'custom'
  })
  const [cyclePick, setCyclePick] = useState<number | ''>(() => {
    if (initialCycle && /^\d+$/.test(initialCycle.trim())) return Number(initialCycle.trim())
    return ''
  })
  const [afterPick, setAfterPick] = useState<number | ''>(() => {
    if (initialAfter && /^\d+$/.test(initialAfter.trim())) return Number(initialAfter.trim())
    return ''
  })

  const { data: barn } = useQuery({
    queryKey: ['barn', id],
    queryFn: () => getBarn(id!),
    enabled: !!id,
  })
  const { data: barnClient } = useQuery({
    queryKey: ['client', barn?.client_id],
    queryFn: () => getClient(String(barn!.client_id)),
    enabled: !!barn?.client_id,
  })

  const idValid = !!id && /^\d+$/.test(id.trim())

  const { data: cyclesPayload } = useQuery({
    queryKey: ['barn', id, 'billing-cycles'],
    queryFn: () => getBarnBillingCycles(id!.trim()),
    enabled: idValid,
  })

  const cycles = cyclesPayload?.data ?? []
  const closedCycles = useMemo(() => cycles.filter((c) => c.ended_at != null), [cycles])

  const stmtEnabled =
    idValid &&
    (mode === 'custom' ||
      (mode === 'cycle' && cyclePick !== '') ||
      (mode === 'after' && afterPick !== ''))

  const { data: statement, isLoading, isError, error } = useQuery({
    queryKey: ['account-statement', 'barn', id, mode, from, to, cyclePick, afterPick],
    queryFn: async () => {
      if (mode === 'cycle' && cyclePick !== '') {
        return getBarnBillingCycleAccountStatement(Number(cyclePick))
      }
      if (mode === 'after' && afterPick !== '') {
        return getBarnStatementAfterCycle(id!.trim(), Number(afterPick))
      }
      return getBarnAccountStatement(id!.trim(), { from, to })
    },
    enabled: stmtEnabled,
    staleTime: 0,
  })

  const titleName = barn?.name ?? `عنبر #${id}`
  const period = pdfPeriod(statement, from, to)

  async function handleDownloadPdf() {
    if (!statement || pdfBusy) return
    setPdfBusy(true)
    try {
      const blob = await createStatementPdfBlob(titleName, period.from, period.to, statement)
      await downloadStatementPdf(blob, titleName)
    } finally {
      setPdfBusy(false)
    }
  }

  async function handleShareWhatsApp() {
    if (!statement || pdfBusy) return
    setPdfBusy(true)
    try {
      const blob = await createStatementPdfBlob(titleName, period.from, period.to, statement)
      await shareStatementToWhatsApp(blob, titleName, {
        phone: barnClient?.phone,
        from: period.from,
        to: period.to,
      })
    } finally {
      setPdfBusy(false)
    }
  }

  const desc =
    mode === 'custom'
      ? 'فواتير ومدفوعات مرتبطة بهذا العنبر فقط ضمن الفترة المحددة.'
      : mode === 'cycle'
        ? 'كشف ضمن دورة محاسبية للعنبر: الرصيد الافتتاحي يشمل المديونية المتراكمة عند بدء الدورة؛ الجدول يعرض فقط الفواتير والدفعات المسجّلة أثناء هذه الدورة.'
        : 'حركات من بعد إغلاق دورة محاسبية للعنبر حتى تاريخ نهاية التقرير.'

  if (id && !idValid) {
    return (
      <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-sm" dir="rtl">
        رابط كشف الحساب غير صالح (معرف العنبر يجب أن يكون رقماً).
      </div>
    )
  }

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            كشف حساب العنبر {barn?.name ? `— ${barn.name}` : ''}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">{desc}</p>
          {id && (
            <Link
              to={`/barns/${id}`}
              className="inline-flex items-center gap-1 mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              العودة لصفحة العنبر
            </Link>
          )}
        </div>
        {statement && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pdfBusy}
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              تحميل PDF
            </button>
            <button
              type="button"
              disabled={pdfBusy}
              onClick={handleShareWhatsApp}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
            >
              <Share2 className="h-4 w-4" />
              واتساب
            </button>
          </div>
        )}
      </div>

      {isError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          {error instanceof Error ? error.message : 'تعذر تحميل كشف الحساب'}
        </div>
      )}

      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-medium mb-1">نوع التقرير</label>
          <select
            value={mode}
            onChange={(e) => {
              const m = e.target.value as StmtMode
              setMode(m)
              if (m === 'custom') {
                setCyclePick('')
                setAfterPick('')
              }
            }}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 min-w-[200px]"
          >
            <option value="custom">فترة حرّة (من — إلى)</option>
            <option value="cycle">دورة محاسبية</option>
            <option value="after">بعد إغلاق دورة</option>
          </select>
        </div>

        {mode === 'cycle' && (
          <div>
            <label className="block text-sm font-medium mb-1">الدورة</label>
            <select
              value={cyclePick === '' ? '' : String(cyclePick)}
              onChange={(e) => setCyclePick(e.target.value ? Number(e.target.value) : '')}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 min-w-[220px]"
            >
              <option value="">— اختر دورة —</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  دورة #{c.id} من {c.started_at.slice(0, 10)}
                  {c.ended_at ? ` — ${c.ended_at.slice(0, 10)}` : ' (مفتوحة)'}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === 'after' && (
          <div>
            <label className="block text-sm font-medium mb-1">بعد إغلاق الدورة</label>
            <select
              value={afterPick === '' ? '' : String(afterPick)}
              onChange={(e) => setAfterPick(e.target.value ? Number(e.target.value) : '')}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 min-w-[220px]"
            >
              <option value="">— اختر دورة مغلقة —</option>
              {closedCycles.map((c) => (
                <option key={c.id} value={c.id}>
                  انتهت في {c.ended_at?.slice(0, 10)} (دورة #{c.id})
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === 'custom' && (
          <>
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
          </>
        )}
      </div>

      {mode === 'cycle' && cycles.length === 0 && (
        <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
          لا توجد دورات محاسبية لهذا العنبر. ابدأ دورة من صفحة العنبر.
        </p>
      )}
      {mode === 'after' && closedCycles.length === 0 && (
        <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
          لا توجد دورات مغلقة بعد. أغلق دورة من صفحة العنبر لاستخدام هذا التقرير.
        </p>
      )}

      {statement && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {statement.cycle ? 'الرصيد الافتتاحي (يشمل المديونية المتراكمة)' : 'الرصيد الافتتاحي'}
            </p>
            <p className="text-xl font-bold">{formatCurrency(statement.opening_balance)}</p>
          </div>
          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-emerald-50 dark:bg-emerald-900/20">
            <p className="text-sm text-gray-600 dark:text-gray-400">الرصيد الختامي</p>
            <p className="text-xl font-bold">{formatCurrency(statement.closing_balance)}</p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto">
        <AccountStatementTable rows={statement?.rows ?? []} isLoading={isLoading} />
      </div>
    </div>
  )
}
