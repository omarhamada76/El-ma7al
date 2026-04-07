import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSupplier } from '@/api/suppliers'
import { getWarehouses } from '@/api/warehouses'

export default function SupplierPurchaseNew() {
  const { id } = useParams<{ id: string }>()
  const { data: supplier } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => getSupplier(id!),
    enabled: !!id,
  })
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses,
  })

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      <h1 className="text-2xl font-bold">فاتورة شراء من مورد</h1>
      <p className="text-gray-500 dark:text-gray-400">
        المورد: {supplier?.name ?? '—'}
      </p>
      <div className="p-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          اختر المخزن ({warehouses.map((w) => w.name_ar).join(' / ') || 'اجهور / شبرا'})، أضف الأصناف (منتج، كمية، سعر وحدة)، ثم احفظ. سيتم زيادة مخزون المنتجات في المخزن المختار وزيادة رصيد المورد.
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          النموذج الكامل يتطلب ربطاً بالـ API (POST /supplier-purchases).
        </p>
      </div>
    </div>
  )
}
