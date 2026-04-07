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
import { formatCurrency, formatDate } from '@/lib/utils'
import { quantityColumnHeaderFromInvoiceItems } from '@/lib/quantityColumnHeader'
import {
  createInvoicePdfBlob,
  normalizeWhatsAppPhone,
  paymentMethodLabel,
  shareInvoicePdfToWhatsApp,
} from '@/lib/invoicePdf'
import type { InvoiceItem } from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import { canCancelFullInvoice } from '@/lib/roles'

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
  const [toast, setToast] = useState<string | null>(null)
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
      setToast('تم إلغاء الفاتورة واستعادة المخزون والخزنة حسب السياسة المحاسبية.')
    },
    onError: (e) => {
      alert(e instanceof Error ? e.message : 'تعذر إلغاء الفاتورة')
    },
  })

  const removeItemMutation = useMutation({
    mutationFn: (itemId: number) => deleteInvoiceItem(String(id), itemId),
    onSuccess: () => {
      invalidateStockQueries()
      setReturnModal(null)
    },
    onError: (e) => {
      alert(e instanceof Error ? e.message : 'تعذر إزالة الصنف')
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
      alert(e instanceof Error ? e.message : 'تعذر تسجيل الإرجاع')
    },
  })

  function handleCancelInvoice() {
    if (
      !window.confirm(
        'إلغاء هذه الفاتورة سيعيد جميع المنتجات إلى المخزن ويلغي المدفوعات المرتبطة بها (خصم نقدي من الخزنة عند الدفع نقداً). هل أنت متأكد؟'
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
      alert('أدخل كمية إرجاع صالحة')
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
      const toastMsg = `تمت إعادة ${maxQ} ${label} من ${returnModal.product_name} إلى ${place} ✓`
      removeItemMutation.mutate(returnModal.id, { onSuccess: () => setToast(toastMsg) })
    } else {
      const toastMsg = `تمت إعادة ${q} ${label} من ${returnModal.product_name} إلى ${place} ✓`
      partialReturnMutation.mutate(
        { itemId: returnModal.id, returned_quantity: q },
        { onSuccess: () => setToast(toastMsg) }
      )
    }
  }

  async function handleShareWhatsApp() {
    if (!invoice || !warehouseName) return
    setSharing(true)
    try {
      const blob = await createInvoicePdfBlob(invoice, warehouseName, barn?.name ?? null)
      const wa = normalizeWhatsAppPhone(client?.phone)
      await shareInvoicePdfToWhatsApp(blob, invoice.id, { phoneDigits: wa })
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'تعذر إنشاء الملف أو المشاركة')
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
        <div
          className="fixed top-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-lg dark:border-emerald-800 dark:bg-emerald-950/90 dark:text-emerald-100"
          role="status"
        >
          {toast}
        </div>
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
          <Link
            to={`/clients/${invoice.client_id}`}
            className="text-sm text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center"
          >
            عرض العميل
            <ArrowRight className="w-4 h-4 inline mr-1" />
          </Link>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-gray-500 dark:text-gray-400">التاريخ</p>
          <p className="font-medium">{formatDate(invoice.created_at)}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">المخزن</p>
          <p className="font-medium">{warehouseName ?? invoice.warehouse_id}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">العنبر</p>
          {invoice.barn_id ? (
            <p className="font-medium">
              {barn?.name ?? `#${invoice.barn_id}`}
              {barn && (
                <Link
                  to={`/barns/${invoice.barn_id}`}
                  className="mr-2 text-xs text-primary-600 dark:text-primary-400 hover:underline"
                >
                  عرض العنبر
                </Link>
              )}
            </p>
          ) : (
            <p className="font-medium text-gray-400 dark:text-gray-500">—</p>
          )}
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">اسم العميل</p>
          <p className="font-medium">{invoice.customer_name}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">طريقة الدفع</p>
          <p className="font-medium">{paymentMethodLabel(invoice.payment_method)}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">المجموع</p>
          <p className="font-bold">{formatCurrency(invoice.total_amount)}</p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">المدفوع / المتبقي</p>
          <p className="font-medium">
            {formatCurrency(invoice.paid_amount)} / {formatCurrency(invoice.remaining_amount)}
          </p>
        </div>
        <div>
          <p className="text-gray-500 dark:text-gray-400">الحالة</p>
          <p className="font-medium">{invoice.status}</p>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">الأصناف</h2>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden overflow-x-auto">
          {!invoice.items?.length ? (
            <p className="p-4 text-center text-gray-500 dark:text-gray-400">
              لا توجد أصناف
            </p>
          ) : (
            <table className="w-full min-w-0 text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="text-right py-2 px-4">المنتج</th>
                  <th className="text-right py-2 px-4 whitespace-nowrap">{quantityColumnHeader}</th>
                  <th className="text-right py-2 px-4 whitespace-nowrap">سعر الوحدة</th>
                  <th className="text-right py-2 px-4 whitespace-nowrap">الإجمالي</th>
                  {!isCancelled && <th className="text-center py-2 px-2 w-24">مرتجع</th>}
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-gray-100 dark:border-gray-700"
                  >
                    <td className="py-2 px-4 break-words">{item.product_name}</td>
                    <td className="py-2 px-4">
                      {item.product_unit_type === 'bulk'
                        ? item.display_unit === 'gram' && item.display_quantity != null
                          ? `${item.display_quantity} جرام`
                          : `${item.quantity} كجم`
                        : item.quantity}
                    </td>
                    <td className="py-2 px-4">{formatCurrency(item.unit_price)}</td>
                    <td className="py-2 px-4 font-medium">
                      {formatCurrency(item.total_price)}
                    </td>
                    {!isCancelled && (
                      <td className="py-2 px-2 text-center">
                        <button
                          type="button"
                          title="مرتجع — إرجاع للمخزن"
                          onClick={() => openReturnModal(item)}
                          disabled={removeItemMutation.isPending || partialReturnMutation.isPending}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200 dark:border-gray-600 dark:hover:bg-red-950/40 dark:hover:text-red-300 disabled:opacity-40"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
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
