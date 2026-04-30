import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Package, ChevronDown, ChevronUp, ArrowRightLeft } from 'lucide-react'
import { getInventoryTransfers, type InventoryTransfer } from '@/api/inventoryTransfers'
import { cn } from '@/lib/utils'
import { Link } from 'react-router-dom'

export default function TransferHistory() {
  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ['inventory-transfers'],
    queryFn: () => getInventoryTransfers(100),
  })

  const [expandedId, setExpandedId] = useState<number | null>(null)

  const toggle = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      return d.toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  return (
    <div className="space-y-6 w-full" dir="rtl">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          to="/transfer-to-shobra"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          تحويل بضاعه
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold">سجل التحويلات</h1>
      </div>

      {/* ─── Loading ─── */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
        </div>
      )}

      {/* ─── Empty ─── */}
      {!isLoading && transfers.length === 0 && (
        <div className="text-center py-16 text-gray-400 space-y-3">
          <ArrowRightLeft className="w-12 h-12 mx-auto text-gray-300" />
          <p className="text-lg">لا توجد تحويلات حتى الآن</p>
        </div>
      )}

      {/* ─── Transfer list ─── */}
      {!isLoading && transfers.length > 0 && (
        <div className="space-y-3">
          {transfers.map((transfer) => (
            <TransferCard
              key={transfer.id}
              transfer={transfer}
              isExpanded={expandedId === transfer.id}
              onToggle={() => toggle(transfer.id)}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TransferCard({
  transfer,
  isExpanded,
  onToggle,
  formatDate,
}: {
  transfer: InventoryTransfer
  isExpanded: boolean
  onToggle: () => void
  formatDate: (d: string) => string
}) {
  const itemCount = transfer.items?.length ?? 0
  const totalQty = transfer.items?.reduce((s, i) => s + Number(i.quantity), 0) ?? 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition-shadow hover:shadow-md">
      {/* ─── Summary row ─── */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 sm:px-6 py-4 text-right gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
            <ArrowRightLeft className="w-5 h-5 text-blue-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap text-sm font-semibold text-gray-800">
              <span>{transfer.from_warehouse_name ?? 'مصدر'}</span>
              <span className="text-gray-400">←</span>
              <span>{transfer.to_warehouse_name ?? 'هدف'}</span>
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{formatDate(transfer.created_at)}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-left hidden sm:block">
            <span className="text-xs text-gray-400">
              {itemCount} {itemCount === 1 ? 'صنف' : 'أصناف'} &middot; {totalQty} وحدة
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* ─── Expanded items ─── */}
      {isExpanded && (
        <div className="border-t border-gray-100">
          {transfer.notes && (
            <div className="px-4 sm:px-6 py-2 bg-amber-50 text-amber-800 text-sm">
              <span className="font-medium">ملاحظات: </span>
              {transfer.notes}
            </div>
          )}

          {/* Desktop table */}
          <div className="hidden sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="text-right px-6 py-2 font-medium">المنتج</th>
                  <th className="text-center px-4 py-2 font-medium">الكمية</th>
                </tr>
              </thead>
              <tbody>
                {transfer.items?.map((item, idx) => (
                  <tr
                    key={idx}
                    className={cn(
                      'border-t border-gray-50',
                      idx % 2 === 1 && 'bg-gray-50/50'
                    )}
                  >
                    <td className="px-6 py-2.5 text-gray-800 flex items-center gap-2">
                      <Package className="w-4 h-4 text-gray-300 flex-shrink-0" />
                      {item.product_name}
                    </td>
                    <td className="px-4 py-2.5 text-center font-medium text-gray-700">
                      {item.quantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-gray-100">
            {transfer.items?.map((item, idx) => (
              <div key={idx} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-800">
                  <Package className="w-4 h-4 text-gray-300" />
                  <span>{item.product_name}</span>
                </div>
                <span className="text-sm font-medium text-gray-600">{item.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
