import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  Pin,
  Star,
  Phone,
  ArrowLeft,
  Pencil,
  Trash2,
  FileSpreadsheet,
  MoreVertical,
} from 'lucide-react'
import { getClients, createClient, updateClient, deleteClient, togglePin } from '@/api/clients'
import type { Client } from '@/types/api'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import AddClientModal from '@/components/AddClientModal'
import ContextMenu from '@/components/ContextMenu'
import { useAuthStore } from '@/stores/auth'
import { canViewFinancials } from '@/lib/roles'

export default function Clients() {
  const navigate = useNavigate()
  const showFinancials = canViewFinancials(useAuthStore((s) => s.user?.role))
  const [search, setSearch] = useState('')
  const [sortByDebt, setSortByDebt] = useState(false)
  const [pinnedFilter, setPinnedFilter] = useState<boolean | undefined>(undefined)
  const [addOpen, setAddOpen] = useState(false)
  const [editClient, setEditClient] = useState<Client | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; client: Client } | null>(null)
  const [actionsMenu, setActionsMenu] = useState<{ x: number; y: number; client: Client } | null>(null)
  const queryClient = useQueryClient()
  const createMutation = useMutation({
    mutationFn: createClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateClient>[1] }) => updateClient(String(id), body),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      queryClient.invalidateQueries({ queryKey: ['client', String(id)] })
      setEditClient(null)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteClient(String(id)),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      queryClient.invalidateQueries({ queryKey: ['client', String(id)] })
      setContextMenu(null)
      setActionsMenu(null)
    },
  })
  const pinMutation = useMutation({
    mutationFn: (id: number) => togglePin(String(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setContextMenu(null)
      setActionsMenu(null)
    },
  })
  const { data, isLoading } = useQuery({
    queryKey: ['clients', search, pinnedFilter, sortByDebt],
    queryFn: () =>
      getClients({
        search: search || undefined,
        pinned: pinnedFilter,
        limit: 50,
        sort: sortByDebt ? 'debt_desc' : undefined,
      }),
  })

  const clients = data?.data ?? []
  const total = data?.total ?? 0
  const debtAlertThreshold = data?.debt_alert_threshold_egp ?? 5000

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">العملاء</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
        >
          <Plus className="w-4 h-4" />
          إضافة عميل
        </button>
        <AddClientModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onSubmit={async (d) => {
            await createMutation.mutateAsync({
              name: d.name,
              phone: d.phone || null,
              location: d.location || null,
              initial_debt: d.initial_debt,
            })
          }}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الهاتف..."
            className={cn(
              'w-full py-2 ps-12 pe-4 rounded-lg border bg-white dark:bg-gray-800',
              'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
            )}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPinnedFilter(undefined)}
            className={cn(
              'px-3 py-2 rounded-lg text-sm font-medium',
              pinnedFilter === undefined
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            )}
          >
            الكل
          </button>
          <button
            type="button"
            onClick={() => setPinnedFilter(true)}
            className={cn(
              'px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1',
              pinnedFilter === true
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            )}
          >
            <Pin className="w-4 h-4" /> المثبتون
          </button>
          {showFinancials && (
            <button
              type="button"
              onClick={() => setSortByDebt((v) => !v)}
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium',
                sortByDebt
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              )}
            >
              الأعلى ديناً
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-14 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
              />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <p className="p-8 text-center text-gray-500 dark:text-gray-400">
            لا يوجد عملاء. أضف عميلاً جديداً.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {clients.map((c) => (
              <li key={c.id}>
                <div
                  className="flex flex-wrap items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  onClick={(e) => {
                    const el = e.target as HTMLElement
                    if (el.closest('a, button')) return
                    navigate(`/clients/${c.id}`)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setActionsMenu(null)
                    setContextMenu({ x: e.clientX, y: e.clientY, client: c })
                  }}
                >
                  {/* أول عنصر في RTL يظهر يميناً — قائمة الإجراءات */}
                  <button
                    type="button"
                    aria-label="إجراءات العميل"
                    aria-haspopup="menu"
                    aria-expanded={actionsMenu?.client.id === c.id}
                    className={cn(
                      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white',
                      'text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
                      actionsMenu?.client.id === c.id && 'bg-gray-100 dark:bg-gray-700'
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (actionsMenu?.client.id === c.id) {
                        setActionsMenu(null)
                        return
                      }
                      setContextMenu(null)
                      const rect = e.currentTarget.getBoundingClientRect()
                      const menuW = 190
                      const left = Math.min(
                        Math.max(8, rect.right - menuW),
                        window.innerWidth - menuW - 8
                      )
                      setActionsMenu({
                        x: left,
                        y: rect.bottom + 6,
                        client: c,
                      })
                    }}
                  >
                    <MoreVertical className="h-5 w-5" aria-hidden />
                  </button>

                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex gap-1">
                      {c.pinned && (
                        <Pin className="w-4 h-4 text-amber-500 fill-amber-500" />
                      )}
                      {c.favorite && (
                        <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">{c.name}</p>
                      {c.phone && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <Phone className="w-3 h-3 shrink-0" />
                          {c.phone}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {showFinancials && (
                      <>
                        <span className="text-sm font-medium tabular-nums">
                          {formatCurrency(c.balance ?? c.initial_debt)}
                        </span>
                        {(c.balance ?? 0) > 0 && (
                          <span
                            className={cn(
                              'text-xs px-2 py-0.5 rounded-full font-medium shrink-0',
                              (c.balance ?? 0) >= debtAlertThreshold
                                ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200'
                                : 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                            )}
                          >
                            دين
                          </span>
                        )}
                      </>
                    )}
                    <ArrowLeft className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <ContextMenu
          open={!!contextMenu}
          x={contextMenu?.x ?? 0}
          y={contextMenu?.y ?? 0}
          onClose={() => setContextMenu(null)}
          items={
            contextMenu
              ? [
                  {
                    label: contextMenu.client.pinned ? 'إلغاء التثبيت' : 'تثبيت',
                    icon: <Pin className="w-4 h-4" />,
                    onClick: () => pinMutation.mutate(contextMenu.client.id),
                  },
                  ...(showFinancials
                    ? [
                        {
                          label: 'كشف الحساب',
                          icon: <FileSpreadsheet className="w-4 h-4" />,
                          onClick: () =>
                            navigate(`/clients/${contextMenu.client.id}/account-statement`),
                        },
                      ]
                    : []),
                  {
                    label: 'تعديل',
                    icon: <Pencil className="w-4 h-4" />,
                    onClick: () => setEditClient(contextMenu.client),
                  },
                  {
                    label: 'حذف',
                    icon: <Trash2 className="w-4 h-4" />,
                    danger: true,
                    onClick: () => {
                      if (window.confirm('هل أنت متأكد من حذف هذا العميل؟')) {
                        deleteMutation.mutate(contextMenu.client.id)
                      }
                    },
                  },
                ]
              : []
          }
        />
        <ContextMenu
          open={!!actionsMenu}
          x={actionsMenu?.x ?? 0}
          y={actionsMenu?.y ?? 0}
          onClose={() => setActionsMenu(null)}
          items={
            actionsMenu
              ? [
                  ...(showFinancials
                    ? [
                        {
                          label: 'كشف الحساب',
                          icon: <FileSpreadsheet className="w-4 h-4" />,
                          onClick: () =>
                            navigate(`/clients/${actionsMenu.client.id}/account-statement`),
                        },
                      ]
                    : []),
                  {
                    label: 'تعديل',
                    icon: <Pencil className="w-4 h-4" />,
                    onClick: () => setEditClient(actionsMenu.client),
                  },
                  {
                    label: 'حذف',
                    icon: <Trash2 className="w-4 h-4" />,
                    danger: true,
                    onClick: () => {
                      if (window.confirm('هل أنت متأكد من حذف هذا العميل؟')) {
                        deleteMutation.mutate(actionsMenu.client.id)
                      }
                    },
                  },
                ]
              : []
          }
        />
        <AddClientModal
          open={!!editClient}
          onClose={() => setEditClient(null)}
          hideInitialDebt={!showFinancials}
          initialValues={
            editClient
              ? {
                  name: editClient.name,
                  phone: editClient.phone ?? '',
                  location: editClient.location ?? '',
                  initial_debt: editClient.initial_debt,
                }
              : undefined
          }
          onSubmit={async (data) => {
            if (!editClient) return
            await updateMutation.mutateAsync({
              id: editClient.id,
              body: {
                name: data.name,
                phone: data.phone || null,
                location: data.location || null,
                ...(showFinancials ? { initial_debt: data.initial_debt } : {}),
              },
            })
          }}
        />
      </div>
      {total > 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          إجمالي: {total} عميل
        </p>
      )}
    </div>
  )
}
