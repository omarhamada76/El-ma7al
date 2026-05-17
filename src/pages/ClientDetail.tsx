import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, Phone, MessageCircle, Plus, ArrowRight, Pencil, Trash2, Search } from 'lucide-react'
import { getClient, getClientBarns, getClientBalance, updateClient, deleteClient } from '@/api/clients'
import { createBarn, updateBarn } from '@/api/barns'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import AddBarnModal from '@/components/AddBarnModal'
import AddClientModal from '@/components/AddClientModal'
import { useAuthStore } from '@/stores/auth'
import { canViewFinancials } from '@/lib/roles'

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const role = useAuthStore((s) => s.user?.role)
  const showFinancials = canViewFinancials(role)
  const [editOpen, setEditOpen] = useState(false)
  const createBarnMutation = useMutation({
    mutationFn: ({ name, initial_debt }: { name: string; initial_debt: number }) =>
      createBarn(id!, { name, initial_debt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id, 'barns'] })
    },
  })
  const [addBarnOpen, setAddBarnOpen] = useState(false)
  const [editBarn, setEditBarn] = useState<{ id: number; name: string; initial_debt: number } | null>(null)
  const [barnSearch, setBarnSearch] = useState('')
  
  const updateBarnMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { name: string; initial_debt: number } }) =>
      updateBarn(String(id), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id, 'barns'] })
      queryClient.invalidateQueries({ queryKey: ['client', id, 'balance'] }) // Aggregation might change
    },
  })
  const updateClientMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateClient>[1]) => updateClient(id!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setEditOpen(false)
    },
  })
  const deleteClientMutation = useMutation({
    mutationFn: () => deleteClient(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      navigate('/clients')
    },
  })
  const handleDeleteClient = () => {
    if (window.confirm('هل أنت متأكد من حذف هذا العميل؟')) deleteClientMutation.mutate()
  }
  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => getClient(id!),
    enabled: !!id,
  })
  const { data: barns = [] } = useQuery({
    queryKey: ['client', id, 'barns'],
    queryFn: () => getClientBarns(id!),
    enabled: !!id,
  })
  const { data: balanceData } = useQuery({
    queryKey: ['client', id, 'balance'],
    queryFn: () => getClientBalance(id!),
    enabled: !!id && showFinancials,
  })
  
  const filteredBarns = barns.filter((barn) =>
    barn.name.toLowerCase().includes(barnSearch.toLowerCase())
  )

  const stats = balanceData ?? {
    total_account: client?.initial_debt ?? 0,
    total_paid: 0,
    balance: client?.initial_debt ?? 0,
  }

  if (!id) return null
  if (isLoading || !client)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    )

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold truncate">{client.name}</h1>
          {client.phone && (
            <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2 mt-1">
              <Phone className="w-4 h-4 shrink-0" />
              <a href={`tel:${client.phone}`} className="hover:underline">
                {client.phone}
              </a>
              <a
                href={`sms:${client.phone}`}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="رسالة"
              >
                <MessageCircle className="w-4 h-4" />
              </a>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {showFinancials && (
            <Link
              to={`/clients/${id}/account-statement`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
            >
              <FileSpreadsheet className="w-4 h-4" />
              كشف الحساب
            </Link>
          )}
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
            onClick={handleDeleteClient}
            disabled={deleteClientMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            حذف
          </button>
        </div>
      </div>
      <AddClientModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        hideInitialDebt={!showFinancials}
        initialValues={{
          name: client.name,
          phone: client.phone ?? '',
          location: client.location ?? '',
          initial_debt: client.initial_debt,
        }}
        onSubmit={async (data) => {
          await updateClientMutation.mutateAsync({
            name: data.name,
            phone: data.phone || null,
            location: data.location || null,
            ...(showFinancials ? { initial_debt: data.initial_debt } : {}),
          })
        }}
      />

      {showFinancials && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">حساب العميل (إجمالي المسحوبات)</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(stats.total_account)}</p>
          </div>
          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">إجمالي السداد</p>
            <p className="text-2xl font-bold mt-1 text-blue-600 dark:text-blue-400">{formatCurrency(stats.total_paid)}</p>
          </div>
          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 relative group">
            <p className="text-sm text-gray-500 dark:text-gray-400">المديونية (المبلغ المتبقي)</p>
            <p className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">{formatCurrency(stats.balance)}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              <Link
                to={`/payments/new?client_id=${encodeURIComponent(id ?? '')}`}
                className="inline-flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:underline"
              >
                <Plus className="w-4 h-4" /> تسجيل سداد
              </Link>
              <Link
                to={`/payments/new?client_id=${encodeURIComponent(id ?? '')}&method=discount`}
                className="inline-flex items-center gap-1 text-sm text-amber-600 dark:text-amber-500 hover:underline"
              >
                <Plus className="w-4 h-4" /> تسجيل خصم
              </Link>
            </div>
          </div>
          <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">إجمالي الربح من العميل</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
              {formatCurrency(client.total_profit)}
            </p>
          </div>
        </div>
      )}
      {!showFinancials && (
        <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <Link
            to={`/payments/new?client_id=${encodeURIComponent(id ?? '')}`}
            className="inline-flex items-center gap-2 text-primary-600 dark:text-primary-400 font-medium hover:underline"
          >
            <Plus className="w-4 h-4" /> تسجيل سداد عميل
          </Link>
        </div>
      )}

      <div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3 bg-gray-50/50 dark:bg-gray-800/30 p-3 rounded-xl border border-gray-100 dark:border-gray-700/50">
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200 shrink-0">العنابر</h2>
            <div className="relative flex-1 sm:w-64 group">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
              <input
                type="text"
                value={barnSearch}
                onChange={(e) => setBarnSearch(e.target.value)}
                placeholder="بحث باسم العنبر..."
                className="w-full pl-3 pr-9 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all outline-none"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAddBarnOpen(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-bold shadow-sm transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            إضافة عنبر جديد
          </button>
        </div>
        <AddBarnModal
          open={addBarnOpen || !!editBarn}
          onClose={() => {
            setAddBarnOpen(false)
            setEditBarn(null)
          }}
          initialValues={editBarn}
          hideInitialDebt={!showFinancials}
          onSubmit={async (d) => {
            if (editBarn) {
              await updateBarnMutation.mutateAsync({ id: editBarn.id, body: d })
              setEditBarn(null)
            } else {
              await createBarnMutation.mutateAsync({ name: d.name, initial_debt: d.initial_debt })
              setAddBarnOpen(false)
            }
          }}
        />
        {barns.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 p-8 text-center rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/30 dark:bg-gray-800/20">
            لا توجد عنابر مسجلة لهذا العميل.
          </p>
        ) : filteredBarns.length === 0 ? (
          <div className="text-center p-12 bg-gray-50 dark:bg-gray-800/40 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700">
            <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">لا توجد نتائج تطابق "{barnSearch}"</p>
            <button 
              onClick={() => setBarnSearch('')}
              className="mt-3 text-sm text-primary-600 hover:underline font-bold"
            >
              مسح البحث
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBarns.map((barn) => (
              <li key={barn.id} className="relative group">
                <Link
                  to={`/barns/${barn.id}`}
                  className={cn(
                    'block p-4 rounded-xl border border-gray-200 dark:border-gray-700',
                    'bg-white dark:bg-gray-800 hover:border-primary-500 transition-colors h-full'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{barn.name}</span>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    إجمالي الفواتير: {barn.total_invoices}
                    {showFinancials && (
                      <>
                        <span className="block mt-1 text-emerald-600 dark:text-emerald-400 text-xs text-left">
                          الربح: {formatCurrency(barn.total_profit)}
                        </span>
                        <span className="block mt-0.5 space-x-2 space-x-reverse text-[10px] leading-tight opacity-80 text-left">
                          <span className="text-gray-600 dark:text-gray-300">الحساب: {formatCurrency(barn.total_account)}</span>
                          <span>•</span>
                          <span className="text-blue-600 dark:text-blue-400">السداد: {formatCurrency(barn.total_paid)}</span>
                          <span>•</span>
                          <span className="text-red-600 dark:text-red-400">المديونية: {formatCurrency(barn.balance)}</span>
                        </span>
                      </>
                    )}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setEditBarn({
                      id: barn.id,
                      name: barn.name,
                      initial_debt: barn.initial_debt ?? 0,
                    })
                  }}
                  className="absolute left-3 top-10 p-2 rounded-lg bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:text-primary-600"
                  title="تعديل العنبر"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
