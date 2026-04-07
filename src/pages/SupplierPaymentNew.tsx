import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSuppliers } from '@/api/suppliers'
import { createSupplierPayment } from '@/api/supplierPayments'
import { cn } from '@/lib/utils'

export default function SupplierPaymentNew() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [supplierId, setSupplierId] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [payment_method, setPaymentMethod] = useState<'cash' | 'bank'>('cash')
  const [payment_date, setPaymentDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers', 'list'],
    queryFn: () => getSuppliers({ limit: 300 }),
  })
  const suppliers = suppliersData?.data ?? []

  const createMutation = useMutation({
    mutationFn: createSupplierPayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      queryClient.invalidateQueries({ queryKey: ['supplier'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['safe'] })
      navigate('/suppliers')
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'فشل تسجيل السداد')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!supplierId) {
      setError('اختر المورد')
      return
    }
    if (amount <= 0) {
      setError('المبلغ يجب أن يكون أكبر من صفر')
      return
    }
    createMutation.mutate({
      supplier_id: Number(supplierId),
      amount: Math.round(amount),
      payment_method: payment_method === 'cash' ? 'cash' : 'bank',
      payment_date: new Date(payment_date).toISOString(),
      notes: notes.trim() || undefined,
    })
  }

  return (
    <div className="space-y-6 max-w-lg" dir="rtl">
      <h1 className="text-2xl font-bold">سداد لمورد</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        اختر المورد، أدخل المبلغ، طريقة الدفع (كاش/بنك)، التاريخ والملاحظات. عند الحفظ يتم خصم المبلغ من رصيد الخزنه وتقليل ما نستحق للمورد.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">المورد *</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
            )}
            required
          >
            <option value="">— اختر المورد —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">المبلغ (ج.م) *</label>
          <input
            type="number"
            min={1}
            step={1}
            value={amount === 0 ? '' : amount}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
            placeholder="0"
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
            )}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">طريقة الدفع *</label>
          <select
            value={payment_method}
            onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'bank')}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
            )}
          >
            <option value="cash">كاش</option>
            <option value="bank">بنك</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">التاريخ *</label>
          <input
            type="date"
            value={payment_date}
            onChange={(e) => setPaymentDate(e.target.value)}
            className={cn(
              'w-full px-3 py-2 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
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
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
            )}
            rows={3}
            placeholder="ملاحظات اختيارية..."
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
            disabled={createMutation.isPending || !supplierId || amount <= 0}
            className={cn(
              'flex-1 py-2.5 rounded-lg font-medium text-white',
              'bg-primary-600 hover:bg-primary-700 focus:ring-2 focus:ring-primary-500',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {createMutation.isPending ? 'جاري الحفظ...' : 'تسجيل السداد'}
          </button>
        </div>
      </form>
    </div>
  )
}
