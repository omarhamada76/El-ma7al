import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Share2, Pencil, Trash2, X } from 'lucide-react'
import {
  getInvoice,
  cancelInvoice,
  deleteInvoiceItem,
  returnPartialInvoiceItem,
} from '@/api/invoices'
import { getBarn } from '@/api/barns'
import { getClient } from '@/api/clients'
import { getWarehouses } from '@/api/warehouses'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { quantityColumnHeaderFromInvoiceItems } from '@/lib/quantityColumnHeader'
import {
  createInvoicePdfBlob,
  normalizeWhatsAppPhone,
  paymentMethodLabel,
  isInvoiceCashPayment,
  shareInvoicePdfToWhatsApp,
} from '@/lib/invoicePdf'
import type { InvoiceItem } from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import { canCancelFullInvoice } from '@/lib/roles'
import FeedbackBanner from '@/components/FeedbackBanner'
import InvoiceReceiptPrint from '@/components/InvoiceReceiptPrint'

function formatBatchExpiry(d: string | null | undefined) {
  if (!d || d === '9999-12-31') return 'بدون تاريخ'
  return d
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const role = useAuthStore((s) => s.user?.role)
  const canCancel = canCancelFullInvoice(role)
  const [sharing, setSharing] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null)
  const [returnModal, setReturnModal] = useState<InvoiceItem | null>(null)
  const [returnQtyInput, setReturnQtyInput] = useState('')

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => getInvoice(id!),
    enabled: !!id,
  })
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses,
  })
  const { data: client } = useQuery({
    queryKey: ['client', invoice?.client_id],
    queryFn: () => getClient(String(invoice!.client_id)),
    enabled: !!invoice?.client_id,
  })
  const { data: barn } = useQuery({
    queryKey: ['barn', invoice?.barn_id],
    queryFn: () => getBarn(String(invoice!.barn_id)),
    enabled: !!invoice?.barn_id,
  })

  const warehouseName =
    invoice &&
    warehouses.find((w) => w.id === invoice.warehouse_id)?.name_ar

  const quantityColumnHeader = useMemo(
    () => quantityColumnHeaderFromInvoiceItems(invoice?.items ?? []),
    [invoice?.items]
  )

  const invBarnBefore =
    invoice != null
      ? typeof invoice.barn_balance_before === 'number'
        ? invoice.barn_balance_before
        : Number(invoice.barn_balance_before)
      : NaN
  const invBarnAfter =
    invoice != null
      ? typeof invoice.barn_balance_after === 'number'
        ? invoice.barn_balance_after
        : Number(invoice.barn_balance_after)
      : NaN
  const hasInvBarnBalanceSnapshot =
    invoice != null && Number.isFinite(invBarnBefore) && Number.isFinite(invBarnAfter)

  const isCancelled = (invoice?.invoice_lifecycle ?? 'active') === 'cancelled'
  const structuralAllowed = invoice?.structural_edit_allowed !== false
  const showEditWindowExpiredBanner =
    !isCancelled && invoice != null && invoice.structural_edit_allowed === false
  const showSuperAdminOverrideBanner =
    !isCancelled &&
    invoice != null &&
    invoice.structural_edit_allowed === true &&
    invoice.structural_edit_within_window === false
  const editWindowDays = invoice?.edit_window_days ?? 7

  function invalidateStockQueries() {
    queryClient.invalidateQueries({ queryKey: ['invoices'] })
    queryClient.invalidateQueries({ queryKey: ['invoice', id] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['reports'] })
    queryClient.invalidateQueries({ queryKey: ['safe'] })
    if (invoice?.warehouse_id) {
      const wh = String(invoice.warehouse_id)
      queryClient.invalidateQueries({ queryKey: ['products', 'warehouse', wh] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-batches', wh] })
    }
    queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
    queryClient.invalidateQueries({ queryKey: ['warehouse-batches'] })
    queryClient.invalidateQueries({ queryKey: ['products'] })
    queryClient.invalidateQueries({ queryKey: ['product'] })
    if (invoice?.client_id != null) {
      queryClient.invalidateQueries({ queryKey: ['client', String(invoice.client_id)] })
    }
    if (invoice?.barn_id != null) {
      queryClient.invalidateQueries({ queryKey: ['barn', String(invoice.barn_id)] })
    }
    queryClient.invalidateQueries({ queryKey: ['clients'] })
  }

  const cancelMutation = useMutation({
    mutationFn: () => cancelInvoice(String(id)),
    onSuccess: () => {
      invalidateStockQueries()
      setToast({
        type: 'success',
        message: 'تم إلغاء الفاتورة واستعادة المخزون والخزنة حسب السياسة المحاسبية.',
      })
    },
    onError: (e) => {
      setToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'تعذر إلغاء الفاتورة',
      })
    },
  })

  const removeItemMutation = useMutation({
    mutationFn: (itemId: number) => deleteInvoiceItem(String(id), itemId),
    onSuccess: () => {
      invalidateStockQueries()
      setReturnModal(null)
    },
    onError: (e) => {
      setToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'تعذر إزالة الصنف',
      })
    },
  })

  const partialReturnMutation = useMutation({
    mutationFn: (args: { itemId: number; returned_quantity: number }) =>
      returnPartialInvoiceItem(String(id), args.itemId, {
        returned_quantity: args.returned_quantity,
      }),
    onSuccess: () => {
      invalidateStockQueries()
      setReturnModal(null)
    },
    onError: (e) => {
      setToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'تعذر تسجيل الإرجاع',
      })
    },
  })

  function handleCancelInvoice() {
    if (
      !window.confirm(
        'إلغاء هذه الفاتورة سيعيد جميع المنتجات إلى المخزن ويلغي السداد المرتبط بها (خصم نقدي من الخزنة عند الدفع نقداً). هل أنت متأكد؟'
      )
    ) {
      return
    }
    cancelMutation.mutate()
  }

  function openReturnModal(item: InvoiceItem) {
    setReturnModal(item)
    setReturnQtyInput(String(item.quantity))
  }

  function confirmReturnLine() {
    if (!returnModal || !id) return
    const maxQ = Number(returnModal.quantity) || 0
    const q = parseFloat(returnQtyInput.replace(',', '.'))
    if (!Number.isFinite(q) || q <= 0 || q > maxQ + 0.0001) {
      setToast({ type: 'warning', message: 'أدخل كمية إرجاع صالحة' })
      return
    }
    const isFull = q >= maxQ - 0.0001
    const sellPrice = returnModal.unit_selling_price ?? returnModal.unit_price
    const expiryLabel = formatBatchExpiry(returnModal.batch_expiry_date)
    if (
      !window.confirm(
        `هل تريد إزالة ${isFull ? 'كامل' : 'جزء من'} ${returnModal.product_name} من الفاتورة؟\nسيتم إعادة ${q} ${returnModal.product_unit_type === 'bulk' ? 'كيلو' : 'وحدة'} إلى المخزن (دفعة: ${expiryLabel} — ${formatCurrency(sellPrice)})`
      )
    ) {
      return
    }
    const isBulk = returnModal.product_unit_type === 'bulk'
    const label = isBulk ? 'كيلو' : 'وحدة'
    const place = isBulk ? 'الشكارة' : 'المخزن'
    if (isFull) {
      const toastMsg = `تمت إعادة ${maxQ} ${label} من ${returnModal.product_name} إلى ${place} بنجاح`
      removeItemMutation.mutate(returnModal.id, {
        onSuccess: () => setToast({ type: 'success', message: toastMsg }),
      })
    } else {
      const toastMsg = `تمت إعادة ${q} ${label} من ${returnModal.product_name} إلى ${place} بنجاح`
      partialReturnMutation.mutate(
        { itemId: returnModal.id, returned_quantity: q },
        { onSuccess: () => setToast({ type: 'success', message: toastMsg }) }
      )
    }
  }

  function invoiceBarnBalanceSnapshot() {
    const b = invoice?.barn_balance_before
    const a = invoice?.barn_balance_after
    const bn = typeof b === 'number' ? b : Number(b)
    const an = typeof a === 'number' ? a : Number(a)
    if (!Number.isFinite(bn) || !Number.isFinite(an)) return null
    return { before: bn, after: an }
  }

  async function handleShareWhatsApp() {
    if (!invoice || !warehouseName) return
    setSharing(true)
    try {
      const blob = await createInvoicePdfBlob(
        invoice,
        warehouseName,
        barn?.name ?? null,
        invoiceBarnBalanceSnapshot()
      )
      const wa = normalizeWhatsAppPhone(client?.phone)
      await shareInvoicePdfToWhatsApp(blob, invoice.id, { phoneDigits: wa })
    } catch (e) {
      console.error(e)
      setToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'تعذر إنشاء الملف أو المشاركة',
      })
    } finally {
      setSharing(false)
    }
  }

  if (!id) return null
  if (isLoading || !invoice)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    )

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 relative" dir="rtl">
      {toast && (
        <FeedbackBanner type={toast.type} message={toast.message} fixed />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">فاتورة #{invoice.id}</h1>
          {isCancelled && (
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200">
              ملغاة
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isCancelled && structuralAllowed && (
            <Link
              to={`/invoices/${id}/edit`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Pencil className="w-4 h-4" />
              تعديل
            </Link>
          )}
          {canCancel && !isCancelled && (
            <button
              type="button"
              onClick={handleCancelInvoice}
              disabled={cancelMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-900/40 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              {cancelMutation.isPending ? 'جاري الإلغاء…' : 'إلغاء الفاتورة'}
            </button>
          )}
          <InvoiceReceiptPrint
            invoice={invoice}
            warehouseName={warehouseName ?? String(invoice.warehouse_id)}
            barnName={barn?.name ?? null}
            isCancelled={isCancelled}
          />
          <button
            type="button"
            title="يُحمَّل ملف PDF ثم يُفتح واتساب ويب — أرفق الملف بزر 📎 (على الكمبيوتر)"
            onClick={() => void handleShareWhatsApp()}
            disabled={sharing}
            className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-800 hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-200 dark:hover:bg-primary-900/50 disabled:opacity-50"
          >
            <Share2 className="w-4 h-4" />
            {sharing ? 'جاري التجهيز…' : 'مشاركة PDF عبر واتساب'}
          </button>
          {invoice.client_id != null && (
            <Link
              to={`/clients/${invoice.client_id}`}
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center"
            >
              عرض العميل
              <ArrowRight className="w-4 h-4 inline mr-1" />
            </Link>
          )}
        </div>
      </div>

      {isCancelled && (
        <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900 rounded-lg px-3 py-2">
          هذه الفاتورة ملغاة للمراجعة فقط — لا يمكن تعديلها أو إعادة بيع الأصناف منها.
        </p>
      )}

      {showEditWindowExpiredBanner && (
        <p className="text-sm text-amber-900 dark:text-amber-100 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          انتهت مدة التعديل المسموح بها ({editWindowDays} يوم من تاريخ الإنشاء). لإرجاع منتج
          استخدم زر المرتجع ←
        </p>
      )}

      {showSuperAdminOverrideBanner && (
        <p className="text-sm text-amber-900 dark:text-amber-100 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          تنبيه: انتهت مدة التعديل العادية لهذه الفاتورة. أنت تعدّل بصلاحية المدير العام.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 text-sm">
        <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 shadow-sm transition-all hover:border-primary-200 dark:hover:border-primary-800">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold mb-1 tracking-wider">التاريخ</p>
          <p className="font-bold text-gray-900 dark:text-gray-100">{formatDate(invoice.created_at)}</p>
        </div>
        <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 shadow-sm transition-all hover:border-primary-200 dark:hover:border-primary-800">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold mb-1 tracking-wider">المخزن</p>
          <p className="font-bold text-gray-900 dark:text-gray-100">{warehouseName ?? invoice.warehouse_id}</p>
        </div>
        <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 shadow-sm transition-all hover:border-primary-200 dark:hover:border-primary-800">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold mb-1 tracking-wider">العنبر</p>
          {invoice.barn_id ? (
            <p className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              {barn?.name ?? `#${invoice.barn_id}`}
              {barn && (
                <Link
                  to={`/barns/${invoice.barn_id}`}
                  className="text-[10px] text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 border border-primary-200 dark:border-primary-800 px-1.5 py-0.5 rounded-md font-bold transition-colors"
                >
                  عرض العنبر
                </Link>
              )}
            </p>
          ) : (
            <p className="font-bold text-gray-300 dark:text-gray-600">—</p>
          )}
        </div>
        <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 shadow-sm transition-all hover:border-primary-200 dark:hover:border-primary-800">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold mb-1 tracking-wider">اسم العميل</p>
          <p className="font-bold text-gray-900 dark:text-gray-100">{invoice.customer_name}</p>
        </div>
        <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 shadow-sm transition-all hover:border-primary-200 dark:hover:border-primary-800">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold mb-1 tracking-wider">طريقة الدفع</p>
          <span className={cn(
             "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-tight",
             invoice.payment_method === 'cash' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-amber-50 text-amber-700 border border-amber-100"
          )}>
            {paymentMethodLabel(invoice.payment_method)}
          </span>
        </div>
        <div className="p-3.5 rounded-xl border-2 border-primary-100 dark:border-primary-900/50 bg-primary-50/20 dark:bg-primary-900/10 shadow-sm">
          <p className="text-[10px] text-primary-600/70 dark:text-primary-400/70 uppercase font-black mb-1 tracking-wider">المجموع النهائي</p>
          <p className="font-black text-primary-700 dark:text-primary-300 text-lg">{formatCurrency(invoice.total_amount)}</p>
        </div>
        {isInvoiceCashPayment(invoice.payment_method) ? (
          <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 shadow-sm">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold mb-1 tracking-wider">المدفوع / المتبقي</p>
            <p className="font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {formatCurrency(invoice.paid_amount)} / <span className="text-red-600 dark:text-red-400">{formatCurrency(invoice.remaining_amount)}</span>
            </p>
          </div>
        ) : null}
        {hasInvBarnBalanceSnapshot && (
          <div className="sm:col-span-2 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 shadow-sm flex justify-between items-center gap-4">
            <div className="flex-1">
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold mb-1 tracking-wider">رصيد العنبر (قبل)</p>
              <p className="font-bold tabular-nums text-gray-900 dark:text-gray-100">{formatCurrency(invBarnBefore)}</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-white dark:bg-gray-700 flex items-center justify-center shadow-sm border border-gray-100 dark:border-gray-600">
              <ArrowRight className="w-4 h-4 text-gray-400 rotate-180" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase font-bold mb-1 tracking-wider">رصيد العنبر (بعد)</p>
              <p className="font-bold tabular-nums text-primary-600 dark:text-primary-400">{formatCurrency(invBarnAfter)}</p>
            </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">الأصناف</h2>
        <div className="responsive-table-container">
          {!invoice.items?.length ? (
            <p className="p-8 text-center text-gray-500 dark:text-gray-400">
              لا توجد أصناف في هذه الفاتورة.
            </p>
          ) : (
            <>
              {/* Desktop View: Table */}
              <table className="hidden sm:table responsive-table">
                <thead>
                  <tr>
                    <th className="text-right">المنتج</th>
                    <th className="text-right">{quantityColumnHeader}</th>
                    <th className="text-right">سعر الوحدة</th>
                    <th className="text-right">الإجمالي</th>
                    {!isCancelled && <th className="text-center w-24">مرتجع</th>}
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item) => (
                    <tr key={item.id}>
                      <td className="font-medium">{item.product_name}</td>
                      <td className="tabular-nums">
                        {item.product_unit_type === 'bulk'
                          ? item.display_unit === 'gram' && item.display_quantity != null
                            ? `${item.display_quantity} جرام`
                            : `${item.quantity} كجم`
                          : item.quantity}
                      </td>
                      <td className="tabular-nums text-gray-500">{formatCurrency(item.unit_price)}</td>
                      <td className="tabular-nums font-bold text-gray-900 dark:text-gray-100">
                        {formatCurrency(item.total_price)}
                      </td>
                      {!isCancelled && (
                        <td className="text-center">
                          <button
                            type="button"
                            title="مرتجع — إرجاع للمخزن"
                            onClick={() => openReturnModal(item)}
                            disabled={removeItemMutation.isPending || partialReturnMutation.isPending}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200 dark:border-gray-600 dark:hover:bg-red-950/40 dark:hover:text-red-300 disabled:opacity-40 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile View: Cards */}
              <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                {invoice.items.map((item) => (
                  <div key={item.id} className="p-4 space-y-3">
                    <div className="flex justify-between items-start gap-2">
                       <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                         {item.product_name}
                       </p>
                       {!isCancelled && (
                         <button
                           type="button"
                           onClick={() => openReturnModal(item)}
                           disabled={removeItemMutation.isPending || partialReturnMutation.isPending}
                           className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 text-[10px] font-bold text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300"
                         >
                           <X className="w-3 h-3" />
                           إرجاع
                         </button>
                       )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                         <p className="mobile-card-label">{quantityColumnHeader}</p>
                         <p className="mobile-card-value">
                            {item.product_unit_type === 'bulk'
                              ? item.display_unit === 'gram' && item.display_quantity != null
                                ? `${item.display_quantity} جرام`
                                : `${item.quantity} كجم`
                              : item.quantity}
                         </p>
                       </div>
                       <div>
                         <p className="mobile-card-label">سعر الوحدة</p>
                         <p className="mobile-card-value">{formatCurrency(item.unit_price)}</p>
                       </div>
                    </div>
                    <div className="flex justify-between items-center py-1.5 bg-gray-50 dark:bg-gray-800 px-2 rounded-lg">
                       <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">الإجمالي:</span>
                       <span className="text-sm font-bold text-primary-600 dark:text-primary-400">{formatCurrency(item.total_price)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {returnModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="return-dialog-title"
        >
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 id="return-dialog-title" className="text-lg font-semibold mb-2">
              إرجاع صنف
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {returnModal.product_name}
            </p>
            <label className="block text-sm font-medium mb-1">
              كمية الإرجاع{' '}
              {returnModal.product_unit_type === 'bulk' ? '(كيلو)' : '(وحدات)'}
            </label>
            <input
              type="number"
              min={0.001}
              step={returnModal.product_unit_type === 'bulk' ? 0.001 : 1}
              max={returnModal.quantity}
              value={returnQtyInput}
              onChange={(e) => setReturnQtyInput(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm mb-1"
            />
            <p className="text-xs text-gray-500 mb-4">
              الحد الأقصى:{' '}
              {returnModal.product_unit_type === 'bulk'
                ? `${returnModal.quantity} كيلو`
                : returnModal.quantity}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setReturnModal(null)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={confirmReturnLine}
                disabled={removeItemMutation.isPending || partialReturnMutation.isPending}
                className="px-3 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {removeItemMutation.isPending || partialReturnMutation.isPending
                  ? 'جاري التنفيذ…'
                  : 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
