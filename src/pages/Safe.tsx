import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet, ArrowDownLeft, ArrowUpRight, Trash2 } from 'lucide-react'
import { getSafeBalance, getSafeTransactions, setInitialBalance, safeAdjustment, deleteSafeTransaction, clearSafeDeletableHistory } from '@/api/safe'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import SafeInitialModal from '@/components/SafeInitialModal'
import SafeAdjustmentModal from '@/components/SafeAdjustmentModal'
import SafeSetBalanceModal from '@/components/SafeSetBalanceModal'

const typeLabels: Record<string, string> = {
  initial: 'رصيد افتتاحي',
  customer_payment_in: 'دفعة عميل (داخل)',
  supplier_payment_out: 'سداد لمورد (خارج)',
  adjustment_in: 'تعديل إيداع',
  adjustment_out: 'تعديل سحب',
}

export default function Safe() {
  const [page] = useState(1)
  const [initialOpen, setInitialOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [setBalanceOpen, setSetBalanceOpen] = useState(false)
  const queryClient = useQueryClient()
  const initialMutation = useMutation({
    mutationFn: setInitialBalance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safe'] })
    },
  })
  const adjustMutation = useMutation({
    mutationFn: safeAdjustment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safe'] })
    },
  })
  const deleteTxMutation = useMutation({
    mutationFn: (id: number) => deleteSafeTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safe'] })
    },
  })
  const clearHistoryMutation = useMutation({
    mutationFn: clearSafeDeletableHistory,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['safe'] })
      if (data.deleted === 0) {
        alert('لا توجد حركات قابلة للحذف (الحركات المرتبطة بدفعات العملاء أو الموردين تبقى في السجل).')
      }
    },
    onError: (err) => {
      alert(err instanceof Error ? err.message : 'فشل مسح السجل')
    },
  })
  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: ['safe', 'balance'],
    queryFn: getSafeBalance,
  })
  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['safe', 'transactions', page],
    queryFn: () => getSafeTransactions({ page, limit: 20 }),
  })

  const balance = balanceData?.balance ?? 0
  const transactions = txData?.data ?? []

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-xl sm:text-2xl font-bold">الخزنه</h1>

      <div
        className="p-6 rounded-2xl border-2 border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 cursor-pointer select-none"
        title="اضغط لضبط رصيد الخزنه مباشرة"
        onClick={() => {
          if (!balanceLoading) setSetBalanceOpen(true)
        }}
      >
        {balanceLoading ? (
          <div className="h-12 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        ) : (
          <>
            <p className="text-sm text-primary-700 dark:text-primary-300 font-medium flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              رصيد الخزنه
            </p>
            <p className="text-4xl font-bold text-primary-800 dark:text-primary-200 mt-2">
              {formatCurrency(balance)}
            </p>
            <p className="mt-1 text-xs text-primary-700/80 dark:text-primary-300/80">
              اضغط على البطاقة لضبط الرصيد مباشرة (سيتم حساب الفرق تلقائياً كتعديل).
            </p>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium text-sm"
          onClick={() => setInitialOpen(true)}
        >
          رصيد افتتاحي
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium text-sm"
          onClick={() => setAdjustOpen(true)}
        >
          تعديل (إيداع/سحب)
        </button>
        {balance > 0 && (
          <button
            type="button"
            className="px-4 py-2 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium text-sm"
            onClick={() => {
              if (window.confirm(`هل أنت متأكد من تصفير الخزنه؟ سيتم سحب ${formatCurrency(balance)} من الرصيد.`)) {
                adjustMutation.mutate({ type: 'adjustment_out', amount: balance, notes: 'تصفير الخزنه' })
              }
            }}
          >
            تصفير الخزنه
          </button>
        )}
      </div>
      <SafeInitialModal
        open={initialOpen}
        onClose={() => setInitialOpen(false)}
        onSubmit={async (d) => { await initialMutation.mutateAsync(d) }}
      />
      <SafeAdjustmentModal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        onSubmit={async (d) => { await adjustMutation.mutateAsync(d) }}
      />
      <SafeSetBalanceModal
        open={setBalanceOpen}
        onClose={() => setSetBalanceOpen(false)}
        currentBalance={balance}
        onSubmit={async ({ newBalance, notes }) => {
          const delta = newBalance - balance
          const amount = Math.abs(delta)
          if (!amount || amount <= 0) return
          const type: 'adjustment_in' | 'adjustment_out' =
            delta > 0 ? 'adjustment_in' : 'adjustment_out'
          await adjustMutation.mutateAsync({ type, amount, notes })
        }}
      />

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold">سجل الحركات</h2>
          <button
            type="button"
            className="text-sm px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/20 font-medium"
            disabled={clearHistoryMutation.isPending || transactions.length === 0}
            onClick={() => {
              if (
                window.confirm(
                  'هل تريد مسح السجل؟ سيتم حذف كل الحركات القابلة للحذف (رصيد افتتاحي، تعديلات، تصفير…). تبقى حركات دفعات العملاء والموردين المرتبطة بالنظام.'
                )
              ) {
                clearHistoryMutation.mutate()
              }
            }}
          >
            مسح السجل
          </button>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          {txLoading ? (
            <div className="p-8 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <p className="p-8 text-center text-gray-500 dark:text-gray-400">
              لا توجد حركات. استخدم "رصيد افتتاحي" أو "تعديل" لإضافة حركات.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {transactions.map((tx) => {
                const isIn =
                  tx.type === 'initial' ||
                  tx.type === 'customer_payment_in' ||
                  tx.type === 'adjustment_in'
                const canDelete = !tx.reference_type // لا نحذف الحركات المرتبطة بدفعات
                return (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/30"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${
                          isIn
                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-600'
                        }`}
                      >
                        {isIn ? (
                          <ArrowDownLeft className="w-4 h-4" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">
                          {typeLabels[tx.type] ?? tx.type}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {formatDateTime(tx.created_at)}
                          {tx.notes && ` — ${tx.notes}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`font-bold ${
                          isIn
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {isIn ? '+' : '-'}
                        {formatCurrency(tx.amount)}
                      </span>
                      {canDelete && (
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-500"
                          title="حذف هذه الحركة من سجل الخزنه"
                          onClick={() => {
                            if (
                              window.confirm(
                                'هل أنت متأكد من حذف هذه الحركة من سجل الخزنه؟ سيتم تعديل الرصيد تلقائياً.'
                              )
                            ) {
                              deleteTxMutation.mutate(tx.id)
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
