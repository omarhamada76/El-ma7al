import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, CreditCard, Pencil, Trash2 } from 'lucide-react'
import { getSupplier, getSupplierBalance, getSupplierPurchasesWithItems, getSupplierPayments, updateSupplier, deleteSupplier } from '@/api/suppliers'
import { formatCurrency, formatDate } from '@/lib/utils'
import AddSupplierModal from '@/components/AddSupplierModal'

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => getSupplier(id!),
    enabled: !!id,
  })
  const { data: balanceData } = useQuery({
    queryKey: ['supplier', id, 'balance'],
    queryFn: () => getSupplierBalance(id!),
    enabled: !!id,
  })
  const { data: purchasesData } = useQuery({
    queryKey: ['supplier', id, 'purchases-with-items'],
    queryFn: () => getSupplierPurchasesWithItems(id!, { limit: 10 }),
    enabled: !!id,
  })
  const { data: paymentsData } = useQuery({
    queryKey: ['supplier', id, 'payments'],
    queryFn: () => getSupplierPayments(id!, { limit: 10 }),
    enabled: !!id,
  })

  const balance = balanceData?.balance ?? 0
  const purchases = purchasesData?.data ?? []
  const payments = paymentsData?.data ?? []

  const updateSupplierMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateSupplier>[1]) => updateSupplier(id!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', id] })
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setEditOpen(false)
    },
  })
  const deleteSupplierMutation = useMutation({
    mutationFn: () => deleteSupplier(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      queryClient.invalidateQueries({ queryKey: ['supplier'] })
      navigate('/suppliers')
    },
  })
  const handleDeleteSupplier = () => {
    if (window.confirm('هل أنت متأكد من حذف هذا المورد؟')) deleteSupplierMutation.mutate()
  }

  if (!id) return null
  if (isLoading || !supplier)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    )

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold truncate">{supplier.name}</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/suppliers/${id}/purchases/new`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
          >
            <Plus className="w-4 h-4" />
            فاتورة شراء
          </Link>
          <Link
            to="/supplier-payments/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
          >
            <CreditCard className="w-4 h-4" />
            سداد لمورد
          </Link>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
          >
            <Pencil className="w-4 h-4" />
            تعديل
          </button>
          <button
            type="button"
            onClick={handleDeleteSupplier}
            disabled={deleteSupplierMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            حذف
          </button>
        </div>
      </div>
      <AddSupplierModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initialValues={{
          name: supplier.name,
          phone: supplier.phone ?? '',
          email: supplier.email ?? '',
          address: supplier.address ?? '',
          notes: supplier.notes ?? '',
        }}
        onSubmit={async (data) => {
          await updateSupplierMutation.mutateAsync({
            name: data.name,
            phone: data.phone || null,
            email: data.email || null,
            address: data.address || null,
            notes: data.notes || null,
          })
        }}
      />

      <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
        <p className="text-sm text-gray-600 dark:text-gray-400">ما نستحق له (رصيد المورد)</p>
        <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
          {formatCurrency(balance)}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold mb-3">آخر فواتير الشراء</h2>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            {purchases.length === 0 ? (
              <p className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                لا توجد فواتير شراء
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {purchases.map((p) => (
                  <li key={p.id} className="p-4">
                    <div className="flex justify-between text-sm mb-2">
                      <span>{formatDate(p.created_at)}</span>
                      <span className="font-medium">{formatCurrency(p.total_amount)}</span>
                    </div>
                    {p.items?.length ? (
                      <ul className="mr-4 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                        {p.items.map((item) => (
                          <li key={item.id}>
                            {item.product_name || 'منتج'}: <strong>{item.quantity}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-semibold mb-3">آخر المدفوعات (السدادات)</h2>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            {payments.length === 0 ? (
              <p className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                لا توجد مدفوعات
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {payments.map((p) => (
                  <li key={p.id} className="flex justify-between p-4 text-sm">
                    <span>{formatDate(p.payment_date)}</span>
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      -{formatCurrency(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
