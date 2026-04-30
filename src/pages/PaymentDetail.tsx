import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Calendar,
  User,
  Warehouse,
  FileText,
  Share2,
} from 'lucide-react'
import { getPayment } from '@/api/payments'
import { getClient } from '@/api/clients'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  paymentMethodLabel,
  createPaymentPdfBlob,
  sharePaymentPdfToWhatsApp,
  normalizeWhatsAppPhone,
} from '@/lib/invoicePdf'
import FeedbackBanner from '@/components/FeedbackBanner'

function num(v: unknown): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

export default function PaymentDetail() {
  const { id } = useParams<{ id: string }>()
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState('')

  const { data: payment, isLoading, isError, error } = useQuery({
    queryKey: ['payment', id],
    queryFn: () => getPayment(id!),
    enabled: !!id,
  })

  const { data: clientForShare } = useQuery({
    queryKey: ['client', payment?.client_id],
    queryFn: () => getClient(String(payment!.client_id)),
    enabled: !!payment?.client_id,
  })

  if (!id) return null

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 max-w-3xl mx-auto" dir="rtl">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-48 bg-gray-200 dark:bg-gray-700 rounded-xl" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
      </div>
    )
  }

  if (isError || !payment) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto" dir="rtl">
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'تعذر تحميل بيانات السداد'}
        </p>
        <Link to="/payments" className="text-primary-600 dark:text-primary-400 hover:underline">
          العودة إلى سجل السداد
        </Link>
      </div>
    )
  }

  const barnBefore = num(payment.barn_balance_before)
  const barnAfter = num(payment.barn_balance_after)
  const hasBarnBalanceSnapshot = barnBefore !== undefined && barnAfter !== undefined

  async function handleShareWhatsApp() {
    setShareError('')
    setSharing(true)
    try {
      const pdfBarn =
        barnBefore !== undefined && barnAfter !== undefined
          ? { before: barnBefore, after: barnAfter }
          : null
      const blob = await createPaymentPdfBlob(payment, pdfBarn)
      const wa = normalizeWhatsAppPhone(clientForShare?.phone)
      await sharePaymentPdfToWhatsApp(blob, payment.id, { phoneDigits: wa })
    } catch (e) {
      console.error(e)
      setShareError(e instanceof Error ? e.message : 'تعذر إنشاء الملف أو المشاركة')
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-10" dir="rtl">
      {shareError ? (
        <FeedbackBanner type="error" message={shareError} fixed />
      ) : null}
      <div>
        <Link
          to="/payments"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          <ArrowRight className="w-4 h-4 shrink-0" />
          سجل السداد
        </Link>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
              تفاصيل السداد
            </h1>
            <span className="inline-flex items-center rounded-full bg-primary-100 dark:bg-primary-900/40 px-3 py-1 text-sm font-semibold text-primary-800 dark:text-primary-200">
              #{payment.id}
            </span>
          </div>
          <button
            type="button"
            title="يُحمَّل PDF ثم يُفتح واتساب — أرفق الملف بزر 📎 على الكمبيوتر"
            onClick={() => void handleShareWhatsApp()}
            disabled={sharing}
            className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-800 hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-200 dark:hover:bg-primary-900/50 disabled:opacity-50"
          >
            <Share2 className="w-4 h-4" />
            {sharing ? 'جاري التجهيز…' : 'مشاركة PDF عبر واتساب'}
          </button>
        </div>
      </div>

      {/* مبلغ السداد والتاريخ وطريقة السداد */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50/80 dark:from-gray-800 dark:to-gray-900/50 shadow-sm overflow-hidden">
        <div className="p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">مبلغ السداد</p>
              <p className="text-3xl sm:text-4xl font-bold tabular-nums text-gray-900 dark:text-white tracking-tight">
                {formatCurrency(payment.amount)}
              </p>
            </div>
            <div className="flex flex-wrap gap-4 sm:gap-6 text-sm">
              <div className="flex items-start gap-2">
                <Calendar className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-gray-500 dark:text-gray-400">تاريخ السداد</p>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{formatDate(payment.payment_date)}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Banknote className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-gray-500 dark:text-gray-400">طريقة السداد</p>
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {paymentMethodLabel(payment.payment_method)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {hasBarnBalanceSnapshot ? (
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 p-5 sm:p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
            رصيد العنبر (لحظة تسجيل السداد)
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
            حساب محاسبي للعنبر (ابتدائي + فواتير − تحصيل نقدي) وفق تسجيلات النظام.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500 dark:text-gray-400">رصيد العنبر قبل السداد</p>
              <p className="font-medium tabular-nums">{formatCurrency(barnBefore!)}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                {payment.barn_name?.trim() ||
                  (payment.barn_id != null
                    ? `عنبر #${payment.barn_id}`
                    : payment.invoice_id != null
                      ? `من فاتورة #${payment.invoice_id}`
                      : '—')}
              </p>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400">رصيد العنبر بعد السداد</p>
              <p className="font-medium tabular-nums">{formatCurrency(barnAfter!)}</p>
            </div>
          </div>
        </section>
      ) : null}

      {/* العميل والعنبر والروابط */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 p-6 sm:p-8 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-5">
          الجهات المرتبطة
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <Link
            to={`/clients/${payment.client_id}`}
            className="group flex gap-4 rounded-xl border border-gray-100 dark:border-gray-700 p-4 transition-colors hover:border-primary-300 dark:hover:border-primary-600 hover:bg-primary-50/50 dark:hover:bg-primary-950/20"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
              <User className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1 text-right">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">العميل</p>
              <p className="font-semibold text-gray-900 dark:text-white group-hover:text-primary-700 dark:group-hover:text-primary-300 truncate">
                {payment.client_name ?? `عميل #${payment.client_id}`}
              </p>
              <p className="text-xs text-primary-600 dark:text-primary-400 mt-1">عرض البطاقة ←</p>
            </div>
          </Link>

          {payment.barn_id != null ? (
            <Link
              to={`/barns/${payment.barn_id}`}
              className="group flex gap-4 rounded-xl border border-gray-100 dark:border-gray-700 p-4 transition-colors hover:border-primary-300 dark:hover:border-primary-600 hover:bg-primary-50/50 dark:hover:bg-primary-950/20"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                <Warehouse className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1 text-right">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">العنبر</p>
                <p className="font-semibold text-gray-900 dark:text-white group-hover:text-primary-700 dark:group-hover:text-primary-300 truncate">
                  {payment.barn_name ?? `عنبر #${payment.barn_id}`}
                </p>
                <p className="text-xs text-primary-600 dark:text-primary-400 mt-1">عرض التفاصيل ←</p>
              </div>
            </Link>
          ) : (
            <div className="flex gap-4 rounded-xl border border-dashed border-gray-200 dark:border-gray-600 p-4 opacity-70">
              <Warehouse className="w-5 h-5 text-gray-400 mt-1" />
              <div>
                <p className="text-xs font-medium text-gray-500">العنبر</p>
                <p className="text-gray-400">—</p>
              </div>
            </div>
          )}
        </div>

        {payment.invoice_id != null && (
          <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700">
            <Link
              to={`/invoices/${payment.invoice_id}`}
              className="inline-flex items-center gap-2 text-primary-600 dark:text-primary-400 font-medium hover:underline"
            >
              <FileText className="w-4 h-4" />
              الفاتورة المرتبطة #{payment.invoice_id}
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </div>
        )}

        {payment.notes && (
          <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">ملاحظات</p>
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap rounded-lg bg-gray-50 dark:bg-gray-900/50 p-4">
              {payment.notes}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
