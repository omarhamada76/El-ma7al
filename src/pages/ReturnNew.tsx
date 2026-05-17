import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, UserPlus, ArrowRight, RotateCcw, AlertCircle, CheckCircle2, Package } from 'lucide-react'
import { getClients, getClientBarns, createClient } from '@/api/clients'
import { getInvoices, returnPartialInvoiceItem } from '@/api/invoices'
import { getProducts } from '@/api/products'
import AddClientModal from '@/components/AddClientModal'
import FeedbackBanner from '@/components/FeedbackBanner'
import SuccessOverlay from '@/components/SuccessOverlay'
import { cn, formatCurrency, formatDate, normalizeSearchText } from '@/lib/utils'

interface ReturnState {
  [itemId: number]: {
    quantity: number
    notes: string
  }
}

export default function ReturnNew() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  
  // Selection state
  const [clientId, setClientId] = useState('')
  const [barnId, setBarnId] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [clientListOpen, setClientListOpen] = useState(false)
  const [addClientOpen, setAddClientOpen] = useState(false)
  
  // Return processing state
  const [returns, setReturns] = useState<ReturnState>({})
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState<null | { count: number }>(null)
  const [invoiceSearch, setInvoiceSearch] = useState('')
  
  const clientPickerRef = useRef<HTMLDivElement>(null)
  const clientSearchInputRef = useRef<HTMLInputElement>(null)

  // Fetch clients
  const { data: clientsData } = useQuery({
    queryKey: ['clients', 'list'],
    queryFn: () => getClients({ limit: 500 }),
  })
  const clients = clientsData?.data ?? []

  // Filter clients for search
  const filteredClients = useMemo(() => {
    const q = normalizeSearchText(clientSearch)
    if (!q) return clients.slice(0, 50)
    const digits = q.replace(/\D/g, '')
    return clients.filter((c) => {
      const nameMatch = normalizeSearchText(c.name).includes(q)
      const phoneDigits = (c.phone ?? '').replace(/\D/g, '')
      const phoneMatch = digits.length > 0 && phoneDigits.includes(digits)
      return nameMatch || phoneMatch
    }).slice(0, 50)
  }, [clients, clientSearch])

  // Fetch barns for selected client
  const { data: barns = [] } = useQuery({
    queryKey: ['client', clientId, 'barns'],
    queryFn: () => getClientBarns(clientId),
    enabled: !!clientId,
  })

  // Fetch products for images
  const { data: productsData } = useQuery({
    queryKey: ['products', 'list', 'minimal'],
    queryFn: () => getProducts({ limit: 1000 }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
  
  const productsMap = useMemo(() => {
    const map = new Map<number, string | null>()
    productsData?.data.forEach(p => map.set(p.id, p.image_url))
    return map
  }, [productsData])

  // Fetch invoices for selected client/barn
  const { data: invoicesData, isLoading: loadingInvoices } = useQuery({
    queryKey: ['invoices', 'returns', clientId, barnId, invoiceSearch],
    queryFn: () => {
      const params: any = { 
        client_id: clientId ? Number(clientId) : undefined, 
        barn_id: barnId ? Number(barnId) : undefined,
        limit: 100
      }
      if (invoiceSearch.trim() && /^\d+$/.test(invoiceSearch.trim())) {
        params.id = Number(invoiceSearch.trim())
      }
      return getInvoices(params)
    },
    enabled: !!clientId || (!!invoiceSearch && /^\d+$/.test(invoiceSearch.trim())),
  })
  
  // Extract all items from all invoices for easier display
  const allInvoices = invoicesData?.data ?? []

  // Filter invoices by search ID
  const filteredInvoices = useMemo(() => {
    const q = normalizeSearchText(invoiceSearch)
    if (!q) return allInvoices
    return allInvoices.filter(inv => normalizeSearchText(String(inv.id)).includes(q))
  }, [allInvoices, invoiceSearch])

  const totalRefund = useMemo(() => {
    return Object.entries(returns).reduce((sum, [itemId, data]) => {
      if (data.quantity <= 0) return sum
      let itemPrice = 0
      for (const inv of allInvoices) {
        const it = inv.items?.find(i => i.id === Number(itemId))
        if (it) {
          itemPrice = it.unit_price
          break
        }
      }
      return sum + (itemPrice * data.quantity)
    }, 0)
  }, [returns, allInvoices])
  
  // Handle click outside client picker
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (clientPickerRef.current && !clientPickerRef.current.contains(e.target as Node)) {
        setClientListOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Mutations
  const createClientMutation = useMutation({
    mutationFn: createClient,
    onSuccess: (newClient) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setClientId(String(newClient.id))
      setBarnId('')
      setClientSearch('')
      setClientListOpen(false)
      setAddClientOpen(false)
    },
  })

  const returnItemMutation = useMutation({
    mutationFn: (args: { invoiceId: string; itemId: number; returned_quantity: number; notes: string }) =>
      returnPartialInvoiceItem(args.invoiceId, args.itemId, {
        returned_quantity: args.returned_quantity,
        notes: args.notes || null,
      }),
  })

  // Handlers
  const handleSetReturnQty = (itemId: number, qty: number, maxQty: number) => {
    const safeQty = Math.min(maxQty, Math.max(0, qty))
    setReturns(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], quantity: safeQty }
    }))
  }

  const handleSetReturnNotes = (itemId: number, notes: string) => {
    setReturns(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], notes }
    }))
  }

  const handleSubmitReturns = async () => {
    setError('')
    const itemsToReturn = Object.entries(returns)
      .filter(([_, data]) => data.quantity > 0)
      .map(([itemId, data]) => ({
        itemId: Number(itemId),
        ...data
      }))

    if (itemsToReturn.length === 0) {
      setError('يرجى تحديد كمية إرجاع لمنتج واحد على الأقل.')
      return
    }

    setProcessing(true)
    let successCount = 0

    try {
      for (const item of itemsToReturn) {
        // Find the invoice ID for this item
        const invoice = allInvoices.find(inv => inv.items?.some(it => it.id === item.itemId))
        if (!invoice) continue

        await returnItemMutation.mutateAsync({
          invoiceId: String(invoice.id),
          itemId: item.itemId,
          returned_quantity: item.quantity,
          notes: item.notes
        })
        successCount++
      }

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      queryClient.invalidateQueries({ queryKey: ['client', clientId] })
      
      setSuccess({ count: successCount })
      setReturns({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء معالجة المرتجع')
    } finally {
      setProcessing(false)
    }
  }

  const selectedClient = clients.find(c => String(c.id) === clientId)

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto" dir="rtl">
      <SuccessOverlay
        open={!!success}
        title="تم تسجيل المرتجع بنجاح"
        subtitle={`تمت معالجة ${success?.count} صنف/أصناف وإعادتها للمخزون.`}
        durationMs={2500}
        onComplete={() => {
          setSuccess(null)
          navigate('/invoices')
        }}
      />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-primary-600" />
            تسجيل مرتجع مبيعات
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            اختر العميل والعنبر لعرض الفواتير السابقة وتسجيل المنتجات المرتجعة.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Selection Sidebar */}
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm space-y-4">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-primary-500" />
              تحديد العميل
            </h2>
            
            {/* Client Picker */}
            <div className="relative" ref={clientPickerRef}>
              <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">العميل *</label>
              <div className="relative">
                <input
                  ref={clientSearchInputRef}
                  type="text"
                  value={clientListOpen ? clientSearch : selectedClient?.name ?? ''}
                  onChange={(e) => {
                    setClientSearch(e.target.value)
                    setClientListOpen(true)
                  }}
                  onFocus={() => {
                    setClientSearch('')
                    setClientListOpen(true)
                  }}
                  placeholder="ابحث عن اسم العميل أو رقم الهاتف..."
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 py-2.5 ps-10 pe-4 text-sm focus:ring-2 focus:ring-primary-500 transition-all font-medium"
                />
                <Search className="absolute start-3 top-3 w-4 h-4 text-gray-400" />
              </div>

              {clientListOpen && (
                <div className="absolute z-50 top-full inset-x-0 mt-2 max-h-72 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1">
                  <button
                    onClick={() => setAddClientOpen(true)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-sm font-bold text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/30 border-b border-gray-100 dark:border-gray-700"
                  >
                    <UserPlus className="w-4 h-4" />
                    + إضافة عميل جديد
                  </button>
                  {filteredClients.length === 0 ? (
                    <p className="px-4 py-4 text-center text-sm text-gray-500">لا توجد نتائج بحث</p>
                  ) : (
                    filteredClients.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setClientId(String(c.id))
                          setBarnId('')
                          setClientListOpen(false)
                        }}
                        className={cn(
                          "flex w-full flex-col px-4 py-3 text-right hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors",
                          clientId === String(c.id) && "bg-primary-50 dark:bg-primary-950/20"
                        )}
                      >
                        <span className="font-bold text-gray-900 dark:text-gray-100">{c.name}</span>
                        {c.phone && <span className="text-xs text-gray-500">{c.phone}</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Barn Picker */}
            <div className={cn("space-y-1 transition-opacity", !clientId && "opacity-50 pointer-events-none")}>
              <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">العنبر (اختياري)</label>
              <select
                value={barnId}
                onChange={(e) => setBarnId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 py-2.5 px-4 text-sm focus:ring-2 focus:ring-primary-500 transition-all font-medium"
              >
                <option value="">— جميع عنابر العميل —</option>
                {barns.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {selectedClient && (
              <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                <Link 
                  to={`/clients/${selectedClient.id}`}
                  className="text-xs text-primary-600 hover:underline flex items-center gap-1"
                >
                  <ArrowRight className="w-3 h-3 rotate-180" />
                  عرض ملف العميل وكشف الحساب
                </Link>
              </div>
            )}
          </div>

          {Object.values(returns).some(v => v.quantity > 0) && (
            <div className="bg-primary-50 dark:bg-primary-950/20 p-5 rounded-2xl border border-primary-100 dark:border-primary-900/30 animate-in zoom-in-95 duration-200">
              <h3 className="font-bold text-primary-900 dark:text-primary-100 mb-3">ملخص المرتجع</h3>
              <div className="space-y-2 text-sm text-primary-800 dark:text-primary-200">
                <div className="flex justify-between">
                  <span>عدد الأصناف:</span>
                  <span className="font-bold">{Object.values(returns).filter(v => v.quantity > 0).length}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-primary-200 dark:border-primary-800">
                  <span>إجمالي القيمة:</span>
                  <span className="font-bold text-lg">{formatCurrency(totalRefund)}</span>
                </div>
              </div>
              <button
                onClick={handleSubmitReturns}
                disabled={processing}
                className="w-full mt-4 bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-primary-500/20 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {processing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    جاري المعالجة...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    تأكيد وإتمام المرتجع
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Invoices List */}
        <div className="md:col-span-2">
          {error && <FeedbackBanner type="error" message={error} className="mb-6" />}

          {!clientId && !invoiceSearch ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-12 text-center">
              <div className="w-16 h-16 bg-gray-50 dark:bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-gray-300" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">بانتظار تحديد العميل أو الفاتورة</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-xs mx-auto mb-6">
                يرجى اختيار العميل من القائمة الجانبية، أو البحث مباشرة برقم الفاتورة أدناه.
              </p>
              <div className="max-w-xs mx-auto relative">
                <input
                  type="text"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  placeholder="أدخل رقم الفاتورة..."
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 py-3 ps-10 pe-4 text-sm focus:ring-2 focus:ring-primary-500 transition-all font-bold"
                />
                <Search className="absolute start-3 top-3.5 w-4 h-4 text-gray-400" />
              </div>
            </div>
          ) : loadingInvoices ? (
            <div className="space-y-4 animate-pulse">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-32 bg-gray-100 dark:bg-gray-800 rounded-2xl" />
              ))}
            </div>
          ) : allInvoices.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-12 text-center shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">لا توجد فواتير</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                لا توجد فواتير نشطة مسجلة للعميل {selectedClient?.name} (رقم {clientId}) {barnId ? "في هذا العنبر " : ""}حالياً.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-4 bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
                <div className="relative flex-1 max-w-sm">
                  <input
                    type="text"
                    value={invoiceSearch}
                    onChange={(e) => setInvoiceSearch(e.target.value)}
                    placeholder="بحث برقم الفاتورة..."
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 py-2 ps-10 pe-4 text-sm focus:ring-2 focus:ring-primary-500 transition-all"
                  />
                  <Search className="absolute start-3 top-2.5 w-4 h-4 text-gray-400" />
                </div>
                <div className="text-xs text-gray-400">
                  عرض {filteredInvoices.length} من {allInvoices.length} فاتورة
                </div>
              </div>

              {filteredInvoices.map((invoice) => (
                <div 
                  key={invoice.id} 
                  className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden"
                >
                  {/* Invoice Header */}
                  <div className="bg-gray-50/80 dark:bg-gray-900/50 px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap justify-between items-center gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center border border-primary-100 dark:border-primary-800">
                        <RotateCcw className="w-5 h-5 text-primary-600" />
                      </div>
                      <div>
                        <span className="text-[10px] font-black text-primary-600/70 dark:text-primary-400/70 uppercase tracking-wider block">فاتورة رقم</span>
                        <h4 className="font-black text-gray-900 dark:text-gray-100 text-lg leading-none">#{invoice.id}</h4>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-6 items-center">
                      <div className="px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
                        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase block tracking-wider mb-0.5">المخزن</span>
                        <span className="text-xs font-black text-gray-700 dark:text-gray-300">{invoice.warehouse_name_ar || '—'}</span>
                      </div>
                      
                      <div className="px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
                        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase block tracking-wider mb-0.5">التاريخ</span>
                        <span className="text-xs font-black text-gray-700 dark:text-gray-300">{formatDate(invoice.created_at)}</span>
                      </div>
                      
                      <div className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 shadow-sm">
                        <span className="text-[10px] font-bold text-emerald-600/70 dark:text-emerald-400/70 uppercase block tracking-wider mb-0.5">الإجمالي</span>
                        <span className="text-xs font-black text-emerald-700 dark:text-emerald-300">{formatCurrency(invoice.total_amount)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Items List */}
                  <div className="p-0 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50/30 dark:bg-gray-900/10 text-gray-500 dark:text-gray-400 text-xs uppercase">
                          <th className="px-5 py-3 text-right font-bold">المنتج</th>
                          <th className="px-5 py-3 text-right font-bold w-24">الكمية المباعة</th>
                          <th className="px-5 py-3 text-right font-bold w-32">كمية المرتجع</th>
                          <th className="px-5 py-3 text-right font-bold">ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {invoice.items?.map((item) => (
                          <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors">
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                {productsMap.get(item.product_id || 0) ? (
                                  <img
                                    src={productsMap.get(item.product_id || 0)!}
                                    alt=""
                                    className="h-10 w-10 shrink-0 rounded object-cover border border-gray-200 dark:border-gray-700 bg-white"
                                  />
                                ) : (
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400">
                                    <Package className="h-5 w-5" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="font-bold text-gray-900 dark:text-gray-100 truncate" title={item.product_name}>
                                    {item.product_name}
                                  </p>
                                  {item.batch_expiry_date && (
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500">صلاحية: {item.batch_expiry_date}</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-4 tabular-nums font-medium text-gray-600 dark:text-gray-400">
                              {item.quantity} {item.product_unit_type === 'bulk' ? 'كجم' : 'وحدة'}
                            </td>
                            <td className="px-5 py-4">
                              <div className="relative">
                                <input
                                  type="number"
                                  min={0}
                                  max={item.quantity}
                                  step={item.product_unit_type === 'bulk' ? 0.001 : 1}
                                  value={returns[item.id]?.quantity ?? ''}
                                  onChange={(e) => handleSetReturnQty(item.id, parseFloat(e.target.value) || 0, item.quantity)}
                                  placeholder="0"
                                  className={cn(
                                    "w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 px-3 text-sm focus:ring-2 focus:ring-primary-500 font-bold tabular-nums transition-all",
                                    (returns[item.id]?.quantity ?? 0) > 0 && "border-primary-300 dark:border-primary-700 bg-primary-50/30 dark:bg-primary-950/20"
                                  )}
                                />
                                {(returns[item.id]?.quantity ?? 0) > 0 && (
                                  <div className="absolute -top-2 -end-2 w-5 h-5 bg-primary-600 text-white rounded-full flex items-center justify-center shadow-lg shadow-primary-500/30">
                                    <CheckCircle2 className="w-3 h-3" />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <input
                                type="text"
                                value={returns[item.id]?.notes ?? ''}
                                onChange={(e) => handleSetReturnNotes(item.id, e.target.value)}
                                placeholder="سبب الإرجاع..."
                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 px-3 text-xs focus:ring-2 focus:ring-primary-500 transition-all"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AddClientModal
        open={addClientOpen}
        onClose={() => setAddClientOpen(false)}
        onSubmit={async (d) => {
          await createClientMutation.mutateAsync({
            name: d.name,
            phone: d.phone || null,
            location: d.location || null,
            initial_debt: d.initial_debt,
            notes: d.notes || null,
          })
        }}
      />
    </div>
  )
}
