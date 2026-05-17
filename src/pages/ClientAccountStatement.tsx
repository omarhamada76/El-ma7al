import { useParams, Link, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Share2, ArrowRight } from 'lucide-react'
import { getClientAccountStatement, getBarnAccountStatement } from '@/api/accountStatement'
import { getClient, getClients, getClientBarns } from '@/api/clients'
import AccountStatementTable from '@/components/AccountStatementTable'
import { cn, formatCurrency, localISODate } from '@/lib/utils'
import {
  createStatementPdfBlob,
  downloadStatementPdf,
  shareStatementToWhatsApp,
} from '@/lib/accountStatementPdf'

type BarnScope = 'all' | number

function SelectionArea({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40',
        'p-3 sm:p-4 space-y-4 text-right'
      )}
    >
      {children}
    </div>
  )
}

function SummaryCards({
  opening,
  closing,
}: {
  opening: number
  closing: number
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-right">
      <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20">
        <p className="text-sm text-gray-600 dark:text-gray-400">الحساب السابق</p>
        <p className="text-xl font-bold">{formatCurrency(opening)}</p>
      </div>
      <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-emerald-50 dark:bg-emerald-900/20">
        <p className="text-sm text-gray-600 dark:text-gray-400">الرصيد الحالي</p>
        <p className="text-xl font-bold">{formatCurrency(closing)}</p>
      </div>
    </div>
  )
}

export default function ClientAccountStatement() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return localISODate(d)
  })
  const [to, setTo] = useState(() => localISODate())
  const [pdfBusy, setPdfBusy] = useState(false)

  const [selectedClientId, setSelectedClientId] = useState('')
  const [barnScope, setBarnScope] = useState<BarnScope>('all')

  const { data: clientsPayload } = useQuery({
    queryKey: ['clients', 'account-statement'],
    queryFn: () => getClients({ limit: 500 }),
  })
  const clients = clientsPayload?.data ?? []

  useEffect(() => {
    if (id && /^\d+$/.test(id.trim())) {
      setSelectedClientId(id.trim())
    }
  }, [id])

  const idValid = !!id && /^\d+$/.test(id.trim())

  const { data: client } = useQuery({
    queryKey: ['client', selectedClientId],
    queryFn: () => getClient(selectedClientId),
    enabled: !!selectedClientId && /^\d+$/.test(selectedClientId),
  })

  const { data: barns = [] } = useQuery({
    queryKey: ['client-barns', selectedClientId],
    queryFn: () => getClientBarns(selectedClientId),
    enabled: !!selectedClientId && /^\d+$/.test(selectedClientId),
  })

  useEffect(() => {
    if (barns.length === 0) setBarnScope('all')
  }, [barns.length, selectedClientId])

  const stmtEnabled =
    !!selectedClientId &&
    /^\d+$/.test(selectedClientId) &&
    (barns.length === 0 || barnScope === 'all' || typeof barnScope === 'number')

  const { data: statement, isLoading, isError, error } = useQuery({
    queryKey: ['account-statement', 'client', selectedClientId, barnScope, from, to],
    queryFn: async () => {
      if (barns.length === 0 || barnScope === 'all') {
        return getClientAccountStatement(selectedClientId, { from, to })
      }
      return getBarnAccountStatement(String(barnScope), { from, to })
    },
    enabled: stmtEnabled,
    staleTime: 0,
  })

  const pageTitle = useMemo(() => {
    if (!client) return 'كشف حساب'
    if (barns.length === 0 || barnScope === 'all') {
      return `كشف حساب — ${client.name}`
    }
    const b = barns.find((x) => String(x.id) === String(barnScope))
    return `كشف حساب — ${client.name} — ${b?.name ?? ''}`
  }, [client, barns, barnScope])

  const pdfFileLabel = useMemo(() => {
    if (!client) return 'عميل'
    if (barns.length === 0 || barnScope === 'all') return client.name
    const b = barns.find((x) => String(x.id) === String(barnScope))
    return b ? `${client.name}-${b.name}` : client.name
  }, [client, barns, barnScope])

  async function handleDownloadPdf() {
    if (!statement || pdfBusy) return
    setPdfBusy(true)
    try {
      const blob = await createStatementPdfBlob(pageTitle, from, to, statement)
      await downloadStatementPdf(blob, pdfFileLabel)
    } finally {
      setPdfBusy(false)
    }
  }

  async function handleShareWhatsApp() {
    if (!statement || pdfBusy) return
    setPdfBusy(true)
    try {
      const blob = await createStatementPdfBlob(pageTitle, from, to, statement)
      await shareStatementToWhatsApp(blob, pdfFileLabel, {
        phone: client?.phone,
        from,
        to,
      })
    } finally {
      setPdfBusy(false)
    }
  }

  function onClientChange(nextId: string) {
    setSelectedClientId(nextId)
    setBarnScope('all')
    if (/^\d+$/.test(nextId)) {
      navigate(`/clients/${nextId}/account-statement`, { replace: true })
    }
  }

  if (id && !idValid) {
    return (
      <div
        className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-sm text-right"
        dir="rtl"
      >
        رابط كشف الحساب غير صالح (معرف العميل يجب أن يكون رقماً). افتح كشف الحساب من صفحة العميل أو قائمة
        العملاء.
      </div>
    )
  }

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full text-right" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold break-words">{pageTitle}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
            اختر العميل والعنبر (إن وُجد) والفترة لعرض الحركات والأرصدة.
          </p>
          {selectedClientId && /^\d+$/.test(selectedClientId) && (
            <Link
              to={`/clients/${selectedClientId}`}
              className="inline-flex items-center gap-1 mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              العودة لملف العميل
            </Link>
          )}
        </div>
      </div>

      {isError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          {error instanceof Error ? error.message : 'تعذر تحميل كشف الحساب'}
        </div>
      )}

      <SelectionArea>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">العميل</label>
            <select
              value={selectedClientId}
              onChange={(e) => onClientChange(e.target.value)}
              className="w-full max-w-full px-3 py-2.5 sm:py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-right text-base"
            >
              <option value="">— اختر عميلاً —</option>
              {clients.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {!!selectedClientId && barns.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">العنبر</label>
              <select
                value={barnScope === 'all' ? 'all' : String(barnScope)}
                onChange={(e) => {
                  const v = e.target.value
                  setBarnScope(v === 'all' ? 'all' : Number(v))
                }}
                className="w-full max-w-full px-3 py-2.5 sm:py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-right text-base"
              >
                <option value="all">إجمالي العميل (كل العنابر)</option>
                {barns.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">من تاريخ</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-right text-base"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">إلى تاريخ</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-right text-base"
            />
          </div>
        </div>
      </SelectionArea>

      {statement && (
        <>
          <SummaryCards opening={statement.opening_balance} closing={statement.closing_balance} />
          <div className="flex flex-col sm:flex-row flex-wrap justify-stretch sm:justify-end gap-2">
            <button
              type="button"
              disabled={pdfBusy}
              onClick={handleDownloadPdf}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2.5 sm:min-h-0 sm:py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 w-full sm:w-auto"
            >
              <Download className="h-4 w-4 shrink-0" />
              تحميل PDF
            </button>
            <button
              type="button"
              disabled={pdfBusy}
              onClick={handleShareWhatsApp}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2.5 sm:min-h-0 sm:py-2 text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 w-full sm:w-auto"
            >
              <Share2 className="h-4 w-4 shrink-0" />
              واتساب
            </button>
          </div>
        </>
      )}

      <div
        className={cn(
          // Grows with table width so row/bg + hint stretch across full horizontal scroll (not viewport-only)
          'block w-max min-w-full max-w-6xl mx-auto rounded-xl',
          'border border-gray-200 dark:border-gray-700',
          'bg-white dark:bg-gray-800',
          'px-0 py-3 sm:px-4 sm:py-4 md:px-5 md:py-5',
          'shadow-sm sm:ring-1 sm:ring-gray-950/[0.06] dark:sm:ring-white/10'
        )}
      >
        <AccountStatementTable rows={statement?.rows ?? []} isLoading={isLoading} />
      </div>
    </div>
  )
}
