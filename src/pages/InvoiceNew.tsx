import { useState, useRef, useEffect, useMemo, useCallback, useDeferredValue } from 'react'
import { useNavigate, useSearchParams, useMatch, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Search, UserPlus, Package, GripVertical, X, CheckCircle2, Users, Wallet, Zap, Banknote, CreditCard } from 'lucide-react'
import { playScanFeedback } from '@/lib/scanFeedback'
import { getClients, getClientBarns, createClient } from '@/api/clients'
import type { Client } from '@/types/api'
import AddClientModal from '@/components/AddClientModal'
import { getWarehouses } from '@/api/warehouses'
import {
  getProductsWithStockInWarehouse,
  getProduct,
  getProductByBarcode,
  lookupProductBatchById,
  getWarehouseBatches,
  getBagInstance,
} from '@/api/products'
import type { ProductBatch } from '@/types/api'
import { createInvoice, getInvoice, updateInvoice } from '@/api/invoices'
import { useAuthStore } from '@/stores/auth'
import { cn, formatCurrency, formatExpiryMonth, formatNumber, getNearExpiryWarning, normalizeSearchText, normalizeArabicNumbers } from '@/lib/utils'
import { quantityColumnLabelsForInvoiceNewRows } from '@/lib/quantityColumnHeader'
import { parseScannedBarcode } from '@/components/ProductLabelPrint'
import BatchPickerModal from '@/components/BatchPickerModal'
import { getTopProducts } from '@/api/dashboard'
import FeedbackBanner from '@/components/FeedbackBanner'
import SuccessOverlay from '@/components/SuccessOverlay'
import {
  clearInvoiceNewPendingBarcode,
  normalizeInvoiceScanToken,
  readInvoiceNewPendingBarcode,
} from '@/lib/barcodeLookup'
const LAST_WAREHOUSE_KEY = 'vet-pharmacy-new-invoice-warehouse'
/** Legacy draft key — removed on successful create so old data is not restored. */
const LEGACY_INVOICE_NEW_DRAFT_KEY = 'vet-pharmacy-invoice-new-draft'
const RECENT_CLIENTS_KEY = 'vet-pharmacy-recent-invoice-clients'
const INVOICE_NEW_DRAFT_KEY = 'vet-pharmacy-invoice-new-draft-v2'
const MAX_RECENT_CLIENTS = 5

function getRecentClientIds(): number[] {
  try {
    const raw = localStorage.getItem(RECENT_CLIENTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []
  } catch { return [] }
}

function addRecentClient(clientId: number): void {
  try {
    const current = getRecentClientIds().filter(id => id !== clientId)
    const updated = [clientId, ...current].slice(0, MAX_RECENT_CLIENTS)
    localStorage.setItem(RECENT_CLIENTS_KEY, JSON.stringify(updated))
  } catch { /* ignore */ }
}

/** Only the latest URL-barcode effect may strip `?barcode=` (overlapping deps, React Strict Mode remounts). */
let invoiceUrlBarcodeEffectSeq = 0

interface InvoiceRow {
  product_id: number
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
  stock: number
  batch_id: number | null
  batch_expiry: string | null
  batch_stock: number | null
  /** Bulk: kilos taken from this physical bag (scan `G{id}`). */
  bag_id: number | null
  /** Bulk line only: quantity entry unit (stored quantity is always kg). */
  bulk_input_unit?: 'kg' | 'gram'
}

/** Display value for bulk quantity input (quantity is always kg in state). */
function bulkInputDisplayValue(qtyKg: number, unit: 'kg' | 'gram' | undefined) {
  if (unit === 'gram') {
    const g = qtyKg * 1000
    return Math.round(g * 1000) / 1000
  }
  return qtyKg
}

function getLastWarehouseId(): string {
  if (typeof window === 'undefined') return ''
  try {
    const saved = localStorage.getItem(LAST_WAREHOUSE_KEY)
    return saved ?? ''
  } catch {
    return ''
  }
}

export default function InvoiceNew() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const editMatch = useMatch({ path: '/invoices/:id/edit', end: true })
  const editInvoiceId = editMatch?.params.id
  const isEdit = Boolean(editInvoiceId)

  const queryClient = useQueryClient()
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === 'super_admin'
  const [editOverrideReason, setEditOverrideReason] = useState('')
  const [clientId, setClientId] = useState('')
  const [barnId, setBarnId] = useState('')
  const [warehouseId, setWarehouseId] = useState(getLastWarehouseId)
  const [items, setItems] = useState<InvoiceRow[]>([])
  const itemsRef = useRef<InvoiceRow[]>([])
  itemsRef.current = items
  const [productSearch, setProductSearch] = useState('')
  const [payment_method, setPaymentMethod] = useState<'cash' | 'credit'>('credit')
  const [paid_amount, setPaidAmount] = useState<number>(0)
  const [registerDeferred, setRegisterDeferred] = useState(true)
  const [immediateMethod, setImmediateMethod] = useState<'cash' | 'vodafone_cash' | 'instapay'>('cash')
  const [dueDate, setDueDate] = useState('')
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount')
  const [discountValue, setDiscountValue] = useState<number>(0)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [scanError, setScanError] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [clientListOpen, setClientListOpen] = useState(false)
  const [addClientOpen, setAddClientOpen] = useState(false)
  const [formHydrated, setFormHydrated] = useState(false)
  /** Shown after successful create/update; navigation runs after a short delay. */
  const [invoiceSuccess, setInvoiceSuccess] = useState<
    null | { kind: 'created' } | { kind: 'updated'; id: string }
  >(null)
  const editMetaAppliedRef = useRef(false)
  const warehouseSelectRef = useRef<HTMLSelectElement>(null)
  const itemsTableRef = useRef<HTMLTableSectionElement>(null)
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  /** Blocks concurrent runInvoiceScan from URL effect + manual submit (same mutex). */
  const scanInFlightRef = useRef(false)
  const clientPickerRef = useRef<HTMLDivElement>(null)
  const clientSearchInputRef = useRef<HTMLInputElement>(null)

  // Drag-and-drop reorder
  const dragItemRef = useRef<number | null>(null)
  const dragOverItemRef = useRef<number | null>(null)
  const [dragActiveIndex, setDragActiveIndex] = useState<number | null>(null)

  // Batch picker modal state
  const [batchPickerOpen, setBatchPickerOpen] = useState(false)
  const [batchPickerProduct, setBatchPickerProduct] = useState<{ id: number; name: string; stock: number; selling_price?: number; purchase_price?: number } | null>(null)
  const [batchPickerBatches, setBatchPickerBatches] = useState<ProductBatch[]>([])

  const { data: invoiceToEdit, isLoading: invoiceEditLoading } = useQuery({
    queryKey: ['invoice', editInvoiceId],
    queryFn: () => getInvoice(editInvoiceId!),
    enabled: isEdit && !!editInvoiceId,
  })

  const { data: clientsData } = useQuery({
    queryKey: ['clients', 'list'],
    queryFn: () => getClients({ limit: 500 }),
  })
  const clients = clientsData?.data ?? []

  useEffect(() => {
    setFormHydrated(false)
    editMetaAppliedRef.current = false
  }, [editInvoiceId])

  const recentIds = useMemo(() => getRecentClientIds(), [clients])

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    let list = clients
    if (q) {
      list = clients.filter((c) => {
        const nameMatch = c.name.toLowerCase().includes(q)
        const phoneDigits = (c.phone ?? '').replace(/\D/g, '')
        const phoneMatch = digits.length > 0 && phoneDigits.includes(digits)
        return nameMatch || phoneMatch
      })
    } else {
      // No search — show recent clients first
      const recentSet = new Set(recentIds)
      const recent = recentIds
        .map(id => clients.find(c => c.id === id))
        .filter((c): c is Client => c != null)
      const rest = clients.filter(c => !recentSet.has(c.id))
      list = [...recent, ...rest]
    }
    return list.slice(0, 120)
  }, [clients, clientSearch, recentIds])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (clientPickerRef.current && !clientPickerRef.current.contains(e.target as Node)) {
        setClientListOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const createClientMutation = useMutation({
    mutationFn: createClient,
    onSuccess: (newClient) => {
      queryClient.setQueryData(
        ['clients', 'list'],
        (old: { data: Client[]; total: number } | undefined) => {
          if (!old) return { data: [newClient], total: 1 }
          const without = old.data.filter((c) => c.id !== newClient.id)
          return { ...old, data: [newClient, ...without], total: without.length + 1 }
        },
      )
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setClientId(String(newClient.id))
      setBarnId('')
      setClientSearch('')
      setClientListOpen(false)
      setAddClientOpen(false)
    },
  })

  const { data: barns = [] } = useQuery({
    queryKey: ['client', clientId, 'barns'],
    queryFn: () => getClientBarns(clientId),
    enabled: !!clientId,
  })

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses,
  })

  const {
    data: productsWithStock = [],
    isFetching: productsLoading,
    isFetched: productsQueryFetched,
    error: productsError,
  } = useQuery({
    queryKey: ['products', 'warehouse', warehouseId],
    queryFn: () => {
      console.log('Fetching products for warehouse:', warehouseId)
      return getProductsWithStockInWarehouse(Number(warehouseId))
    },
    enabled: !!warehouseId,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (productsWithStock.length > 0) {
      console.log(`Loaded ${productsWithStock.length} products with stock`)
    }
  }, [productsWithStock.length])

  const { data: topSellingRows = [] } = useQuery({
    queryKey: ['reports', 'top-products', 'invoice-picker', warehouseId],
    queryFn: async () => {
      try {
        return await getTopProducts({
          limit: 10,
          warehouse_id: Number(warehouseId),
        })
      } catch {
        return []
      }
    },
    enabled: !!warehouseId,
    staleTime: 60_000,
  })

  const { data: warehouseBatches = [], isFetched: warehouseBatchesFetched } = useQuery({
    queryKey: ['warehouse-batches', warehouseId],
    queryFn: () => getWarehouseBatches(Number(warehouseId)),
    enabled: !!warehouseId,
    staleTime: 30_000,
  })

  const batchesByProduct = useMemo(() => {
    const map = new Map<number, ProductBatch[]>()
    for (const b of warehouseBatches) {
      const list = map.get(b.product_id) ?? []
      list.push(b)
      map.set(b.product_id, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31')
      )
    }
    return map
  }, [warehouseBatches])

  useEffect(() => {
    if (!isEdit || !invoiceToEdit || editMetaAppliedRef.current) return
    editMetaAppliedRef.current = true
    setClientId(String(invoiceToEdit.client_id))
    setBarnId(invoiceToEdit.barn_id ? String(invoiceToEdit.barn_id) : '')
    setWarehouseId(String(invoiceToEdit.warehouse_id))
    setNotes(invoiceToEdit.notes ?? '')
    setPaymentMethod(invoiceToEdit.payment_method === 'cash' ? 'cash' : 'credit')
    setPaidAmount(Number(invoiceToEdit.paid_amount) || 0)
    const rem0 =
      Math.max(
        0,
        Math.round(Number(invoiceToEdit.total_amount) || 0) -
        Math.round(Number(invoiceToEdit.paid_amount) || 0)
      )
    setRegisterDeferred(rem0 > 0)
    setDueDate(
      invoiceToEdit.due_date && String(invoiceToEdit.due_date).length >= 10
        ? String(invoiceToEdit.due_date).slice(0, 10)
        : ''
    )
    const da = Number(invoiceToEdit.discount_amount) || 0
    if (da > 0) {
      setDiscountType('amount')
      setDiscountValue(da)
    } else {
      setDiscountType('amount')
      setDiscountValue(0)
    }
  }, [isEdit, invoiceToEdit])

  // Draft Auto-Save
  useEffect(() => {
    if (isEdit || invoiceSuccess) return
    const draft = {
      clientId,
      barnId,
      warehouseId,
      items,
      payment_method,
      paid_amount,
      registerDeferred,
      immediateMethod,
      dueDate,
      discountType,
      discountValue,
      notes,
    }
    localStorage.setItem(INVOICE_NEW_DRAFT_KEY, JSON.stringify(draft))
  }, [
    isEdit,
    invoiceSuccess,
    clientId,
    barnId,
    warehouseId,
    items,
    payment_method,
    paid_amount,
    registerDeferred,
    immediateMethod,
    dueDate,
    discountType,
    discountValue,
    notes,
  ])

  // Draft Restore
  useEffect(() => {
    if (isEdit || formHydrated) return
    const raw = localStorage.getItem(INVOICE_NEW_DRAFT_KEY)
    if (!raw) {
      setFormHydrated(true)
      return
    }
    try {
      const draft = JSON.parse(raw)
      if (draft && Array.isArray(draft.items) && draft.items.length > 0) {
        const confirmRestore = window.confirm('هل تريد استعادة مسودة الفاتورة السابقة؟')
        if (confirmRestore) {
          if (draft.clientId) setClientId(draft.clientId)
          if (draft.barnId) setBarnId(draft.barnId)
          if (draft.warehouseId) setWarehouseId(draft.warehouseId)
          if (draft.items) setItems(draft.items)
          if (draft.payment_method) setPaymentMethod(draft.payment_method)
          if (draft.paid_amount) setPaidAmount(draft.paid_amount)
          if (draft.registerDeferred !== undefined) setRegisterDeferred(draft.registerDeferred)
          if (draft.immediateMethod) setImmediateMethod(draft.immediateMethod)
          if (draft.dueDate) setDueDate(draft.dueDate)
          if (draft.discountType) setDiscountType(draft.discountType)
          if (draft.discountValue) setDiscountValue(draft.discountValue)
          if (draft.notes) setNotes(draft.notes)
        } else {
          localStorage.removeItem(INVOICE_NEW_DRAFT_KEY)
        }
      }
    } catch (e) {
      console.error('Failed to restore draft', e)
    }
    setFormHydrated(true)
  }, [isEdit, formHydrated])

  // Unsaved Warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (items.length > 0 && !invoiceSuccess) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [items.length, invoiceSuccess])

  useEffect(() => {
    if (!isEdit || !invoiceToEdit || formHydrated) return
    if (String(warehouseId) !== String(invoiceToEdit.warehouse_id)) return
    if ((invoiceToEdit.items?.length ?? 0) > 0 && productsLoading) return

    const oldQtyByProduct = new Map<number, number>()
    for (const it of invoiceToEdit.items || []) {
      if (it.product_id == null) continue
      oldQtyByProduct.set(it.product_id, (oldQtyByProduct.get(it.product_id) ?? 0) + (it.quantity ?? 0))
    }
    const mapped = (invoiceToEdit.items || [])
      .filter((it): it is typeof it & { product_id: number } => it.product_id != null)
      .map((it) => {
        const entry = productsWithStock.find((x) => x.product.id === it.product_id)
        const baseStock = entry?.stock ?? 0
        const boost = oldQtyByProduct.get(it.product_id) ?? 0
        const isBulk = entry?.product.unit_type === 'bulk'
        const dispU = (it as { display_unit?: string }).display_unit
        const bulkUnit = dispU === 'gram' ? ('gram' as const) : ('kg' as const)
        return {
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: it.quantity,
          unit_price: it.unit_price,
          total_price: it.total_price,
          stock: baseStock + boost,
          batch_id: it.batch_id ?? null,
          batch_expiry: null,
          batch_stock: null,
          bag_id: null,
          bulk_input_unit: isBulk ? bulkUnit : undefined,
        }
      })
    setItems(mapped)
    setFormHydrated(true)
  }, [isEdit, invoiceToEdit, warehouseId, productsWithStock, productsLoading, formHydrated])

  const urlBarcodeParam = searchParams.get('barcode') ?? ''
  /** URL param or session backup (see `setInvoiceNewPendingBarcode` in barcodeLookup). */
  const effectivePendingBarcode = (() => {
    const u = normalizeInvoiceScanToken(urlBarcodeParam)
    if (u) return u
    return normalizeInvoiceScanToken(readInvoiceNewPendingBarcode())
  })()

  useEffect(() => {
    if (isEdit) return
    try {
      localStorage.removeItem(LEGACY_INVOICE_NEW_DRAFT_KEY)
    } catch {
      /* ignore */
    }
  }, [isEdit])

  const createMutation = useMutation({
    mutationFn: createInvoice,
    onSuccess: (data) => {
      const notes = (data as { bulk_notifications?: { product_name: string; warehouse_name: string; expiry_date: string | null }[] })
        .bulk_notifications
      if (notes && notes.length > 0) {
        setNotice(
          notes
            .map(
              (n) =>
                `تم فتح شكارة جديدة تلقائياً — ${n.product_name} (الصلاحية: ${formatExpiryMonth(n.expiry_date)} | المخزن: ${n.warehouse_name ?? ''})`
            )
            .join(' | ')
        )
      }
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['products', 'warehouse', warehouseId] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-batches', warehouseId] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product'] })
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: ['client', clientId] })
      }
      if (barnId) {
        queryClient.invalidateQueries({ queryKey: ['barn', barnId] })
      }
      localStorage.removeItem(INVOICE_NEW_DRAFT_KEY)
      setInvoiceSuccess({ kind: 'created' })
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الفاتورة')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateInvoice>[1] }) =>
      updateInvoice(id, body),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      queryClient.invalidateQueries({ queryKey: ['products', 'warehouse', warehouseId] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-batches', warehouseId] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product'] })
      if (clientId) {
        queryClient.invalidateQueries({ queryKey: ['client', clientId] })
      }
      if (barnId) {
        queryClient.invalidateQueries({ queryKey: ['barn', barnId] })
      }
      setInvoiceSuccess({ kind: 'updated', id })
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'تعذر تحديث الفاتورة')
    },
  })

  const invoiceCancelled =
    isEdit &&
    invoiceToEdit &&
    (invoiceToEdit.invoice_lifecycle ?? 'active') === 'cancelled'
  const structuralEditBlocked =
    isEdit && invoiceToEdit && invoiceToEdit.structural_edit_allowed === false
  const superAdminOutsideEditWindow =
    isEdit &&
    invoiceToEdit &&
    invoiceToEdit.structural_edit_allowed === true &&
    invoiceToEdit.structural_edit_within_window === false
  const editWindowDaysUi = invoiceToEdit?.edit_window_days ?? 7

  const totalAmount = items.reduce((a, i) => a + i.total_price, 0)
  const discountAmount =
    discountType === 'percent'
      ? (totalAmount * Math.max(0, Math.min(100, discountValue))) / 100
      : Math.max(0, discountValue)
  const finalTotal = Math.max(0, totalAmount - discountAmount)
  /** فاتورة آجل: لا يُسجَّل مبلغ مدفوع الآن */
  const effectivePaidAmount = payment_method === 'credit' ? 0 : paid_amount
  const remainingUnpaid = Math.max(0, Math.round(finalTotal) - Math.round(effectivePaidAmount))

  const qtyColumnLabels = useMemo(
    () => quantityColumnLabelsForInvoiceNewRows(items, productsWithStock),
    [items, productsWithStock]
  )

  useEffect(() => {
    if (payment_method === 'credit') {
      setPaidAmount(0)
    } else if (payment_method === 'cash' && paid_amount === 0) {
      setPaidAmount(Math.round(finalTotal))
    }
  }, [payment_method, finalTotal])

  useEffect(() => {
    if (remainingUnpaid <= 0) {
      setRegisterDeferred(false)
    } else if (effectivePaidAmount === 0) {
      // Empty cart briefly had remainingUnpaid === 0 which cleared this; full unpaid must stay "آجل"
      setRegisterDeferred(true)
    }
  }, [remainingUnpaid, effectivePaidAmount])

  const deferredProductSearch = useDeferredValue(productSearch)
  const filteredWarehouseProducts = deferredProductSearch.trim()
    ? productsWithStock.filter(({ product }) => {
      const q = normalizeSearchText(deferredProductSearch)
      const isNumeric = /^\d+$/.test(q)
      const nameMatch = normalizeSearchText(product.name).includes(q)

      if (isNumeric) {
        return nameMatch || String(product.id) === q || (product.barcode && (product.barcode === q || product.barcode.endsWith(q)))
      }
      return (
        nameMatch ||
        (product.barcode && normalizeSearchText(product.barcode).includes(q)) ||
        String(product.id).includes(q)
      )
    })
    : productsWithStock
  const showProductList = warehouseId && productsWithStock.length > 0

  const warehouseProductsSortedForPicker = useMemo(() => {
    const rank = new Map<number, number>()
    let idx = 0
    for (const row of topSellingRows) {
      if (row.product_id && !rank.has(row.product_id)) {
        rank.set(row.product_id, idx++)
      }
    }
    const list = [...filteredWarehouseProducts]
    const sorted = list.sort((a, b) => {
      const q = normalizeSearchText(deferredProductSearch)
      if (q) {
        const aBar = normalizeSearchText(a.product.barcode || '')
        const bBar = normalizeSearchText(b.product.barcode || '')
        if (aBar === q && bBar !== q) return -1
        if (bBar === q && aBar !== q) return 1

        const aId = String(a.product.id)
        const bId = String(b.product.id)
        const qNum = parseInt(q, 10)
        const aMatchesId = aId === q || (!isNaN(qNum) && a.product.id === qNum)
        const bMatchesId = bId === q || (!isNaN(qNum) && b.product.id === qNum)
        if (aMatchesId && !bMatchesId) return -1
        if (bMatchesId && !aMatchesId) return 1
      }

      const ra = rank.get(a.product.id)
      const rb = rank.get(b.product.id)
      const inTopA = ra !== undefined
      const inTopB = rb !== undefined
      if (inTopA && inTopB && ra !== rb) return ra - rb
      if (inTopA !== inTopB) return inTopA ? -1 : 1
      return a.product.name.localeCompare(b.product.name, 'ar')
    })

    // Limit to 10 for initial view, or 50 for search results to keep UI snappy
    return deferredProductSearch.trim() ? sorted.slice(0, 50) : sorted.slice(0, 10)
  }, [filteredWarehouseProducts, topSellingRows, deferredProductSearch])

  const formatExpiry = (d: string) => formatExpiryMonth(d)

  const getBatchSellingPrice = (productId: number, fallbackPrice: number) => {
    const batches = batchesByProduct.get(productId) ?? []
    for (const b of batches) {
      if ((b.quantity ?? 0) > 0 && b.selling_price != null && b.selling_price > 0) return b.selling_price
    }
    return fallbackPrice
  }

  const getFefoBreakdown = (productId: number, qty: number) => {
    const batches = batchesByProduct.get(productId) ?? []
    const result: { expiry_date: string; take: number; selling_price: number | null }[] = []
    let remaining = qty
    for (const b of batches) {
      if (remaining <= 0) break
      const take = Math.min(remaining, b.unit_type === 'bulk' ? (b.kg_remaining ?? 0) : (b.quantity ?? 0))
      if (take > 0) {
        result.push({ expiry_date: b.expiry_date ?? '9999-12-31', take, selling_price: b.selling_price })
        remaining -= take
      }
    }
    return result
  }

  const addProductToInvoice = async (entry: (typeof productsWithStock)[0], qty: number = 1) => {
    const { product, stock } = entry
    // Fetch batches for this product in this warehouse
    const productBatches = batchesByProduct.get(product.id) ?? []
    const activeBatches = productBatches.filter((b) => b.unit_type === 'bulk' ? (b.kg_remaining ?? 0) > 0 : (b.quantity ?? 0) > 0)

    if (activeBatches.length === 0) {
      // No batches — legacy add without batch_id
      const maxQty = stock > 0 ? stock : 99999
      const quantity = Math.max(1, Math.min(qty, maxQty))
      const price = getBatchSellingPrice(product.id, product.selling_price)
      setItems((prev) => {
        const existing = prev.find((i) => i.product_id === product.id && !i.batch_id)
        if (existing) {
          const newQty = Math.min(existing.quantity + quantity, existing.stock > 0 ? existing.stock : 99999)
          return prev.map((i) =>
            i === existing
              ? { ...i, quantity: newQty, total_price: newQty * i.unit_price }
              : i
          )
        }
        return [
          ...prev,
          {
            product_id: product.id,
            product_name: product.name,
            quantity,
            unit_price: price,
            total_price: price * quantity,
            stock,
            batch_id: null,
            batch_expiry: null,
            batch_stock: null,
            bag_id: null,
            ...(product.unit_type === 'bulk' ? { bulk_input_unit: 'kg' as const } : {}),
          },
        ]
      })
      playScanFeedback(true)
      setTimeout(() => { itemsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); barcodeInputRef.current?.focus() }, 0)
      return
    }

    if (activeBatches.length === 1) {
      // Single batch — auto-select
      const batch = activeBatches[0]
      const batchQty = Math.max(1, Math.min(qty, batch.quantity ?? 0))
      const price = batch.selling_price != null && batch.selling_price > 0 ? batch.selling_price : product.selling_price
      setItems((prev) => {
        const existing = prev.find((i) => i.batch_id === batch.id)
        if (existing) {
          const newQty = Math.min(existing.quantity + batchQty, batch.quantity ?? 99999)
          return prev.map((i) =>
            i === existing
              ? { ...i, quantity: newQty, total_price: newQty * i.unit_price }
              : i
          )
        }
        const isSentinel = !batch.expiry_date || batch.expiry_date === '9999-12-31'
        return [
          ...prev,
          {
            product_id: product.id,
            product_name: product.name,
            quantity: batchQty,
            unit_price: price,
            total_price: price * batchQty,
            stock,
            batch_id: batch.id,
            batch_expiry: isSentinel ? null : batch.expiry_date,
            batch_stock:
              batch.unit_type === 'bulk' ? (batch.kg_remaining ?? 0) : (batch.quantity ?? 0),
            bag_id: null,
            ...(batch.unit_type === 'bulk' || product.unit_type === 'bulk'
              ? { bulk_input_unit: 'kg' as const }
              : {}),
          },
        ]
      })
      playScanFeedback(true)
      setTimeout(() => { itemsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); barcodeInputRef.current?.focus() }, 0)
      return
    }

    // Multiple batches — open picker
    setBatchPickerProduct({ id: product.id, name: product.name, stock, selling_price: product.selling_price, purchase_price: product.purchase_price })
    setBatchPickerBatches(activeBatches)
    setBatchPickerOpen(true)
  }

  const handleBatchSelected = (batch: ProductBatch, qty: number) => {
    if (!batchPickerProduct) return
    const price = batch.selling_price != null && batch.selling_price > 0 ? batch.selling_price : (batchPickerProduct.selling_price ?? 0)
    const isSentinel = !batch.expiry_date || batch.expiry_date === '9999-12-31'
    setItems((prev) => {
      const existing = prev.find((i) => i.batch_id === batch.id)
      if (existing) {
        const newQty = Math.min(existing.quantity + qty, batch.quantity ?? 99999)
        return prev.map((i) =>
          i === existing
            ? { ...i, quantity: newQty, total_price: newQty * i.unit_price }
            : i
        )
      }
      return [
        ...prev,
        {
          product_id: batchPickerProduct.id,
          product_name: batchPickerProduct.name,
          quantity: qty,
          unit_price: price,
          total_price: price * qty,
          stock: batchPickerProduct.stock,
          batch_id: batch.id,
          batch_expiry: isSentinel ? null : batch.expiry_date,
          batch_stock:
            batch.unit_type === 'bulk' ? (batch.kg_remaining ?? 0) : (batch.quantity ?? 0),
          bag_id: null,
          ...(batch.unit_type === 'bulk' ? { bulk_input_unit: 'kg' as const } : {}),
        },
      ]
    })
    setBatchPickerOpen(false)
    setBatchPickerProduct(null)
    playScanFeedback(true)
    setTimeout(() => { itemsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); barcodeInputRef.current?.focus() }, 0)
  }

  const handleAddRow = () => {
    if (!warehouseId) {
      warehouseSelectRef.current?.focus()
      return
    }
    const first = productsWithStock[0]
    if (!first) return
    void addProductToInvoice(first)
  }

  const handleQuantityChange = (index: number, qty: number) => {
    setItems((prev) => {
      const next = [...prev]
      const row = next[index]
      // If batch-bound, cap at batch stock; otherwise cap at warehouse stock
      // Allow increasing quantity up to the total warehouse stock (row.stock), even if row.batch_id is set.
      // This supports the "batch overflow" logic on the backend.
      const maxQty = row.stock > 0 ? row.stock : 99999
      const q = Math.max(0, Math.min(qty, maxQty))
      next[index] = { ...row, quantity: q, total_price: q * row.unit_price }
      return next
    })
  }

  const runInvoiceScanRef = useRef<(raw: string) => Promise<boolean>>(async () => false)

  runInvoiceScanRef.current = async (raw: string): Promise<boolean> => {
    try {
      const trimmed = normalizeInvoiceScanToken(raw.trim())
      if (import.meta.env.DEV) {
        console.log('[InvoiceNew] Processing scan:', { raw, trimmed })
      }
      if (!trimmed) return false

      if (!warehouseId) {
        setScanError('اختر المخزن أولاً')
        return false
      }

      setScanError('')
      const parsed = parseScannedBarcode(trimmed)
      if (import.meta.env.DEV) {
        console.log('[InvoiceNew] Parsed barcode:', parsed)
      }
      const itemsSnap = itemsRef.current

      if (parsed.kind === 'batch') {
        const raw = trimmed
        const batchId = parsed.batchId

        // RANKED RESOLUTION (Mirroring Inventory Search ranking)
        // 1. Exact string match for Product ID in this warehouse
        const prodById = !parsed.isExplicit ? productsWithStock.find(p => String(p.product.id) === raw) : null

        // 2. Exact string match for Barcode in this warehouse
        const prodByBarcode = !parsed.isExplicit ? productsWithStock.find(p => (p.product.barcode || '').trim() === raw) : null

        // 3. Match as a Batch ID in this warehouse
        let batch: ProductBatch | undefined = warehouseBatches.find((b) => Number(b.id) === Number(batchId))

        // AMBIGUITY RESOLUTION: Only apply fallbacks if it's not an explicit "B..." scan
        if (!parsed.isExplicit) {
          if (prodById) {
            if (import.meta.env.DEV) console.log('[InvoiceNew] Numeric scan resolved to exact Product ID match:', prodById.product.name)
            void addProductToInvoice(prodById)
            return true
          }
          if (prodByBarcode) {
            if (import.meta.env.DEV) console.log('[InvoiceNew] Numeric scan resolved to exact Barcode match:', prodByBarcode.product.name)
            void addProductToInvoice(prodByBarcode)
            return true
          }
        }

        if (!batch) {
          // 4. Not in local list/product fallback, look it up globally
          const looked = await lookupProductBatchById(batchId)
          if (looked.status === 'ok') {
            // Check warehouse mismatch
            if (Number(looked.batch.warehouse_id) !== Number(warehouseId)) {
              // Secondary fallback: if it's a numeric code, maybe it's ALSO a product barcode/ID in this warehouse?
              if (!parsed.isExplicit) {
                const prodEntry = productsWithStock.find(p => String(p.product.id) === raw || (p.product.barcode || '').trim() === raw)
                if (prodEntry) {
                  void addProductToInvoice(prodEntry)
                  return true
                }
              }

              setScanError(`الدفعة #${batchId} مسجّلة في مخزن آخر — غيّر المخزن أو امسح ملصقاً من هذا المخزن.`)
              return false
            }
            batch = looked.batch
          } else if (looked.status === 'not_found' && !parsed.isExplicit) {
            // Final fallback: try search for product anyway
            const prodEntry = productsWithStock.find(p => 
              String(p.product.id) === raw || 
              (p.product.barcode || '').trim() === raw ||
              (p.product.barcode && normalizeArabicNumbers(p.product.barcode).trim() === raw)
            )
            if (prodEntry) {
              void addProductToInvoice(prodEntry)
              return true
            }

            // Secondary fallback: check if product exists at all (might have 0 stock)
            try {
              let productInfo = await getProductByBarcode(raw)
              if (!productInfo && /^\d+$/.test(raw)) {
                try { productInfo = await getProduct(raw) } catch { /* ignore */ }
              }

              if (productInfo) {
                setScanError(`المنتج "${productInfo.name}" مسجل بالرقم "${raw}" ولكن ليس له مخزون في هذا المخزن.`)
                return false
              }
            } catch (e) {
              // ignore
            }

            setScanError(
              `لا توجد دفعة أو منتج بالرقم "${raw}" في النظام. (Raw: "${raw}")`
            )
            return false
          } else {
            setScanError('تعذّر التحقق من الدفعة (شبكة أو خادم). حدّث الصفحة وحاول مرة أخرى.')
            return false
          }
        }

        if (!batch) return false // should not happen after fallback but for TS

        if (batch.unit_type === 'bulk') {
          const msg = 'منتج بالكيلو: امسح ملصق الشكارة (رمز G) بدل دفعة'
          if (import.meta.env.DEV) console.warn('[InvoiceNew] Scan rejected:', msg)
          setScanError(msg)
          return false
        }

        const stockQty = Number(batch.quantity ?? 0)
        if (stockQty <= 0) {
          const msg = `الدفعة #${batch.id} لا تحتوي على مخزون متاح (الكمية: 0)`
          if (import.meta.env.DEV) console.warn('[InvoiceNew] Scan rejected:', msg)
          setScanError(msg)
          return false
        }

        let entry = productsWithStock.find((x) => Number(x.product.id) === Number(batch.product_id))
        if (!entry) {
          try {
            const product = await getProduct(String(batch.product_id))
            entry = { product, stock: Math.max(0, stockQty) }
          } catch {
            const msg = 'المنتج غير متوفر في هذا المخزن'
            if (import.meta.env.DEV) console.error('[InvoiceNew] Scan rejected:', msg)
            setScanError(msg)
            return false
          }
        }
        const displayName = entry.product.name

        // Warning for non-FEFO scan
        const otherBatches = warehouseBatches.filter(
          (b) =>
            Number(b.product_id) === Number(batch.product_id) &&
            (b.unit_type === 'bulk' ? (b.kg_remaining ?? 0) > 0 : (b.quantity ?? 0) > 0)
        )
        const sorted = [...otherBatches].sort((a, b) =>
          (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31')
        )
        const earliest = sorted[0]?.expiry_date || '9999-12-31'
        if ((batch.expiry_date || '9999-12-31') > earliest) {
          setScanError(getNearExpiryWarning(earliest))
        }

        const existingIdx = itemsSnap.findIndex((i) => Number(i.batch_id) === Number(batch.id) && !i.bag_id)
        if (existingIdx >= 0) {
          handleQuantityChange(existingIdx, itemsSnap[existingIdx].quantity + 1)
        } else {
          const price = (batch.selling_price != null && batch.selling_price > 0) 
            ? batch.selling_price 
            : entry.product.selling_price
          const isSentinel = !batch.expiry_date || batch.expiry_date === '9999-12-31'
          setItems((prev) => [
            ...prev,
            {
              product_id: entry.product.id,
              product_name: displayName,
              quantity: 1,
              unit_price: price,
              total_price: price,
              stock: entry.stock,
              batch_id: batch.id,
              batch_expiry: isSentinel ? null : batch.expiry_date,
              batch_stock: stockQty,
              bag_id: null,
            },
          ])
        }
        return true
      }

      if (parsed.kind === 'bag') {
        const bag = await getBagInstance(parsed.bagInstanceId)
        if (!bag) {
          setScanError('لم يُعثر على الشكارة')
          return false
        }
        if (Number(warehouseId) !== Number(bag.warehouse_id)) {
          setScanError('هذه الشكارة مسجّلة في مخزن آخر')
          return false
        }
        const kgRemaining = Number(bag.kg_remaining ?? 0)
        if (!['open', 'sealed'].includes(bag.status) || kgRemaining <= 0) {
          setScanError('الشكارة غير متاحة أو فارغة')
          return false
        }
        let entry = productsWithStock.find((x) => Number(x.product.id) === Number(bag.product_id))
        if (!entry) {
          try {
            const product = await getProduct(String(bag.product_id))
            entry = { product, stock: Math.max(0, kgRemaining) }
          } catch {
            setScanError('المنتج غير متوفر في هذا المخزن')
            return false
          }
        }
        if (entry.product.unit_type !== 'bulk') {
          setScanError('ملصق الشكارة لا يطابق نوع المنتج')
          return false
        }
        const batchMeta = warehouseBatches.find((b) => Number(b.id) === Number(bag.batch_id))
        const price = (batchMeta?.selling_price != null && batchMeta.selling_price > 0)
          ? batchMeta.selling_price
          : (bag.selling_price != null && bag.selling_price > 0)
            ? bag.selling_price
            : entry.product.selling_price
        const isSentinel = !bag.expiry_date || bag.expiry_date === '9999-12-31'
        const existingIdx = itemsSnap.findIndex((i) => Number(i.bag_id) === Number(bag.id))
        if (existingIdx >= 0) {
          setScanError(`الشكارة #${bag.id} موجودة بالفعل في الفاتورة (سطر ${existingIdx + 1}) — عدّل الكمية يدوياً إن لزم.`)
          return true
        } else {
          const qty = kgRemaining
          setItems((prev) => [
            ...prev,
            {
              product_id: entry.product.id,
              product_name: entry.product.name,
              quantity: qty,
              unit_price: price,
              total_price: price * qty,
              stock: entry.stock,
              batch_id: bag.batch_id,
              batch_expiry: isSentinel ? null : bag.expiry_date,
              batch_stock: kgRemaining,
              bag_id: bag.id,
              bulk_input_unit: 'kg',
            },
          ])
        }
        return true
      }

      const code = parsed.kind === 'product' ? parsed.code : trimmed
      if (!code) {
        setScanError('رمز غير صالح')
        return false
      }

      let product = await getProductByBarcode(code)
      if (!product && /^\d+$/.test(code)) {
        // Fallback: try ID
        try { product = await getProduct(code) } catch { /* ignore */ }

        if (!product) {
          const numeric = String(Number(code))
          if (numeric !== code) {
            if (import.meta.env.DEV) console.log('[InvoiceNew] Retrying product search without leading zeros:', numeric)
            product = await getProductByBarcode(numeric)
            if (!product) {
              try { product = await getProduct(numeric) } catch { /* ignore */ }
            }
          }
        }
      }

      if (!product) {
        setScanError(`المنتج بالرقم "${code}" غير موجود في النظام.`)
        return false
      }
      const entry = productsWithStock.find((x) => Number(x.product.id) === Number(product.id))
      if (!entry) {
        setScanError(`المنتج "${product.name}" موجود ولكن ليس له مخزون في هذا المخزن.`)
        return false
      }
      void addProductToInvoice(entry)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[InvoiceNew] Scan error:', err)
      setScanError(`خطأ أثناء المعالجة: ${msg}`)
      return false
    }
  }

  useEffect(() => {
    if (isEdit) return
    const raw = effectivePendingBarcode.trim()
    if (!raw || !warehouseId) return
    // Products list is "with stock > 0" only — it can be empty while B/G labels still resolve via batches/bags.
    if (!productsQueryFetched) return
    // Wait until batches query finished so B/G and batch resolution see full data.
    if (!warehouseBatchesFetched) return

    const mySeq = ++invoiceUrlBarcodeEffectSeq
    let cancelled = false

    void (async () => {
      // Serialize with any in-flight scan (manual field or a previous URL pass). Do not bail: in React Strict
      // Mode the "second" pass must run after the first releases the mutex, or the line is never added.
      const maxWaitMs = 4000
      const stepMs = 16
      let waited = 0
      while (scanInFlightRef.current && waited < maxWaitMs) {
        await new Promise((r) => setTimeout(r, stepMs))
        waited += stepMs
      }
      if (scanInFlightRef.current) {
        setScanError('تعذّر إكمال المسح بسبب عملية مسح أخرى — أعد المحاولة.')
        if (import.meta.env.DEV) {
          console.warn('[InvoiceNew] URL barcode scan skipped: scan mutex still held after', maxWaitMs, 'ms')
        }
        return
      }

      scanInFlightRef.current = true
      let scanOk = false
      try {
        scanOk = await runInvoiceScanRef.current(raw)
      } finally {
        // Always release — cancelled must not skip release, or the remount's scan deadlocks on the mutex.
        scanInFlightRef.current = false
      }

      // Do not strip ?barcode= until after scan — remount/Strict Mode must still see it so a fresh effect can add the line.
      if (cancelled || mySeq !== invoiceUrlBarcodeEffectSeq) return

      // ALWAYS clear, even if !scanOk. If it failed, the user saw the error toast/feedback.
      // Keeping it in the URL prevents a second scan of the same item from triggering.
      clearInvoiceNewPendingBarcode()
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (p.has('barcode')) p.delete('barcode')
          return p
        },
        { replace: true }
      )
      barcodeInputRef.current?.focus()
    })()

    return () => {
      cancelled = true
      // Invalidate URL-strip + stale async so the next mount/effect run (e.g. Strict Mode) owns the scan.
      invoiceUrlBarcodeEffectSeq += 1
    }
  }, [
    isEdit,
    effectivePendingBarcode,
    warehouseId,
    productsQueryFetched,
    warehouseBatchesFetched,
    setSearchParams,
  ])

  const handleUnitPriceChange = (index: number, price: number) => {
    setItems((prev) => {
      const next = [...prev]
      next[index] = {
        ...next[index],
        unit_price: price,
        total_price: next[index].quantity * price,
      }
      return next
    })
  }

  const removeRow = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleBarcodeSubmit = async () => {
    const raw = barcodeInput.trim()
    if (!raw) return
    if (scanInFlightRef.current) return
    scanInFlightRef.current = true
    setBarcodeInput('')
    setScanError('')
    let ok = false
    try {
      ok = await runInvoiceScanRef.current(raw)
    } finally {
      scanInFlightRef.current = false
    }
    if (ok) playScanFeedback(true)
    else playScanFeedback(false)
    setTimeout(() => itemsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0)
    barcodeInputRef.current?.focus()
  }

  // --- Drag-and-drop reorder ---
  const handleDragStart = useCallback((index: number) => {
    dragItemRef.current = index
    setDragActiveIndex(index)
  }, [])
  const handleDragEnter = useCallback((index: number) => {
    dragOverItemRef.current = index
  }, [])
  const handleDragEnd = useCallback(() => {
    const from = dragItemRef.current
    const to = dragOverItemRef.current
    dragItemRef.current = null
    dragOverItemRef.current = null
    setDragActiveIndex(null)
    if (from === null || to === null || from === to) return
    setItems(prev => {
      const copy = [...prev]
      const [removed] = copy.splice(from, 1)
      copy.splice(to, 0, removed)
      return copy
    })
  }, [])
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault() }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')
    if (!clientId && payment_method !== 'cash') {
      setError('اختر العميل')
      return
    }
    if (!warehouseId) {
      setError('اختر المخزن')
      return
    }
    if (barns.length > 0 && !barnId) {
      setError('اختر العنبر (لدى هذا العميل عنابر مسجّلة)')
      return
    }
    if (items.length === 0) {
      setError('أضف صنفاً واحداً على الأقل')
      return
    }
    const zeroPrice = items.find((r) => r.unit_price <= 0)
    if (zeroPrice) {
      setError(`سعر البيع للمنتج "${zeroPrice.product_name}" هو صفر. يرجى تعديله قبل الحفظ.`)
      return
    }

    const invalid = items.find(
      (r) => r.quantity <= 0 || (r.batch_stock != null && r.quantity > r.batch_stock) || (r.batch_stock == null && r.stock > 0 && r.quantity > r.stock)
    )
    if (invalid) {
      if (invalid.quantity <= 0) {
        setError(`يرجى إدخال كمية للمنتج "${invalid.product_name}"`)
      } else {
        const avail = invalid.batch_stock ?? invalid.stock
        setError(`الكمية غير صالحة للمنتج "${invalid.product_name}" (المتاح: ${avail})`)
      }
      return
    }
    const gramBad = items.find((r) => {
      const p = productsWithStock.find((x) => x.product.id === r.product_id)?.product
      if (p?.unit_type !== 'bulk' || r.bulk_input_unit !== 'gram') return false
      return r.quantity * 1000 < 1 - 1e-12
    })
    if (gramBad) {
      setError(`الحد الأدنى للكمية 1 جرام للمنتج «${gramBad.product_name}»`)
      return
    }
    if (effectivePaidAmount < 0) {
      setError('المبلغ المدفوع لا يمكن أن يكون سالباً')
      return
    }
    const effectiveRegisterDeferred =
      remainingUnpaid > 0 && (registerDeferred || effectivePaidAmount === 0)
    if (remainingUnpaid > 0 && !effectiveRegisterDeferred) {
      setError(
        'المبلغ المدفوع أقل من إجمالي الفاتورة.\nيرجى إدخال المبلغ المتبقي أو تسجيله كآجل'
      )
      return
    }
    const client = clients.find((c) => String(c.id) === clientId)
    if (!client && !clientId) {
      // "Cash Customer" — MUST be fully paid
      if (remainingUnpaid > 0.01) {
        setError('الفواتير النقدية (بدون عميل) يجب أن تكون مدفوعة بالكامل')
        return
      }
    } else if (!client && clientId) {
      setError('اختر عميلاً من القائمة أو أضف عميلاً جديداً')
      return
    }

    // FEFO Warning Confirmation
    const hasAnyNearExpiryWarning = items.some((row) => {
      if (!row.batch_id) return false
      const productBatches = batchesByProduct.get(row.product_id) ?? []
      const activeBatches = productBatches.filter((b) =>
        b.unit_type === 'bulk' ? (b.kg_remaining ?? 0) > 0 : (b.quantity ?? 0) > 0
      )
      const earliestExpiry = activeBatches[0]?.expiry_date || '9999-12-31'
      const currentExpiry = row.batch_expiry || '9999-12-31'
      return currentExpiry > earliestExpiry
    })

    if (hasAnyNearExpiryWarning) {
      const confirmSave = window.confirm(
        'تنبيه: بعض الأصناف المختارة لها دفعات أخرى أقرب انتهاءً في المخزن. هل تريد الاستمرار في الحفظ؟'
      )
      if (!confirmSave) return
    }

    const itemPayload = items.map((i) => {
      const p = productsWithStock.find((x) => x.product.id === i.product_id)?.product
      const isBulk = p?.unit_type === 'bulk'
      const display_unit: 'kg' | 'gram' | undefined = isBulk
        ? i.bulk_input_unit === 'gram'
          ? 'gram'
          : 'kg'
        : undefined
      const display_quantity =
        isBulk && display_unit === 'gram'
          ? i.quantity * 1000
          : isBulk
            ? i.quantity
            : undefined
      return {
        product_id: i.product_id,
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total_price: i.total_price,
        batch_id: i.batch_id ?? undefined,
        bag_id: i.bag_id ?? undefined,
        ...(isBulk && display_quantity != null && display_unit
          ? { display_quantity, display_unit }
          : {}),
      }
    })
    if (isEdit && editInvoiceId) {
      if (structuralEditBlocked) {
        setError('انتهت مدة تعديل هذه الفاتورة')
        return
      }
      updateMutation.mutate({
        id: editInvoiceId,
        body: {
          client_id: clientId ? Number(clientId) : undefined,
          barn_id: barnId ? Number(barnId) : undefined,
          customer_name: client?.name || 'عميل نقدي',
          payment_method: (!clientId || payment_method === 'cash') ? 'cash' : 'آجل',
          paid_amount: Math.round(effectivePaidAmount),
          register_deferred: remainingUnpaid > 0 ? effectiveRegisterDeferred : false,
          immediate_payment_method: effectivePaidAmount > 0 ? immediateMethod : undefined,
          due_date: dueDate.trim() || undefined,
          discount_amount: discountAmount > 0 ? Math.round(discountAmount * 100) / 100 : undefined,
          notes: notes.trim() || undefined,
          items: itemPayload,
          ...(isSuperAdmin && superAdminOutsideEditWindow
            ? {
              edit_override_reason:
                editOverrideReason.trim() || 'super_admin_outside_edit_window',
            }
            : {}),
        },
      })
      return
    }
    if (clientId) {
      addRecentClient(Number(clientId))
    }
    createMutation.mutate({
      client_id: clientId ? Number(clientId) : undefined,
      barn_id: barnId ? Number(barnId) : undefined,
      warehouse_id: Number(warehouseId),
      customer_name: client?.name || 'عميل نقدي',
      payment_method: (!clientId || payment_method === 'cash') ? 'cash' : 'آجل',
      paid_amount: Math.round(effectivePaidAmount),
      register_deferred: remainingUnpaid > 0 ? effectiveRegisterDeferred : false,
      immediate_payment_method: effectivePaidAmount > 0 ? immediateMethod : undefined,
      due_date: dueDate.trim() || undefined,
      discount_amount: discountAmount > 0 ? Math.round(discountAmount * 100) / 100 : undefined,
      notes: notes.trim() || undefined,
      items: itemPayload,
    })
  }

  const pickClient = (c: Client) => {
    setClientId(String(c.id))
    setBarnId('')
    setClientSearch('')
    setClientListOpen(false)
  }

  const clearClient = () => {
    setClientId('')
    setBarnId('')
    setClientSearch('')
    setClientListOpen(true)
    setTimeout(() => clientSearchInputRef.current?.focus(), 0)
  }

  const handleQuickCash = () => {
    setClientId('')
    setBarnId('')
    setClientSearch('')
    setPaymentMethod('cash')
    setPaidAmount(0)
    setRegisterDeferred(false)
    barcodeInputRef.current?.focus()
  }

  const selectedClient = clients.find((c) => String(c.id) === clientId)

  if (isEdit && invoiceEditLoading) {
    return (
      <div className="space-y-4 w-full max-w-full animate-pulse" dir="rtl">
        <div className="h-8 w-56 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-40 bg-gray-200 dark:bg-gray-700 rounded-xl" />
      </div>
    )
  }
  if (isEdit && !invoiceToEdit) {
    return (
      <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200" dir="rtl">
        لم يُعثر على الفاتورة.
      </div>
    )
  }

  if (invoiceCancelled) {
    return (
      <div className="space-y-4 w-full max-w-full" dir="rtl">
        <h1 className="text-xl font-bold">فاتورة #{editInvoiceId}</h1>
        <p className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border border-red-100 dark:border-red-900">
          هذه الفاتورة ملغاة ولا يمكن تعديلها. يمكنك عرضها من{' '}
          <Link to={`/invoices/${editInvoiceId}`} className="underline font-medium">
            صفحة التفاصيل
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 w-full max-w-full min-w-0" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">
          {isEdit ? `تعديل فاتورة #${editInvoiceId}` : 'فاتورة بيع جديدة'}
        </h1>
      </div>

      {structuralEditBlocked && (
        <p className="text-sm text-amber-900 dark:text-amber-100 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          انتهت مدة التعديل المسموح بها ({editWindowDaysUi} يوم من تاريخ الإنشاء). لا يمكن حفظ
          تعديلات الأصناف هنا — لإرجاع منتج استخدم زر المرتجع من صفحة الفاتورة.
        </p>
      )}

      {superAdminOutsideEditWindow && (
        <div className="space-y-2 text-sm text-amber-900 dark:text-amber-100 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <p>
            تنبيه: انتهت مدة التعديل العادية لهذه الفاتورة. أنت تعدّل بصلاحية المدير العام — سجّل
            سبب التعديل (اختياري):
          </p>
          <textarea
            value={editOverrideReason}
            onChange={(e) => setEditOverrideReason(e.target.value)}
            rows={2}
            placeholder="سبب التعديل خارج النافذة الزمنية (اختياري)"
            className="w-full rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className={structuralEditBlocked ? 'pointer-events-none opacity-60 space-y-6' : 'space-y-6'}>
          {notice && (
            <FeedbackBanner type="warning" message={notice} />
          )}
          {error && <FeedbackBanner type="error" message={error} />}

          <AddClientModal
            open={addClientOpen}
            onClose={() => setAddClientOpen(false)}
            onSubmit={async (d) => {
              await createClientMutation.mutateAsync({
                name: d.name,
                phone: d.phone || null,
                location: d.location || null,
                initial_debt: d.initial_debt,
              })
            }}
          />

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4 space-y-3 shadow-sm transition-all duration-200">
            <div className="flex items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700/50 pb-2.5 mb-1.5">
              <h2 className="flex items-center gap-2 text-[11px] font-black text-gray-700 dark:text-gray-300 uppercase tracking-widest">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-[10px]">١</div>
                <Users className="w-3.5 h-3.5" />
                <span>العميل والمخزن</span>
              </h2>
              {!isEdit && (
                <button
                  type="button"
                  onClick={handleQuickCash}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-[10px] font-black hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors border border-green-200 dark:border-green-800 uppercase tracking-tighter"
                >
                  <Zap className="w-3 h-3 fill-current" />
                  <span>نقدي سريع</span>
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    العميل {payment_method === 'cash' ? '(اختياري)' : '*'}
                  </label>
                  {!isEdit && (
                    <button
                      type="button"
                      onClick={() => setAddClientOpen(true)}
                      className="inline-flex items-center gap-1 text-xs sm:text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>إضافة عميل</span>
                    </button>
                  )}
                </div>
                {isEdit ? (
                  <div className="px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800/80 border-gray-300 dark:border-gray-600 text-sm">
                    <span className="font-medium">{selectedClient?.name ?? invoiceToEdit?.customer_name ?? '—'}</span>
                    {selectedClient?.phone && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">{selectedClient.phone}</span>
                    )}
                  </div>
                ) : (
                  <div ref={clientPickerRef} className="relative">
                    {selectedClient && !clientListOpen ? (
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            'flex-1 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800/80',
                            'border-gray-300 dark:border-gray-600'
                          )}
                        >
                          <span className="font-medium truncate">{selectedClient.name}</span>
                          {selectedClient.phone && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                              {selectedClient.phone}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={clearClient}
                          className="shrink-0 px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          تغيير
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                          <input
                            ref={clientSearchInputRef}
                            type="search"
                            value={clientSearch}
                            onChange={(e) => {
                              setClientSearch(e.target.value)
                              setClientListOpen(true)
                            }}
                            onFocus={() => setClientListOpen(true)}
                            placeholder="ابحث بالاسم أو رقم الهاتف..."
                            autoComplete="off"
                            className={cn(
                              'w-full py-1.5 ps-9 pe-3 rounded-lg border bg-white dark:bg-gray-900',
                              'border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 text-sm outline-none'
                            )}
                          />
                        </div>
                        {clientListOpen && (
                          <ul
                            className={cn(
                              'absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border shadow-lg',
                              'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 py-1 text-sm'
                            )}
                          >
                            {filteredClients.length === 0 ? (
                              <li className="px-3 py-2 text-gray-500 dark:text-gray-400">
                                لا يوجد عميل مطابق. جرّب بحثاً آخر أو أضف عميلاً جديداً.
                              </li>
                            ) : (
                              filteredClients.map((c, ci) => (
                                <li key={c.id}>
                                  {/* Recent clients divider */}
                                  {!clientSearch.trim() && ci === 0 && recentIds.includes(c.id) && (
                                    <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold text-primary-500 dark:text-primary-400 uppercase tracking-wider">آخر العملاء</div>
                                  )}
                                  {!clientSearch.trim() && ci > 0 && recentIds.includes(filteredClients[ci - 1]?.id) && !recentIds.includes(c.id) && (
                                    <div className="border-t border-gray-200 dark:border-gray-600 my-1" />
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => pickClient(c)}
                                    className="w-full text-right px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700/80 flex flex-col gap-0.5"
                                  >
                                    <span className="font-medium">{c.name}</span>
                                    {c.phone && (
                                      <span className="text-xs text-gray-500 dark:text-gray-400">{c.phone}</span>
                                    )}
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                        )}
                        {clients.length > 120 && !clientSearch.trim() && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            عرض أول 120 عميلاً — استخدم البحث لعرض البقية.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
                  العنبر{barns.length > 0 ? ' *' : ''}
                </label>
                <select
                  value={barnId}
                  onChange={(e) => setBarnId(e.target.value)}
                  disabled={!clientId || isEdit}
                  required={barns.length > 0}
                  className={cn(
                    'w-full px-3 py-1.5 text-sm rounded-lg border bg-white dark:bg-gray-900',
                    'border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none',
                    (!clientId || isEdit) && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  <option value="">{barns.length > 0 ? '— اختر العنبر —' : '— بدون عنبر —'}</option>
                  {barns.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">المخزن *</label>
                <select
                  ref={warehouseSelectRef}
                  value={warehouseId}
                  onChange={(e) => {
                    const id = e.target.value
                    setWarehouseId(id)
                    setProductSearch('')
                    try {
                      if (id) localStorage.setItem(LAST_WAREHOUSE_KEY, id)
                      else localStorage.removeItem(LAST_WAREHOUSE_KEY)
                    } catch { /* ignore */ }
                  }}
                  disabled={isEdit}
                  className={cn(
                    'w-full px-3 py-1.5 text-sm rounded-lg border bg-white dark:bg-gray-900',
                    'border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none',
                    isEdit && 'opacity-60 cursor-not-allowed'
                  )}
                  required
                >
                  <option value="">— اختر المخزن —</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name_ar}</option>
                  ))}
                </select>
                {effectivePendingBarcode.trim() && !warehouseId && (
                  <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                    تم مسح رمز دفعة أو شكارة (أو باركود). اختر المخزن أولاً — سيُضاف الصنف تلقائياً بعد التحميل،
                    أو أعد المسح من حقل «مسح البيع» أدناه.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4 space-y-3 shadow-sm transition-all duration-200">
            <h2 className="flex items-center gap-2 text-[11px] font-black text-gray-700 dark:text-gray-300 uppercase tracking-widest border-b border-gray-100 dark:border-gray-700/50 pb-2.5 mb-1.5">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-[10px]">٢</div>
              <Wallet className="w-3.5 h-3.5" />
              <span>الدفع والملاحظات</span>
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
              <div className="lg:col-span-4 space-y-1.5">
                <label className="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">طريقة الدفع</label>
                <div className="flex p-1 bg-gray-100 dark:bg-gray-800/50 rounded-xl w-full border border-gray-200 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg transition-all font-bold text-xs',
                      payment_method === 'cash'
                        ? 'bg-white dark:bg-gray-700 text-green-600 dark:text-green-400 shadow-sm ring-1 ring-black/5'
                        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    )}
                  >
                    <Banknote className="w-3.5 h-3.5" />
                    <span>كاش</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('credit')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg transition-all font-bold text-xs',
                      payment_method === 'credit'
                        ? 'bg-white dark:bg-gray-700 text-amber-600 dark:text-amber-400 shadow-sm ring-1 ring-black/5'
                        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    )}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>آجل</span>
                  </button>
                </div>
              </div>

              {payment_method === 'cash' && (
                <div className="lg:col-span-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">المدفوع (ج.م)</label>
                    <button
                      type="button"
                      onClick={() => setPaidAmount(Math.round(finalTotal))}
                      className="text-[10px] font-bold text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      دفع كامل المبلغ
                    </button>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={paid_amount || ''}
                    onChange={(e) => setPaidAmount(Number(e.target.value) || 0)}
                    className={cn(
                      'w-full px-3 py-1.5 text-sm rounded-lg border bg-white dark:bg-gray-900',
                      'border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none'
                    )}
                    placeholder="0"
                  />
                </div>
              )}

              <div className={cn('space-y-1.5', payment_method === 'cash' ? 'lg:col-span-5' : 'lg:col-span-8')}>
                <label className="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">ملاحظات</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات إضافية على الفاتورة..."
                  className={cn(
                    'w-full px-3 py-1.5 text-sm rounded-lg border bg-white dark:bg-gray-900',
                    'border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none resize-none'
                  )}
                  rows={1}
                />
              </div>
            </div>

            {payment_method === 'cash' && paid_amount > 0 && (
              <div className="pt-2 border-t border-gray-100 dark:border-gray-700/50">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1 space-y-1.5">
                    <label className="block text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider">طريقة السداد الفوري</label>
                    <div className="flex gap-2">
                      {(['cash', 'vodafone_cash', 'instapay'] as const).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setImmediateMethod(method)}
                          className={cn(
                            'flex-1 py-1.5 px-3 rounded-lg border text-xs font-bold transition-all',
                            immediateMethod === method
                              ? 'bg-primary-50 border-primary-500 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
                              : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300'
                          )}
                        >
                          {method === 'cash' ? 'نقدي' : method === 'vodafone_cash' ? 'فودافون كاش' : 'انستاباي'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {items.length > 0 && (
              <div className="rounded-xl border border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/20 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                  {payment_method === 'credit' ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-gray-400 uppercase">المبلغ الآجل:</span>
                      <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{formatCurrency(finalTotal)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-gray-400 uppercase">المتبقي:</span>
                        <span className={cn('text-sm font-bold', remainingUnpaid > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600')}>
                          {formatCurrency(remainingUnpaid)}
                        </span>
                      </div>
                      {remainingUnpaid > 0 && (
                        <label className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={registerDeferred}
                            onChange={(e) => setRegisterDeferred(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-xs font-bold text-gray-600 dark:text-gray-400 group-hover:text-primary-600 transition-colors">تسجيل كآجل</span>
                        </label>
                      )}
                    </>
                  )}
                  <div className="flex items-center gap-3 border-r border-gray-200 dark:border-gray-700 pr-6">
                    <label className="text-[10px] font-black text-gray-400 uppercase whitespace-nowrap">تاريخ الاستحقاق:</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="bg-transparent text-xs font-bold text-gray-700 dark:text-gray-300 focus:outline-none focus:text-primary-600"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 sm:p-4 space-y-3 shadow-sm transition-all duration-200">
            <h2 className="flex items-center gap-2 text-[11px] font-black text-gray-700 dark:text-gray-300 uppercase tracking-widest border-b border-gray-100 dark:border-gray-700/50 pb-2.5 mb-1.5">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-[10px]">٣</div>
              <Package className="w-3.5 h-3.5" />
              <span>الأصناف</span>
            </h2>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1.5 text-gray-600 dark:text-gray-400">
                امسح كود المنتج أو اكتب رقم الدفعة (B/G)
              </label>
              <div className="relative group">
                <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
                <input
                  ref={barcodeInputRef}
                  type="text"
                  data-scanner-input="true"
                  lang="en"
                  dir="ltr"
                  inputMode="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      e.stopPropagation()
                      void handleBarcodeSubmit()
                    }
                  }}
                  placeholder="B7 / G15 / supplier barcode..."
                  className={cn(
                    'w-full py-3 ps-4 sm:ps-16 pe-10 rounded-xl border-2 bg-gray-50 dark:bg-gray-900/50 text-left font-mono text-lg transition-all',
                    'border-gray-200 dark:border-gray-800 focus:bg-white dark:focus:bg-gray-900 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 outline-none'
                  )}
                />
                <div className="absolute start-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                   <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] font-mono border border-gray-200 dark:border-gray-600">Enter ↵</kbd>
                </div>
              </div>
              {scanError && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2 font-medium flex items-center gap-1">
                   <X className="w-4 h-4" />
                   {scanError}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] gap-6 min-w-0">
              {showProductList && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 min-w-0 max-w-full">
                  <div className="flex items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700/50 pb-2 mb-3">
                    <h3 className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.2em]">
                      منتجات المخزن
                    </h3>
                  </div>
                  <div className="relative mb-3">
                    <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="search"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="بحث في منتجات المخزن..."
                      className={cn(
                        'w-full py-2 ps-11 pe-3 rounded-lg border bg-white dark:bg-gray-800',
                        'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500 text-sm'
                      )}
                    />
                  </div>
                  <ul className="max-h-72 overflow-y-auto space-y-2 text-sm pr-1">
                    {warehouseProductsSortedForPicker.map(({ product, stock }) => {
                      const inInvoice = items.some((i) => i.product_id === product.id)
                      const pBatches = batchesByProduct.get(product.id)
                      const nearest = pBatches?.[0]
                      return (
                        <li
                          key={product.id}
                          className="flex flex-col gap-2 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 hover:border-primary-300 dark:hover:border-primary-700 transition-all shadow-sm"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-gray-900 dark:text-gray-100 truncate">{product.name}</p>
                              <p className="text-[10px] text-gray-500 font-mono">#{product.id}</p>
                              {nearest && nearest.expiry_date !== '9999-12-31' && (
                                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                                  تنتهي: {formatExpiryMonth(nearest.expiry_date)}
                                </p>
                              )}
                            </div>
                            <div className="text-left shrink-0">
                              <p className={cn(
                                "text-xs font-bold",
                                stock === 0 ? "text-red-500" : "text-primary-600 dark:text-primary-400"
                              )}>
                                {product.unit_type === 'bulk' ? `${formatNumber(stock, 2)} كجم` : formatNumber(stock, 0)}
                              </p>
                              <p className="text-[10px] text-gray-400">مخزون</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => addProductToInvoice({ product, stock })}
                            className={cn(
                              "w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors",
                              inInvoice 
                                ? "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800 hover:bg-primary-100 dark:hover:bg-primary-900/40"
                                : "bg-primary-600 text-white hover:bg-primary-700 shadow-sm shadow-primary-200 dark:shadow-none"
                            )}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            {inInvoice ? 'أضف المزيد' : 'إضافة للفاتورة'}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {!productSearch.trim() && topSellingRows.length > 0 && (
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2 font-medium">
                      يتم عرض أفضل ١٠ منتجات مبيعاً لتسريع التحميل — استخدم البحث للوصول لبقية الأصناف.
                    </p>
                  )}
                  {filteredWarehouseProducts.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
                      {productSearch.trim() ? 'لا توجد نتائج للبحث.' : 'لا توجد منتجات.'}
                    </p>
                  )}
                </div>
              )}

              <div className={showProductList ? 'min-w-0' : 'xl:col-span-2 min-w-0'}>
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase flex items-center gap-2">
                    أصناف الفاتورة
                    {items.length > 0 && (
                      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-[11px] font-bold tabular-nums">
                        {items.length} {items.length === 1 ? 'صنف' : items.length <= 10 ? 'أصناف' : 'صنف'}
                        {' · '}
                        {formatNumber(items.reduce((s, r) => s + r.quantity, 0), 0)} وحدة
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {items.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('هل تريد حذف جميع الأصناف من الفاتورة؟')) {
                            setItems([])
                          }
                        }}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:underline"
                      >
                        <X className="w-3.5 h-3.5" /> مسح الكل
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (warehouseId && productsWithStock.length > 0) handleAddRow()
                        else if (!warehouseId) warehouseSelectRef.current?.focus()
                        else if (productsWithStock.length === 0) setError('لا توجد منتجات في المخزون. أضف منتجات أولاً.')
                      }}
                      title={!warehouseId ? 'اختر المخزن أولاً' : undefined}
                      className={cn(
                        'flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:underline',
                        'disabled:opacity-50 cursor-pointer',
                        !warehouseId && 'opacity-70'
                      )}
                    >
                      <Plus className="w-4 h-4" /> إضافة صنف
                    </button>
                  </div>
                </div>
                {warehouseId && productsWithStock.length === 0 && (
                  <p className="text-sm text-amber-600 dark:text-amber-400 mb-2">
                    لا توجد منتجات مسجلة. أضف منتجات من صفحة المخزون أولاً.
                  </p>
                )}
                <div className="responsive-table-container min-w-0">
                  {/* Table for Desktop */}
                  <table className="hidden sm:table w-full min-w-[36rem] border-collapse text-xs sm:text-sm table-fixed">
                    <colgroup>
                      <col style={{ width: '3%' }} />
                      <col style={{ width: '39%' }} />
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '20%' }} />
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '6%' }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                        <th className="py-2 sm:py-2.5 px-0.5" scope="col" aria-label="ترتيب">
                          <span className="sr-only">ترتيب</span>
                        </th>
                        <th className="text-right py-2 sm:py-2.5 px-1.5 sm:px-3 min-w-[12rem] font-medium">المنتج</th>
                        <th className="text-right py-2 sm:py-2.5 px-1 sm:px-2 font-medium">
                          <span className="hidden sm:inline">{qtyColumnLabels.full}</span>
                          <span className="sm:hidden">{qtyColumnLabels.short}</span>
                        </th>
                        <th
                          className="text-right py-2 sm:py-2.5 px-1 sm:px-2 font-medium md:whitespace-nowrap"
                          title="سعر الوحدة"
                        >
                          <span className="md:hidden">سعر</span>
                          <span className="hidden md:inline">سعر الوحدة</span>
                        </th>
                        <th className="text-right py-2 sm:py-2.5 px-1 sm:px-2 font-medium">
                          <span className="hidden sm:inline">الإجمالي</span>
                          <span className="sm:hidden">إجمالي</span>
                        </th>
                        <th className="py-2 sm:py-2.5 px-0.5 text-center" scope="col" aria-label="حذف">
                          <span className="sr-only">حذف</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody ref={itemsTableRef}>
                      {items.map((row, index) => {
                        const breakdown = row.quantity > 0 ? getFefoBreakdown(row.product_id, row.quantity) : []
                        const pEntries = productsWithStock.find((p) => p.product.id === row.product_id)
                        const isBulkProduct = pEntries?.product.unit_type === 'bulk'

                        const productBatches = batchesByProduct.get(row.product_id) ?? []
                        const activeBatches = productBatches.filter((b) =>
                          b.unit_type === 'bulk' ? (b.kg_remaining ?? 0) > 0 : (b.quantity ?? 0) > 0
                        )
                        const earliestExpiry = activeBatches[0]?.expiry_date || '9999-12-31'
                        const currentExpiry = row.batch_expiry || '9999-12-31'
                        const hasNearerExpiry = currentExpiry > earliestExpiry

                        return (
                          <tr
                            key={index}
                            draggable
                            onDragStart={() => handleDragStart(index)}
                            onDragEnter={() => handleDragEnter(index)}
                            onDragEnd={handleDragEnd}
                            onDragOver={handleDragOver}
                            className={cn(
                              'border-b border-gray-100 dark:border-gray-700 transition-opacity',
                              dragActiveIndex === index && 'opacity-40'
                            )}
                          >
                            <td className="py-2 px-0.5 align-middle text-center cursor-grab active:cursor-grabbing">
                              <GripVertical className="w-4 h-4 text-gray-300 dark:text-gray-600 mx-auto" />
                            </td>
                            <td className="py-2 px-1.5 sm:px-3 align-top min-w-[12rem]">
                              <div className="flex items-start gap-2.5 min-w-0">
                                {pEntries?.product.image_url ? (
                                  <img
                                    src={pEntries.product.image_url}
                                    alt=""
                                    className="h-9 w-9 shrink-0 rounded object-cover border border-gray-200 dark:border-gray-700 bg-white mt-0.5"
                                  />
                                ) : (
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 mt-0.5">
                                    <Package className="h-4.5 w-4.5" />
                                  </div>
                                )}
                                <div className="space-y-1 min-w-0 flex-1">
                                  {isBulkProduct && (
                                    <span className="inline-block text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded font-bold">منتج بالوزن (كجم)</span>
                                  )}
                                  <p
                                    className="text-xs sm:text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug text-right break-words [overflow-wrap:anywhere]"
                                    title={row.product_name}
                                  >
                                    {row.product_name}
                                  </p>
                                  {row.bag_id ? (
                                    <div className="mt-1 flex items-center gap-1 flex-wrap">
                                      <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 rounded-full">
                                        شكارة #{row.bag_id}
                                      </span>
                                      {row.batch_id != null && (
                                        <span className="text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 px-1.5 py-0.5 rounded-full">
                                          دفعة #{row.batch_id}
                                        </span>
                                      )}
                                      {row.batch_expiry && (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          صلاحية: {formatExpiryMonth(row.batch_expiry)}
                                        </span>
                                      )}
                                      {row.batch_stock != null && (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          (متاح: {formatNumber(row.batch_stock, 2)} كجم)
                                        </span>
                                      )}
                                    </div>
                                  ) : row.batch_id ? (
                                    <div className="mt-1 flex flex-col gap-1">
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <span className="text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 px-1.5 py-0.5 rounded-full">
                                          دفعة #{row.batch_id}
                                        </span>
                                        {row.batch_expiry && (
                                          <span className="text-xs text-gray-500 dark:text-gray-400">
                                            صلاحية: {formatExpiryMonth(row.batch_expiry)}
                                          </span>
                                        )}
                                        {row.batch_stock != null && (
                                          <span className="text-xs text-gray-500 dark:text-gray-400">
                                            (متاح: {row.batch_stock})
                                          </span>
                                        )}
                                      </div>
                                      {hasNearerExpiry && (
                                        <p className="text-[10px] sm:text-xs text-amber-600 dark:text-amber-400 font-medium">
                                          {getNearExpiryWarning(earliestExpiry)}
                                        </p>
                                      )}
                                    </div>
                                  ) : (breakdown.length > 0 ? (() => {
                                    const distinctPrices = [...new Set(
                                      breakdown.map(b => b.selling_price).filter((p): p is number => p != null && p > 0)
                                    )]
                                    return (
                                      <div className="mt-1 space-y-1">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3">
                                          {breakdown.map((b, i) => (
                                            <span key={i}>
                                              {b.take}× صلاحية {formatExpiry(b.expiry_date)}
                                              {b.selling_price != null && b.selling_price > 0 
                                                ? ` @ ${b.selling_price}` 
                                                : ` @ ${pEntries?.product.selling_price} (افتراضي)`}
                                            </span>
                                          ))}
                                        </div>
                                        {distinctPrices.length > 1 && (
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-xs text-gray-400">اختر السعر:</span>
                                            {distinctPrices.map((p) => (
                                              <button
                                                key={p}
                                                type="button"
                                                onClick={() => handleUnitPriceChange(index, p)}
                                                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${row.unit_price === p
                                                    ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-400 text-primary-700 dark:text-primary-300 font-medium'
                                                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600'
                                                  }`}
                                              >
                                                {p}
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })() : null)}
                                </div>
                              </div>
                            </td>
                            <td className="py-2 px-1 sm:px-2 align-top min-w-0">
                              {isBulkProduct ? (
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-1">
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      inputMode="decimal"
                                      enterKeyHint="done"
                                      max={
                                        row.batch_stock != null
                                          ? bulkInputDisplayValue(row.batch_stock, row.bulk_input_unit)
                                          : row.stock > 0
                                            ? bulkInputDisplayValue(row.stock, row.bulk_input_unit)
                                            : undefined
                                      }
                                      value={bulkInputDisplayValue(row.quantity, row.bulk_input_unit)}
                                      onChange={(e) => {
                                        const raw = Number(e.target.value) || 0
                                        const u = row.bulk_input_unit ?? 'kg'
                                        const kg = u === 'gram' ? raw / 1000 : raw
                                        handleQuantityChange(index, kg)
                                      }}
                                      className={cn(
                                        'w-full min-w-[4rem] max-w-[7rem] px-1 sm:px-2 py-1 sm:py-1.5 rounded border bg-white dark:bg-gray-800 text-xs sm:text-sm tabular-nums transition-all',
                                        row.batch_stock != null && row.quantity > row.batch_stock
                                          ? 'border-red-500 dark:border-red-400 ring-2 ring-red-500/20'
                                          : 'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
                                      )}
                                    />
                                    <select
                                      value={row.bulk_input_unit ?? 'kg'}
                                      onChange={(e) => {
                                        const u = e.target.value as 'kg' | 'gram'
                                        setItems((prev) => {
                                          const next = [...prev]
                                          next[index] = { ...next[index], bulk_input_unit: u }
                                          return next
                                        })
                                      }}
                                      className="text-xs sm:text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1 px-1"
                                    >
                                      <option value="kg">كيلو</option>
                                      <option value="gram">جرام</option>
                                    </select>
                                  </div>
                                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                    = {formatNumber(row.quantity, 3)} كيلو
                                  </p>
                                </div>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  inputMode="decimal"
                                  enterKeyHint="done"
                                  max={row.batch_stock != null ? row.batch_stock : (row.stock > 0 ? row.stock : undefined)}
                                  value={row.quantity}
                                  onChange={(e) => handleQuantityChange(index, Number(e.target.value) || 0)}
                                  className={cn(
                                    'w-full min-w-[5.5rem] max-w-full px-1 sm:px-2 py-1 sm:py-1.5 rounded border bg-white dark:bg-gray-800 text-xs sm:text-sm tabular-nums transition-all',
                                    row.batch_stock != null && row.quantity > row.batch_stock
                                      ? 'border-red-500 dark:border-red-400 ring-2 ring-red-500/20'
                                      : 'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
                                  )}
                                />
                              )}
                              {row.batch_stock != null && row.quantity > row.batch_stock && (
                                <p className="text-xs text-red-500 mt-0.5">الكمية المطلوبة تتجاوز المخزون المتاح في هذه الدفعة (متاح: {row.batch_stock})</p>
                              )}
                            </td>
                            <td className="py-2 px-1 sm:px-2 align-top min-w-0">
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={row.unit_price === 0 ? '' : row.unit_price}
                                onChange={(e) => handleUnitPriceChange(index, Number(e.target.value) || 0)}
                                placeholder="0"
                                title="سعر الوحدة (قابل للتعديل)"
                                className="w-full min-w-0 max-w-full px-1 sm:px-2 py-1 sm:py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs sm:text-sm tabular-nums"
                              />
                            </td>
                            <td className="py-2 px-1 sm:px-2 align-top font-medium tabular-nums text-xs sm:text-sm break-words text-right leading-tight">{formatCurrency(row.total_price)}</td>
                            <td className="py-2 px-0.5 align-top text-center min-w-0">
                              <button
                                type="button"
                                onClick={() => removeRow(index)}
                                className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                aria-label="حذف الصنف"
                                title="حذف الصنف"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {/* Mobile View: Cards */}
                  <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-700">
                    {items.map((row, index) => {
                      const isBulkProduct =
                        productsWithStock.find((p) => p.product.id === row.product_id)?.product.unit_type === 'bulk'

                      const productBatches = batchesByProduct.get(row.product_id) ?? []
                      const activeBatches = productBatches.filter((b) =>
                        b.unit_type === 'bulk' ? (b.kg_remaining ?? 0) > 0 : (b.quantity ?? 0) > 0
                      )
                      const earliestExpiry = activeBatches[0]?.expiry_date || '9999-12-31'
                      const currentExpiry = row.batch_expiry || '9999-12-31'
                      const hasNearerExpiry = currentExpiry > earliestExpiry

                      return (
                        <div
                          key={index}
                          draggable
                          onDragStart={() => handleDragStart(index)}
                          onDragEnter={() => handleDragEnter(index)}
                          onDragEnd={handleDragEnd}
                          onDragOver={handleDragOver}
                          className={cn(
                            'p-3 space-y-3 transition-opacity',
                            dragActiveIndex === index && 'opacity-40'
                          )}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex items-start gap-1 min-w-0">
                              <div className="pt-1 cursor-grab active:cursor-grabbing shrink-0 touch-none">
                                <GripVertical className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                              </div>
                              <div className="flex gap-3 min-w-0">
                                {(() => {
                                  const p = productsWithStock.find((p) => p.product.id === row.product_id)?.product
                                  return p?.image_url ? (
                                    <img
                                      src={p.image_url}
                                      alt=""
                                      className="h-10 w-10 shrink-0 rounded object-cover border border-gray-200 dark:border-gray-700 bg-white"
                                    />
                                  ) : (
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400">
                                      <Package className="h-5 w-5" />
                                    </div>
                                  )
                                })()}
                                <div className="min-w-0">
                                  {isBulkProduct && (
                                    <span className="inline-block text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded font-bold mb-1">منتج بالوزن</span>
                                  )}
                                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight">
                                    {row.product_name}
                                  </p>
                                  {(row.bag_id || row.batch_id) && (
                                    <div className="mt-1 flex flex-col gap-1">
                                      <div className="flex flex-wrap gap-1">
                                        {row.bag_id && <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">شكارة #{row.bag_id}</span>}
                                        {row.batch_id && <span className="text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full">دفعة #{row.batch_id}</span>}
                                      </div>
                                      {row.batch_id && hasNearerExpiry && (
                                        <p className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">
                                          {getNearExpiryWarning(earliestExpiry)}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setItems((p) => p.filter((_, i) => i !== index))}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-1 block">
                                {qtyColumnLabels.short}
                              </label>
                              {isBulkProduct ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    step={row.bulk_input_unit === 'gram' ? 1 : 0.001}
                                    value={bulkInputDisplayValue(row.quantity, row.bulk_input_unit)}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value) || 0
                                      const kg = row.bulk_input_unit === 'gram' ? val / 1000 : val
                                      handleQuantityChange(index, kg)
                                    }}
                                    className={cn(
                                      'w-full px-2 py-1 text-sm rounded border bg-white dark:bg-gray-800 transition-all',
                                      row.batch_stock != null && row.quantity > row.batch_stock
                                        ? 'border-red-500 dark:border-red-400 ring-2 ring-red-500/20'
                                        : 'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
                                    )}
                                  />
                                  <select
                                    value={row.bulk_input_unit}
                                    onChange={(e) => {
                                      const next = e.target.value as 'kg' | 'gram'
                                      setItems((prev) => {
                                        const n = [...prev]
                                        n[index] = { ...n[index], bulk_input_unit: next }
                                        return n
                                      })
                                    }}
                                    className="text-xs px-1 py-1 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900"
                                  >
                                    <option value="kg">كجم</option>
                                    <option value="gram">جم</option>
                                  </select>
                                </div>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  value={row.quantity || ''}
                                  onChange={(e) => handleQuantityChange(index, parseInt(e.target.value, 10) || 0)}
                                  className={cn(
                                    'w-full px-2 py-1 text-sm rounded border bg-white dark:bg-gray-800 font-bold transition-all',
                                    row.batch_stock != null && row.quantity > row.batch_stock
                                      ? 'border-red-500 dark:border-red-400 ring-2 ring-red-500/20'
                                      : 'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-primary-500'
                                  )}
                                />
                              )}
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold mb-1 block">سعر الوحدة</label>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={row.unit_price || ''}
                                onChange={(e) => handleUnitPriceChange(index, parseFloat(e.target.value) || 0)}
                                className="w-full px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-bold text-primary-600 dark:text-primary-400"
                              />
                            </div>
                          </div>
                          <div className="flex justify-between items-center py-1 bg-primary-50/50 dark:bg-primary-900/10 px-2 rounded-lg">
                            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">الإجمالي:</span>
                            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatCurrency(row.total_price)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>


                  {items.length > 0 && (
                    <div className="p-3 sm:p-4 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-200 dark:border-gray-700 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:justify-end gap-3 sm:gap-6 sm:items-center">
                        <span className="text-sm sm:text-base font-medium">المجموع: {formatCurrency(totalAmount)}</span>
                        <div className="flex items-center gap-2">
                          <label className="text-xs sm:text-sm font-bold text-gray-500 dark:text-gray-400 uppercase">خصم</label>
                          <select
                            value={discountType}
                            onChange={(e) => setDiscountType(e.target.value as 'amount' | 'percent')}
                            className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-primary-500"
                          >
                            <option value="amount">ج.م</option>
                            <option value="percent">%</option>
                          </select>
                          <input
                            type="number"
                            min={0}
                            max={discountType === 'percent' ? 100 : undefined}
                            step={discountType === 'percent' ? 1 : 0.01}
                            value={discountValue || ''}
                            onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
                            placeholder={discountType === 'percent' ? '%' : '0'}
                            className="w-24 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-bold focus:ring-2 focus:ring-primary-500"
                          />
                          {discountAmount > 0 && (
                            <span className="text-red-600 dark:text-red-400 text-sm font-bold">
                              − {formatCurrency(discountAmount)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-end pt-2 border-t border-gray-200 dark:border-gray-600 sm:border-0">
                        <span className="text-lg sm:text-xl font-black text-primary-600 dark:text-primary-400">
                          الإجمالي النهائي: {formatCurrency(finalTotal)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>


        </div>

        {/* Docked Actions Bar - Fixed to absolute screen bottom */}
        <div className="fixed bottom-0 left-0 right-0 md:right-[var(--sidebar-width)] z-30 px-4 sm:px-8 py-3 sm:py-6 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 shadow-[0_-20px_60px_rgba(0,0,0,0.15)] print:hidden rounded-t-[1.5rem] sm:rounded-t-[2.5rem]">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 max-w-7xl mx-auto">
            <div className="flex items-center justify-between sm:justify-start gap-4 sm:gap-10 w-full sm:w-auto border-b sm:border-b-0 border-gray-100 dark:border-gray-800 pb-2 sm:pb-0">
              <div className="flex flex-row items-center sm:flex-col sm:items-start gap-2 sm:gap-0.5">
                <span className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">الإجمالي:</span>
                <span className="text-xl sm:text-3xl font-black text-primary-600 dark:text-primary-400 tabular-nums leading-none">
                  {formatCurrency(finalTotal)}
                </span>
              </div>
              
              <div className="hidden sm:block h-10 w-px bg-gray-200 dark:bg-gray-700" />
              
              <div className="flex items-center gap-4 sm:gap-6 text-[10px] sm:text-[11px]">
                <div className="flex flex-col items-center sm:items-start">
                  <span className="text-gray-400 font-medium">الأصناف</span>
                  <span className="text-gray-900 dark:text-gray-100 font-bold leading-tight">{items.length}</span>
                </div>
                {payment_method === 'credit' && (
                  <div className="flex flex-col items-center sm:items-start border-r border-gray-200 dark:border-gray-700 pr-4 sm:pr-6">
                    <span className="text-gray-400 font-medium">الدفع</span>
                    <span className="text-amber-600 dark:text-amber-400 font-bold leading-tight">آجل</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex-1 sm:flex-none px-6 py-3 sm:py-4 text-xs sm:text-sm font-bold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg sm:rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-all active:scale-95 border border-transparent"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={
                  structuralEditBlocked ||
                  createMutation.isPending ||
                  updateMutation.isPending ||
                  items.length === 0 ||
                  (!clientId && payment_method !== 'cash') ||
                  !warehouseId ||
                  (isEdit && !formHydrated)
                }
                className={cn(
                  'flex-1 sm:flex-none px-8 sm:px-12 py-3 sm:py-4 text-xs sm:text-base font-black text-white rounded-lg sm:rounded-2xl shadow-xl transition-all active:scale-95',
                  (items.length === 0 || createMutation.isPending || updateMutation.isPending || structuralEditBlocked || (!clientId && payment_method !== 'cash') || !warehouseId)
                    ? 'bg-gray-300 dark:bg-gray-800 cursor-not-allowed shadow-none grayscale opacity-50'
                    : 'bg-primary-600 hover:bg-primary-700 shadow-primary-500/30 hover:shadow-primary-500/50'
                )}
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>جاري الحفظ...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-6 h-6" />
                    <span>{isEdit ? 'حفظ التعديلات' : 'إتمام البيع وحفظ الفاتورة'}</span>
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
        {/* Spacer to prevent fixed footer from covering form content */}
        <div className="h-32 sm:h-24" aria-hidden="true" />
      </form>

      {/* Batch Picker Modal */}
      {batchPickerProduct && (
        <BatchPickerModal
          open={batchPickerOpen}
          onClose={() => {
            setBatchPickerOpen(false)
            setBatchPickerProduct(null)
          }}
          productName={batchPickerProduct.name}
          productSellingPrice={batchPickerProduct.selling_price}
          productPurchasePrice={batchPickerProduct.purchase_price}
          batches={batchPickerBatches}
          warehouseNames={Object.fromEntries(warehouses.map((w) => [w.id, w.name_ar]))}
          onSelect={handleBatchSelected}
        />
      )}

      <SuccessOverlay
        open={!!invoiceSuccess}
        title={
          invoiceSuccess?.kind === 'created'
            ? 'تم إنشاء الفاتورة بنجاح'
            : invoiceSuccess
              ? 'تم حفظ التعديلات بنجاح'
              : ''
        }
        subtitle="جاري التوجيه…"
        durationMs={1700}
        onComplete={() => {
          if (!invoiceSuccess) return
          if (invoiceSuccess.kind === 'created') {
            navigate('/invoices')
          } else {
            navigate(`/invoices/${invoiceSuccess.id}`)
          }
          setInvoiceSuccess(null)
        }}
      />
    </div>
  )
}
