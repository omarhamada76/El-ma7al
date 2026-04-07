import { useParams, Link } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Share2, ArrowRight } from 'lucide-react'
import { getClientAccountStatement } from '@/api/accountStatement'
import { getClient } from '@/api/clients'
import AccountStatementTable from '@/components/AccountStatementTable'
import { formatCurrency, localISODate } from '@/lib/utils'
import {
  createStatementPdfBlob,
  downloadStatementPdf,
  shareStatementToWhatsApp,
} from '@/lib/accountStatementPdf'

export default function ClientAccountStatement() {
  const { id } = useParams<{ id: string }>()
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return localISODate(d)
  })
  const [to, setTo] = useState(() => localISODate())
  const [pdfBusy, setPdfBusy] = useState(false)

  const { data: client } = useQuery({
    queryKey: ['client', id],
    queryFn: () => getClient(id!),
    enabled: !!id,
  })
  const idValid = !!id && /^\d+$/.test(id.trim())

  const { data: statement, isLoading, isError, error } = useQuery({
    queryKey: ['account-statement', 'client', id, from, to],
    queryFn: () => getClientAccountStatement(id!.trim(), { from, to }),
    enabled: idValid,
    staleTime: 0,
  })

  const clientName = client?.name ?? `عميل #${id}`

  async function handleDownloadPdf() {
    if (!statement || pdfBusy) return
    setPdfBusy(true)
    try {
      const blob = await createStatementPdfBlob(clientName, from, to, statement)
      await downloadStatementPdf(blob, clientName)
    } finally {
      setPdfBusy(false)
    }
  }

  async function handleShareWhatsApp() {
    if (!statement || pdfBusy) return
    setPdfBusy(true)
    try {
      const blob = await createStatementPdfBlob(clientName, from, to, statement)
      await shareStatementToWhatsApp(blob, clientName, {
        phone: client?.phone,
        from,
        to,
      })
    } finally {
      setPdfBusy(false)
    }
  }

  if (id && !idValid) {
    return (
      <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-sm" dir="rtl">
        رابط كشف الحساب غير صالح (معرف العميل يجب أن يكون رقماً). افتح كشف الحساب من صفحة العميل أو قائمة العملاء.
      </div>
    )
  }

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            كشف حساب العميل {client?.name ? `— ${client.name}` : ''}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
            إجمالي العميل: جميع الفواتير والمدفوعات لكل العنابر ضمن الفترة المحددة.
          </p>
          {id && (
            <Link
              to={`/clients/${id}`}
              className="inline-flex items-center gap-1 mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              العودة لملف العميل
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

      {statement && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20">
            <p className="text-sm text-gray-600 dark:text-gray-400">الرصيد الافتتاحي</p>
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
