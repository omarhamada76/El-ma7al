import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getClients, getClientBarns } from '@/api/clients'
import { createPayment } from '@/api/payments'
import { cn } from '@/lib/utils'

export default function PaymentNew() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const presetFromUrlAppliedRef = useRef(false)
  const [clientId, setClientId] = useState('')
  const [barnId, setBarnId] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [payment_method, setPaymentMethod] = useState<'cash' | 'credit'>('cash')
  const [payment_date, setPaymentDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const { data: clientsData } = useQuery({
    queryKey: ['clients', 'list'],
    queryFn: () => getClients({ limit: 300 }),
  })
  const clients = clientsData?.data ?? []

  useEffect(() => {
    if (presetFromUrlAppliedRef.current) return
    const raw = searchParams.get('client_id')?.trim() ?? ''
    if (!raw || !/^\d+$/.test(raw)) return
    if (clientsData === undefined) return
    if (!clients.some((c) => String(c.id) === raw)) return
    presetFromUrlAppliedRef.current = true
    setClientId(raw)
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
      navigate('/payments')
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدفعة')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!clientId) {
      setError('اختر العميل')
      return
    }
    if (!barnId) {
      setError('اختر العنبر')
      return
    }
    if (amount <= 0) {
      setError('المبلغ يجب أن يكون أكبر من صفر')
      return
    }
    createMutation.mutate({
      client_id: Number(clientId),
      barn_id: Number(barnId),
      amount: Math.round(amount),
      payment_method: payment_method === 'cash' ? 'cash' : 'آجل',
      payment_date: new Date(payment_date).toISOString(),
      notes: notes.trim() || undefined,
    })
  }

  const handleClientChange = (id: string) => {
    setClientId(id)
    setBarnId('')
  }

  return (
    <div className="space-y-6 max-w-lg" dir="rtl">
      <h1 className="text-2xl font-bold">تسجيل دفعة عميل</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        اختر العميل والعنبر، أدخل المبلغ وطريقة الدفع (كاش / آجل) والتاريخ. يتم توزيع المبلغ على الفواتير غير المسددة (الأقدم أولاً). إن كانت الدفعة كاش تُضاف للخزنه.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

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
          <label className="block text-sm font-medium mb-1">العنبر *</label>
          <select
            value={barnId}
            onChange={(e) => setBarnId(e.target.value)}
            disabled={!clientId || barns.length === 0}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent',
              (!clientId || barns.length === 0) && 'opacity-60 cursor-not-allowed'
            )}
            required
          >
            <option value="">— اختر العنبر —</option>
            {barns.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {clientId && barns.length === 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
              لا توجد عنابر لهذا العميل. أضف عنبراً من صفحة تفاصيل العميل.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">المبلغ (ج.م) *</label>
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

        <div>
          <label className="block text-sm font-medium mb-1">طريقة الدفع *</label>
          <select
            value={payment_method}
            onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'credit')}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent'
            )}
          >
            <option value="cash">كاش</option>
            <option value="credit">آجل</option>
          </select>
          {payment_method === 'cash' && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              الدفعة ستُضاف إلى رصيد الخزنه
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">تاريخ الدفع *</label>
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
            disabled={createMutation.isPending || (!!clientId && barns.length === 0)}
            className={cn(
              'flex-1 py-2.5 rounded-lg font-medium text-white',
              'bg-primary-600 hover:bg-primary-700 focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {createMutation.isPending ? 'جاري التسجيل...' : 'تأكيد تسجيل الدفعة'}
          </button>
        </div>
      </form>
    </div>
  )
}
