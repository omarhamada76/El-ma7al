import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getClients, getClientBarns } from '@/api/clients'
import { createPayment } from '@/api/payments'
import { cn } from '@/lib/utils'
import FeedbackBanner from '@/components/FeedbackBanner'
import SuccessOverlay from '@/components/SuccessOverlay'

export default function PaymentNew() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const presetFromUrlAppliedRef = useRef(false)
  const [clientId, setClientId] = useState('')
  const [barnId, setBarnId] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'discount'>('cash')
  const [payment_date, setPaymentDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [paymentSuccess, setPaymentSuccess] = useState(false)

  const { data: clientsData } = useQuery({
    queryKey: ['clients', 'list'],
    queryFn: () => getClients({ limit: 300 }),
  })
  const clients = clientsData?.data ?? []

  useEffect(() => {
    if (presetFromUrlAppliedRef.current) return
    const cid = searchParams.get('client_id')?.trim() ?? ''
    const method = searchParams.get('method')?.trim()
    
    if (method === 'discount') {
      setPaymentMethod('discount')
    }

    if (!cid || !/^\d+$/.test(cid)) return
    if (clientsData === undefined) return
    if (!clients.some((c) => String(c.id) === cid)) return
    
    presetFromUrlAppliedRef.current = true
    setClientId(cid)
    setBarnId('')
    setSearchParams({}, { replace: true })
  }, [searchParams, clients, clientsData, setSearchParams])

  const { data: barns = [] } = useQuery({
    queryKey: ['client', clientId, 'barns'],
    queryFn: () => getClientBarns(clientId),
    enabled: !!clientId,
  })

  const createMutation = useMutation({
    mutationFn: createPayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: ['client', clientId] })
      }
      queryClient.invalidateQueries({ queryKey: ['safe'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      setClientId('')
      setBarnId('')
      setAmount(0)
      setNotes('')
      setError('')
      setPaymentSuccess(true)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل السداد')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!clientId) {
      setError('اختر العميل')
      return
    }
    // Barn is now optional for general discounts/payments
    if (amount <= 0) {
      setError('المبلغ يجب أن يكون أكبر من صفر')
      return
    }
    createMutation.mutate({
      client_id: Number(clientId),
      barn_id: barnId ? Number(barnId) : null,
      amount: Math.round(amount),
      payment_method: paymentMethod,
      payment_date: new Date(payment_date).toISOString(),
      notes: notes.trim() || undefined,
    })
  }

  const handleClientChange = (id: string) => {
    setClientId(id)
    setBarnId('')
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6" dir="rtl">
      <SuccessOverlay
        open={paymentSuccess}
        title={paymentMethod === 'discount' ? "تم تسجيل الخصم بنجاح" : "تم تسجيل السداد بنجاح"}
        subtitle="جاري التوجيه…"
        durationMs={1700}
        onComplete={() => {
          setPaymentSuccess(false)
          navigate('/payments')
        }}
      />
      <h1 className="text-2xl font-bold">
        {paymentMethod === 'discount' ? 'تسجيل خصم مديونية' : 'تسجيل سداد عميل'}
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        اختر العميل والعنبر وأدخل المبلغ والتاريخ. {paymentMethod === 'discount' 
          ? 'يُسجَّل هنا الخصم المباشر من المديونية؛ يقلل المبلغ المتبقي والأرباح المسجلة، ولا يؤثر على الخزنة.' 
          : 'يُسجَّل هنا الدفع النقدي (كاش) فقط؛ يُوزَّع المبلغ على الفواتير غير المسددة (الأقدم أولاً) ويُضاف إلى الخزنة.'}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <FeedbackBanner type="error" message={error} />
        )}

        <div>
          <label className="block text-sm font-medium mb-2">نوع الحركة *</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              className={cn(
                'flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 transition-all duration-200',
                paymentMethod === 'cash'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 ring-2 ring-primary-500/20'
                  : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700'
              )}
            >
              <div className={cn(
                'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                paymentMethod === 'cash' ? 'border-primary-500' : 'border-gray-300'
              )}>
                {paymentMethod === 'cash' && <div className="w-2 h-2 rounded-full bg-primary-500" />}
              </div>
              <span className="font-semibold text-sm">سداد نقدي (كاش)</span>
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('discount')}
              className={cn(
                'flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 transition-all duration-200',
                paymentMethod === 'discount'
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 ring-2 ring-amber-500/20'
                  : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700'
              )}
            >
              <div className={cn(
                'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                paymentMethod === 'discount' ? 'border-amber-500' : 'border-gray-300'
              )}>
                {paymentMethod === 'discount' && <div className="w-2 h-2 rounded-full bg-amber-500" />}
              </div>
              <span className="font-semibold text-sm">خصم مديونية</span>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">العميل *</label>
          <select
            value={clientId}
            onChange={(e) => handleClientChange(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent'
            )}
            required
          >
            <option value="">— اختر العميل —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.phone ? ` — ${c.phone}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">العنبر</label>
          <select
            value={barnId}
            onChange={(e) => setBarnId(e.target.value)}
            disabled={!clientId}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent',
              !clientId && 'opacity-60 cursor-not-allowed'
            )}
          >
            <option value="">— عام (بدون تحديد عنبر) —</option>
            {barns.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {clientId && barns.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              لا توجد عنابر مسجلة لهذا العميل. سيتم تسجيل الحركة على الحساب العام.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            {paymentMethod === 'discount' ? 'قيمة الخصم (ج.م) *' : 'المبلغ (ج.م) *'}
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={amount || ''}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent'
            )}
            placeholder="0"
            required
          />
        </div>

        {paymentMethod === 'cash' ? (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
            طريقة الدفع: <span className="font-semibold">كاش</span> — يُضاف المبلغ إلى رصيد الخزنة.
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
            طريقة الحركة: <span className="font-semibold">خصم مديونية</span> — يُخصم المبلغ من مديونية العميل وأرباح النظام.
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">
            {paymentMethod === 'discount' ? 'تاريخ الخصم *' : 'تاريخ الدفع *'}
          </label>
          <input
            type="date"
            value={payment_date}
            onChange={(e) => setPaymentDate(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent'
            )}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">ملاحظات</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent'
            )}
            rows={2}
            placeholder="اختياري"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-1 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className={cn(
              'flex-1 py-2.5 rounded-lg font-medium text-white',
              paymentMethod === 'discount' 
                ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500' 
                : 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500',
              'focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {createMutation.isPending ? 'جاري الحفظ...' : (paymentMethod === 'discount' ? 'تأكيد تسجيل الخصم' : 'تأكيد تسجيل السداد')}
          </button>
        </div>
      </form>
    </div>
  )
}
