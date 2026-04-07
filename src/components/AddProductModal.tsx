import { useState, useEffect, useRef } from 'react'
import Modal from './Modal'
import type { InitialBatchEntry } from '@/api/products'
import InitialProductBatchesEditor, {
  type InitialBatchUiRow,
  buildInitialBatchesPayload,
  findFirstDuplicateBatchPair,
} from './InitialProductBatchesEditor'

const ADD_PRODUCT_WAREHOUSE_KEY = 'vet-pharmacy-add-product-warehouse'

function getStoredWarehouseId(): number | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const s = localStorage.getItem(ADD_PRODUCT_WAREHOUSE_KEY)
    if (s == null || s === '') return undefined
    const n = Number(s)
    return Number.isInteger(n) ? n : undefined
  } catch {
    return undefined
  }
}

function setStoredWarehouseId(id: number) {
  try {
    localStorage.setItem(ADD_PRODUCT_WAREHOUSE_KEY, String(id))
  } catch {}
}

export type WarehouseOption = { id: number; name_ar: string }

/** @deprecated Legacy bulk-only rows; mapped server-side to initial_batches */
export type InitialBulkStockRow = {
  warehouse_id: number
  bag_count: number
  has_open_bag: boolean
  open_kg_remaining: number | null
}

export type ProductFormData = {
  name: string
  company: string
  category: string
  purchase_price: number
  selling_price: number
  alert_level: number
  /** Bulk products: threshold in kg (optional). */
  alert_level_kg?: number | null
  barcode: string
  unit_type?: 'piece' | 'bulk'
  bag_weight_kg?: number | null
  notes: string
  warehouse_id?: number
  /** Optional opening stock: one row per physical batch on shelf */
  initial_batches?: InitialBatchEntry[]
}

interface AddProductModalProps {
  open: boolean
  onClose: () => void
  categoryOptions?: string[]
  warehouseOptions?: WarehouseOption[]
  /** When set (e.g. from ReceiptNew), overrides localStorage for this open */
  initialWarehouseId?: number
  /** When set, form is in edit mode (prefilled, title "تعديل منتج", warehouse not required) */
  initialValues?: Partial<ProductFormData> | null
  onSubmit: (data: ProductFormData) => Promise<void>
}

const OTHER_CATEGORY = '__other__'

const defaultForm: ProductFormData = {
  name: '',
  company: '',
  category: '',
  purchase_price: 0,
  selling_price: 0,
  alert_level: 0,
  barcode: '',
  unit_type: 'piece',
  bag_weight_kg: null,
  notes: '',
}

export default function AddProductModal({
  open,
  onClose,
  categoryOptions = [],
  warehouseOptions = [],
  initialWarehouseId,
  initialValues,
  onSubmit,
}: AddProductModalProps) {
  const isEdit = !!initialValues
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [categorySelect, setCategorySelect] = useState('')
  const [categoryOther, setCategoryOther] = useState('')
  const category = categorySelect === OTHER_CATEGORY ? categoryOther : categorySelect
  const setCategory = (v: string) => {
    if (categorySelect === OTHER_CATEGORY) setCategoryOther(v)
    else setCategorySelect(v)
  }
  const [warehouseId, setWarehouseId] = useState<number | ''>(() =>
    initialWarehouseId != null ? initialWarehouseId : getStoredWarehouseId() ?? ''
  )
  const [purchase_price, setPurchasePrice] = useState<number | ''>('')
  const [selling_price, setSellingPrice] = useState<number | ''>('')
  const [alert_level, setAlertLevel] = useState<number | ''>('')
  const [alert_level_kg, setAlertLevelKg] = useState<number | ''>('')
  const [barcode, setBarcode] = useState('')
  const [unit_type, setUnitType] = useState<'piece' | 'bulk'>('piece')
  const [bag_weight_kg, setBagWeightKg] = useState<number | ''>('')
  const [initialBatchRows, setInitialBatchRows] = useState<InitialBatchUiRow[]>([])
  const createModalOpenRef = useRef(false)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const errorBannerRef = useRef<HTMLDivElement>(null)
  const errorBottomRef = useRef<HTMLDivElement>(null)
  const [barcodeSaveWarning, setBarcodeSaveWarning] = useState('')

  useEffect(() => {
    if (!open) return
    if (initialValues) {
      setName(initialValues.name ?? '')
      setCompany(initialValues.company ?? '')
      const cat = initialValues.category ?? ''
      if (categoryOptions.includes(cat)) {
        setCategorySelect(cat)
        setCategoryOther('')
      } else {
        setCategorySelect(cat ? OTHER_CATEGORY : '')
        setCategoryOther(cat)
      }
      setPurchasePrice(initialValues.purchase_price ?? '')
      setSellingPrice(initialValues.selling_price ?? '')
      setAlertLevel(initialValues.alert_level ?? '')
      setAlertLevelKg(initialValues.alert_level_kg ?? '')
      setBarcode(initialValues.barcode ?? '')
      setUnitType(initialValues.unit_type ?? 'piece')
      setBagWeightKg(initialValues.bag_weight_kg ?? '')
      setNotes(initialValues.notes ?? '')
    } else {
      setName('')
      setCompany('')
      setCategorySelect('')
      setCategoryOther('')
      setPurchasePrice('')
      setSellingPrice('')
      setAlertLevel('')
      setAlertLevelKg('')
      setBarcode('')
      setUnitType('piece')
      setBagWeightKg('')
      setNotes('')
    }
    setBarcodeSaveWarning('')
  }, [open, initialValues, categoryOptions])

  useEffect(() => {
    if (!open) {
      createModalOpenRef.current = false
      return
    }
    if (isEdit) return
    const justOpened = !createModalOpenRef.current
    createModalOpenRef.current = true
    if (justOpened) {
      setInitialBatchRows([])
    }
  }, [open, isEdit])

  useEffect(() => {
    const bc = barcode.trim()
    if (bc && !bc.startsWith('PRD-')) {
      setBarcodeSaveWarning('')
    }
  }, [barcode])

  useEffect(() => {
    if (!open) return
    const next = initialWarehouseId != null ? initialWarehouseId : getStoredWarehouseId()
    setWarehouseId(next ?? '')
  }, [open, initialWarehouseId])

  useEffect(() => {
    if (!open) setError('')
  }, [open])

  useEffect(() => {
    if (!error) return
    const el = errorBottomRef.current ?? errorBannerRef.current
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [error])

  const handleWarehouseChange = (id: number | '') => {
    setWarehouseId(id)
    if (typeof id === 'number') setStoredWarehouseId(id)
  }

  /** Hide duplicate product-level prices when user is entering per-batch prices. */
  const hideStandaloneProductPrices =
    !isEdit && warehouseOptions.length > 0 && initialBatchRows.length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('اسم المنتج مطلوب')
      return
    }
    const whId = warehouseId === '' ? undefined : warehouseId
    if (!isEdit && warehouseOptions.length > 0 && (whId == null || !Number.isInteger(whId))) {
      setError('اختر المخزن (اجهور أو شبرا)')
      return
    }
    if (!isEdit && unit_type === 'bulk' && warehouseOptions.length === 0) {
      setError('جاري تحميل المخازن… أعد المحاولة أو حدّث الصفحة')
      return
    }
    const kpb = bag_weight_kg === '' ? 0 : Number(bag_weight_kg)
    if (unit_type === 'bulk') {
      if (!Number.isFinite(kpb) || kpb <= 0) {
        setError('أدخل وزن الشكارة بالكيلو')
        return
      }
    }
    let initialBatchesPayload: InitialBatchEntry[] = []
    if (!isEdit && warehouseOptions.length > 0) {
      const built = buildInitialBatchesPayload(
        initialBatchRows,
        unit_type,
        unit_type === 'bulk' ? kpb : null
      )
      if (!built.ok) {
        setError(built.error)
        return
      }
      if (initialBatchRows.length > 0 && built.batches.length === 0) {
        setError(
          'أكمل بيانات كل دفعة (المخزن والأسعار والكمية) أو احذف الصفوف الفارغة.'
        )
        return
      }
      initialBatchesPayload = built.batches
      const dup = findFirstDuplicateBatchPair(initialBatchesPayload)
      if (dup) {
        const ok = window.confirm(
          `هذه الدفعة مشابهة للدفعة #${dup.j + 1}، هل تريد المتابعة؟`
        )
        if (!ok) return
      }
    }

    let effectivePurchase: number
    let effectiveSelling: number
    if (initialBatchesPayload.length > 0) {
      effectivePurchase = initialBatchesPayload[0].purchase_price
      effectiveSelling = initialBatchesPayload[0].selling_price
    } else {
      if (purchase_price === '' || selling_price === '') {
        setError('أدخل سعر الشراء وسعر البيع')
        return
      }
      effectivePurchase = Number(purchase_price)
      effectiveSelling = Number(selling_price)
      if (!Number.isFinite(effectivePurchase) || !Number.isFinite(effectiveSelling)) {
        setError('أدخل سعر الشراء وسعر البيع')
        return
      }
    }
    if (effectivePurchase < 0 || effectiveSelling < 0) {
      setError('الأسعار يجب أن تكون ≥ 0')
      return
    }

    const bcTrim = barcode.trim()
    if (!bcTrim || bcTrim.startsWith('PRD-')) {
      setBarcodeSaveWarning(
        'No physical barcode set — scanner lookups will fail for this product'
      )
    } else {
      setBarcodeSaveWarning('')
    }
    setLoading(true)
    try {
      await onSubmit({
        ...defaultForm,
        name: name.trim(),
        company: company.trim() || '',
        category: category.trim() || '',
        purchase_price: effectivePurchase,
        selling_price: effectiveSelling,
        alert_level:
          unit_type === 'bulk' ? 0 : alert_level === '' ? 0 : Number(alert_level),
        alert_level_kg:
          unit_type === 'bulk'
            ? alert_level_kg !== '' && alert_level_kg != null
              ? Number(alert_level_kg)
              : null
            : null,
        barcode: barcode.trim() || '',
        unit_type,
        bag_weight_kg: bag_weight_kg === '' ? null : Number(bag_weight_kg),
        notes: notes.trim() || '',
        ...(!isEdit ? { initial_batches: initialBatchesPayload } : {}),
        ...(warehouseOptions.length > 0 && whId != null && Number.isInteger(whId) ? { warehouse_id: whId } : {}),
      })
      if (!initialValues) {
        setName('')
        setCompany('')
        setCategorySelect('')
        setCategoryOther('')
        setPurchasePrice('')
        setSellingPrice('')
        setAlertLevel('')
        setAlertLevelKg('')
        setInitialBatchRows([])
        setBarcode('')
        setUnitType('piece')
        setBagWeightKg('')
        setNotes('')
      }
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل الحفظ'
      console.error('[AddProductModal] save failed', err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'تعديل منتج' : 'إضافة منتج'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div
            ref={errorBannerRef}
            role="alert"
            aria-live="assertive"
            className="sticky top-0 z-10 p-3 rounded-lg border-2 border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-100 text-sm font-medium shadow-sm"
          >
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium mb-1">اسم المنتج *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            placeholder="اسم المنتج"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">الشركة / الماركة</label>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">الفئة</label>
          {categoryOptions.length > 0 ? (
            <>
              <select
                value={categorySelect}
                onChange={(e) => setCategorySelect(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              >
                <option value="">— اختر الفئة —</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value={OTHER_CATEGORY}>أخرى (أدخل يدوياً)</option>
              </select>
              {categorySelect === OTHER_CATEGORY && (
                <input
                  type="text"
                  value={categoryOther}
                  onChange={(e) => setCategoryOther(e.target.value)}
                  className="w-full mt-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                  placeholder="اسم الفئة"
                />
              )}
            </>
          ) : (
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              placeholder="مثال: مضادات حيوية"
            />
          )}
        </div>
        {warehouseOptions.length > 0 && !isEdit && (
          <div>
            <label className="block text-sm font-medium mb-1">المخزن *</label>
            <select
              value={warehouseId === '' ? '' : warehouseId}
              onChange={(e) => handleWarehouseChange(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              required
            >
              <option value="">— اختر المخزن (اجهور أو شبرا) —</option>
              {warehouseOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name_ar}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-2">نوع الوحدة</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="unit_type"
                  value="piece"
                  checked={unit_type === 'piece'}
                  onChange={(e) => setUnitType(e.target.value as 'piece')}
                  className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <span className="text-sm">قطعة (عبوة، علبة، إلخ)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="unit_type"
                  value="bulk"
                  checked={unit_type === 'bulk'}
                  onChange={(e) => setUnitType(e.target.value as 'bulk')}
                  className="w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <span className="text-sm">بالكيلو (شكاير)</span>
              </label>
            </div>
          </div>
          {unit_type === 'bulk' && (
            <div>
              <label className="block text-sm font-medium mb-1">الوزن الافتراضي للشكارة (كيلو جرام)</label>
              <input
                type="number"
                min={0}
                step="any"
                required={unit_type === 'bulk'}
                value={bag_weight_kg}
                onChange={(e) => setBagWeightKg(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                placeholder="مثال: 25"
              />
              <p className="mt-1 text-xs text-gray-500">سيتم استخدامه كوزن افتراضي عند تسجيل مشتريات جديدة لهذا المنتج.</p>
            </div>
          )}
          {!isEdit && warehouseOptions.length > 0 && (
            <InitialProductBatchesEditor
              unitType={unit_type}
              warehouseOptions={warehouseOptions}
              defaultWarehouseId={warehouseId === '' ? '' : warehouseId}
              defaultPurchasePrice={purchase_price}
              defaultSellingPrice={selling_price}
              defaultBagWeightKg={bag_weight_kg === '' ? null : Number(bag_weight_kg)}
              rows={initialBatchRows}
              onRowsChange={setInitialBatchRows}
            />
          )}
          {hideStandaloneProductPrices && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              أسعار المنتج في القائمة تُستمد من الدفعة الأولى. لإدخال سعر عام بدون دفعات، احذف كل صفوف
              الدفعات أعلاه.
            </p>
          )}
        </div>
        {!hideStandaloneProductPrices && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">سعر الشراء (ج.م)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={purchase_price === '' ? '' : purchase_price}
                onChange={(e) =>
                  setPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">سعر البيع (ج.م)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={selling_price === '' ? '' : selling_price}
                onChange={(e) =>
                  setSellingPrice(e.target.value === '' ? '' : Number(e.target.value))
                }
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            </div>
          </div>
        )}
        {unit_type === 'bulk' ? (
          <div>
            <label className="block text-sm font-medium mb-1">مستوى التنبيه (كيلو)</label>
            <input
              type="number"
              min={0}
              step="any"
              value={alert_level_kg === '' ? '' : alert_level_kg}
              onChange={(e) =>
                setAlertLevelKg(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))
              }
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              placeholder="0 = بدون تنبيه"
            />
            <p className="mt-1 text-xs text-gray-500">يُنذر عندما يصبح إجمالي الكيلو في المخازن أقل من هذا الرقم.</p>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">حد التنبيه (الحد الأدنى للوحدات)</label>
            <input
              type="number"
              min={0}
              value={alert_level === '' ? '' : alert_level}
              onChange={(e) =>
                setAlertLevel(e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0))
              }
              placeholder="0 = بدون تنبيه"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            />
          </div>
        )}
        <div>
          <label
            className="block text-sm font-medium mb-1"
            title="الباركود الخاص بالمورد / المصنع — يُستخدم عند الاستلام"
          >
            الباركود
            <span className="mr-1 text-xs font-normal text-gray-500 dark:text-gray-400 cursor-help" title="الباركود الخاص بالمورد / المصنع — يُستخدم عند الاستلام">
              (مورد)
            </span>
          </label>
          <input
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            title="الباركود الخاص بالمورد / المصنع — يُستخدم عند الاستلام"
            placeholder="باركود العبوة من المصنع — للاستلام فقط"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          />
          {barcodeSaveWarning && (
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1" role="status">
              {barcodeSaveWarning}
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">ملاحظات</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            rows={2}
          />
        </div>
        {error && (
          <div
            ref={errorBottomRef}
            role="status"
            className="p-3 rounded-lg border-2 border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-100 text-sm font-medium"
          >
            {error}
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-lg border border-gray-300 dark:border-gray-600 font-medium touch-manipulation min-h-[44px]">
            إلغاء
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-3 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50 touch-manipulation min-h-[44px]"
          >
            {loading ? 'جاري الحفظ...' : isEdit ? 'تحديث' : 'حفظ'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
