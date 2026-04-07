import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, ArrowLeft } from 'lucide-react'
import { getSuppliers, createSupplier } from '@/api/suppliers'
import { formatCurrency } from '@/lib/utils'
import AddSupplierModal from '@/components/AddSupplierModal'

export default function Suppliers() {
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const queryClient = useQueryClient()
  const createMutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => getSuppliers({ search: search || undefined, limit: 50 }),
  })

  const suppliers = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold">الموردون</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
        >
          <Plus className="w-4 h-4" />
          إضافة مورد
        </button>
        <AddSupplierModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onSubmit={async (d) => {
            await createMutation.mutateAsync({
              name: d.name,
              phone: d.phone || null,
              email: d.email || null,
              address: d.address || null,
              notes: d.notes || null,
            })
          }}
        />
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالاسم..."
          className="w-full py-2 ps-12 pe-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
        />
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
        ) : suppliers.length === 0 ? (
          <p className="p-8 text-center text-gray-500 dark:text-gray-400">
            لا يوجد موردون. أضف مورداً جديداً.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {suppliers.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/suppliers/${s.id}`}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div>
                    <p className="font-medium">{s.name}</p>
                    {s.phone && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {s.phone}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">ما نستحق له: {formatCurrency(s.balance ?? 0)}</span>
                    <ArrowLeft className="w-4 h-4 text-gray-400" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {total > 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          إجمالي: {total} مورد
        </p>
      )}
    </div>
  )
}
