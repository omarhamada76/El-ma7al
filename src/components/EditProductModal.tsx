import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import Modal from './Modal'
import type { Product, ProductBatch } from '@/types/api'
import type { WarehouseOption } from './AddProductModal'
import InitialProductBatchesEditor, {
  type InitialBatchUiRow,
  buildInitialBatchesPayload,
  findFirstDuplicateBatchPair,
} from './InitialProductBatchesEditor'
import {
  getProductBatches,
  updateProduct,
  patchProductBatch,
  createProductBatch,
  deleteProductBatch,
  seedInitialBulkStockForProduct,
  type InitialBatchEntry,
} from '@/api/products'
import { formatCurrency } from '@/lib/utils'

const OTHER_CATEGORY = '__other__'

function isSentinelExpiry(exp: string | null | undefined): boolean {
  return !exp || exp === '9999-12-31'
}

function expiryToInputValue(exp: string | null | undefined): string {
  return isSentinelExpiry(exp) ? '' : exp!
}

function inputValueToExpiry(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}

export type EditProductModalProps = {
  open: boolean
  onClose: () => void
  product: Product
  categoryOptions?: string[]
  warehouseOptions?: WarehouseOption[]
  canManageBatches: boolean
  isSuperAdmin: boolean
  onProductSaved?: () => void
}

export default function EditProductModal({
  open,
  onClose,
  product,
  categoryOptions = [],
  warehouseOptions = [],
  canManageBatches,
  isSuperAdmin,
  onProductSaved,
}: EditProductModalProps) {
  const queryClient = useQueryClient()
  const productId = product.id
  const productIdKey = String(productId)

  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [categorySelect, setCategorySelect] = useState('')
  const [categoryOther, setCategoryOther] = useState('')
  const [categoryFreeText, setCategoryFreeText] = useState('')
  const category =
    categoryOptions.length === 0
      ? categoryFreeText
      : categorySelect === OTHER_CATEGORY
        ? categoryOther
        : categorySelect
  const [alert_level, setAlertLevel] = useState(0)
  const [alert_level_kg, setAlertLevelKg] = useState<number | ''>('')
  const [unit_type, setUnitType] = useState<'piece' | 'bulk'>('piece')
  const [bag_weight_kg, setBagWeightKg] = useState<number | ''>('')
  const [purchase_price, setPurchasePrice] = useState(0)
  const [selling_price, setSellingPrice] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [productSaving, setProductSaving] = useState(false)
  const [productError, setProductError] = useState('')
  const productErrorBannerRef = useRef<HTMLDivElement>(null)
  const productErrorBottomRef = useRef<HTMLDivElement>(null)
  const [originalUnitType, setOriginalUnitType] = useState<'piece' | 'bulk'>('piece')
  /** New opening batches when there are no server batches yet (piece or bulk). */
  const [initialBatchRows, setInitialBatchRows] = useState<InitialBatchUiRow[]>([])
  const batchDraftResetRef = useRef<{ open: boolean; productId: number | null }>({
    open: false,
    productId: null,
  })

  const { data: editBatches = [], isLoading: batchesLoading } = useQuery({
    queryKey: ['product', productIdKey, 'batches', 'edit', 'includeEmpty'],
    queryFn: () => getProductBatches(productId, undefined, { includeEmpty: true }),
    enabled: open,
  })

  const batchCount = editBatches.length
  /** 0 batches: simple سعر الشراء/البيع in main. 1 batch: defaults + hint. 2+: only in advanced. */
  const noBatchesYet = batchCount === 0
  const showDefaultPricesInMain = batchCount === 1

  useEffect(() => {
    if (!open) return
    setName(product.name ?? '')
    setCompany(product.company ?? '')
    const cat = product.category ?? ''
    if (categoryOptions.length === 0) {
      setCategoryFreeText(cat)
    } else if (categoryOptions.includes(cat)) {
      setCategorySelect(cat)
      setCategoryOther('')
    } else {
      setCategorySelect(cat ? OTHER_CATEGORY : '')
      setCategoryOther(cat)
    }
    setAlertLevel(product.alert_level ?? 0)
    setAlertLevelKg(product.alert_level_kg ?? '')
    const ut = product.unit_type ?? 'piece'
    setUnitType(ut)
    setOriginalUnitType(ut)
    setBagWeightKg(product.bag_weight_kg ?? '')
    setPurchasePrice(product.purchase_price ?? 0)
    setSellingPrice(product.selling_price ?? 0)
    setAdvancedOpen(false)
    setProductError('')
  }, [open, product, categoryOptions])

  useEffect(() => {
    if (!open) setProductError('')
  }, [open])

  useEffect(() => {
    if (!productError) return
    const el = productErrorBottomRef.current ?? productErrorBannerRef.current
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [productError])

  useEffect(() => {
    if (!open) {
      batchDraftResetRef.current.open = false
      return
    }
    if (!noBatchesYet) {
      batchDraftResetRef.current = { open: true, productId }
      return
    }
    const prev = batchDraftResetRef.current
    const justOpened = !prev.open
    const productChanged =
      prev.productId != null && prev.productId !== productId
    batchDraftResetRef.current = { open: true, productId }
    if (justOpened || productChanged) {
      setInitialBatchRows([])
    }
  }, [open, productId, noBatchesYet])

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setProductError('')
    if (!name.trim()) {
      setProductError('اسم المنتج مطلوب')
      return
    }
    if (
      originalUnitType === 'piece' &&
      unit_type === 'bulk' &&
      batchCount > 0 &&
      !window.confirm(
        'تغيير نوع الوحدة سيؤثر على جميع الدُفعات الموجودة. هل أنت متأكد؟'
      )
    ) {
      return
    }
    if (purchase_price < 0 || selling_price < 0) {
      setProductError('الأسعار يجب أن تكون ≥ 0')
      return
    }
    const kpb = bag_weight_kg === '' ? 0 : Number(bag_weight_kg)
    if (unit_type === 'bulk') {
      if (!Number.isFinite(kpb) || kpb <= 0) {
        setProductError('أدخل وزن الشكارة بالكيلو')
        return
      }
    }
    let seedBatches: InitialBatchEntry[] | null = null
    if (noBatchesYet && warehouseOptions.length > 0) {
      const built = buildInitialBatchesPayload(
        initialBatchRows,
        unit_type,
        unit_type === 'bulk' ? kpb : null
      )
      if (!built.ok) {
        setProductError(built.error)
        return
      }
      if (initialBatchRows.length > 0 && built.batches.length === 0) {
        setProductError(
          'أكمل بيانات كل دفعة (المخزن والأسعار والكمية) أو احذف الصفوف الفارغة.'
        )
        return
      }
      if (built.batches.length > 0) {
        const dup = findFirstDuplicateBatchPair(built.batches)
        if (dup) {
          const ok = window.confirm(
            `هذه الدفعة مشابهة للدفعة #${dup.j + 1}، هل تريد المتابعة؟`
          )
          if (!ok) return
        }
        seedBatches = built.batches
      }
    }
    setProductSaving(true)
    try {
      await updateProduct(String(productId), {
        name: name.trim(),
        company: company.trim() || null,
        category: category.trim() || null,
        alert_level: unit_type === 'bulk' ? 0 : alert_level,
        alert_level_kg:
          unit_type === 'bulk'
            ? alert_level_kg !== '' && alert_level_kg != null
              ? Number(alert_level_kg)
              : null
            : null,
        unit_type,
        bag_weight_kg: bag_weight_kg === '' ? null : Number(bag_weight_kg),
        purchase_price,
        selling_price,
      })
      if (seedBatches && seedBatches.length > 0) {
        await seedInitialBulkStockForProduct(productId, { initial_batches: seedBatches })
      }
      queryClient.invalidateQueries({ queryKey: ['product', productIdKey] })
      queryClient.invalidateQueries({ queryKey: ['product', productIdKey, 'batches'] })
      queryClient.invalidateQueries({ queryKey: ['product', productIdKey, 'batches', 'edit'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
      onProductSaved?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل الحفظ'
      console.error('[EditProductModal] save failed', err)
      setProductError(msg)
    } finally {
      setProductSaving(false)
    }
  }

  const defaultPurchaseLabel =
    batchCount === 0
      ? 'سعر الشراء (ج.م)'
      : 'سعر الشراء الافتراضي (ج.م)'
  const defaultSellingLabel =
    batchCount === 0
      ? 'سعر البيع (ج.م)'
      : 'سعر البيع الافتراضي (ج.م)'
  const defaultPriceHint =
    'يُستخدم كقيمة افتراضية عند إنشاء دفعة جديدة'

  return (
    <Modal open={open} onClose={onClose} title="تعديل منتج">
      <div className="space-y-8 max-h-[85vh] overflow-y-auto pe-1" dir="rtl">
        <form onSubmit={handleSaveProduct} className="space-y-4 border-b border-gray-200 dark:border-gray-700 pb-6">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            معلومات المنتج
          </h3>
          {productError && (
            <div
              ref={productErrorBannerRef}
              role="alert"
              aria-live="assertive"
              className="sticky top-0 z-10 p-3 rounded-lg border-2 border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-100 text-sm font-medium shadow-sm"
            >
              {productError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">الاسم *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الشركة</label>
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
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={OTHER_CATEGORY}>أخرى (أدخل يدوياً)</option>
                </select>
                {categorySelect === OTHER_CATEGORY && (
                  <input
                    type="text"
                    value={categoryOther}
                    onChange={(e) => setCategoryOther(e.target.value)}
                    className="w-full mt-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                  />
                )}
              </>
          ) : (
            <input
              type="text"
              value={categoryFreeText}
              onChange={(e) => setCategoryFreeText(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            />
          )}
          </div>
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
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">مستوى تنبيه المخزون (وحدات)</label>
              <input
                type="number"
                min={0}
                value={alert_level}
                onChange={(e) => setAlertLevel(Number(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            </div>
          )}
          <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
            <div>
              <label className="block text-sm font-medium mb-2">نوع الوحدة</label>
              <div className="flex gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="unit_type_edit"
                    value="piece"
                    checked={unit_type === 'piece'}
                    onChange={() => setUnitType('piece')}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">قطعة</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="unit_type_edit"
                    value="bulk"
                    checked={unit_type === 'bulk'}
                    onChange={() => setUnitType('bulk')}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">بالكيلو</span>
                </label>
              </div>
            </div>
            {unit_type === 'bulk' && (
              <div>
                <label className="block text-sm font-medium mb-1">وزن الشكارة الافتراضي (كجم)</label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={bag_weight_kg}
                  onChange={(e) => setBagWeightKg(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                />
              </div>
            )}
          </div>

          {batchCount === 1 && (
            <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-lg">
              يوجد دفعة واحدة حالياً — يمكنك تعديل سعرها مباشرة أدناه.
            </p>
          )}

          {showDefaultPricesInMain && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1" title={defaultPriceHint}>
                  {defaultPurchaseLabel}
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={purchase_price || ''}
                  onChange={(e) => setPurchasePrice(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">{defaultPriceHint}</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" title={defaultPriceHint}>
                  {defaultSellingLabel}
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={selling_price || ''}
                  onChange={(e) => setSellingPrice(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                />
                <p className="text-xs text-gray-500 mt-1">{defaultPriceHint}</p>
              </div>
            </div>
          )}

          {noBatchesYet && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">سعر الشراء (ج.م)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={purchase_price || ''}
                  onChange={(e) => setPurchasePrice(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">سعر البيع (ج.م)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={selling_price || ''}
                  onChange={(e) => setSellingPrice(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                />
              </div>
            </div>
          )}

          {noBatchesYet && warehouseOptions.length > 0 && (
            <InitialProductBatchesEditor
              title="الدُّفعات الحاليّة — مخزون أولي"
              description="دفعة لكل رصيد من مشتريات سابقة؛ اختياري. بدون دفعات يبقى المنتج بدون مخزون حتى الاستلام."
              unitType={unit_type}
              warehouseOptions={warehouseOptions}
              defaultWarehouseId={warehouseOptions[0]?.id ?? ''}
              defaultPurchasePrice={purchase_price}
              defaultSellingPrice={selling_price}
              defaultBagWeightKg={bag_weight_kg === '' ? null : Number(bag_weight_kg)}
              rows={initialBatchRows}
              onRowsChange={setInitialBatchRows}
            />
          )}

          {batchCount > 1 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="w-full text-right px-3 py-2 text-sm font-medium bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {advancedOpen ? '▼' : '◀'} إعدادات متقدمة — أسعار افتراضية للدُفعات الجديدة
              </button>
              {advancedOpen && (
                <div className="p-3 space-y-3 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500">
                    تُستخدم عند إنشاء دفعة يدوية جديدة وليست بديلاً عن أسعار الدُفعات الحالية.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">{defaultPurchaseLabel}</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={purchase_price || ''}
                        onChange={(e) => setPurchasePrice(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">{defaultSellingLabel}</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={selling_price || ''}
                        onChange={(e) => setSellingPrice(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {productError && (
            <div
              ref={productErrorBottomRef}
              role="status"
              className="p-3 rounded-lg border-2 border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-100 text-sm font-medium"
            >
              {productError}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-lg border border-gray-300 dark:border-gray-600 font-medium min-h-[44px]"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={productSaving}
              className="flex-1 py-3 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50 min-h-[44px]"
            >
              {productSaving ? 'جاري الحفظ...' : 'حفظ معلومات المنتج'}
            </button>
          </div>
        </form>

        <section>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
            الدُفعات الحالية
          </h3>
          {batchesLoading ? (
            <p className="text-sm text-gray-500">جاري التحميل...</p>
          ) : (
            <BatchesSection
              product={product}
              batches={editBatches}
              warehouseOptions={warehouseOptions}
              canManageBatches={canManageBatches}
              isSuperAdmin={isSuperAdmin}
              productIdKey={productIdKey}
            />
          )}
        </section>
      </div>
    </Modal>
  )
}

function BatchesSection({
  product,
  batches,
  warehouseOptions,
  canManageBatches,
  isSuperAdmin,
  productIdKey,
}: {
  product: Product
  batches: ProductBatch[]
  warehouseOptions: WarehouseOption[]
  canManageBatches: boolean
  isSuperAdmin: boolean
  productIdKey: string
}) {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const isBulk = product.unit_type === 'bulk'

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['product', productIdKey, 'batches'] })
    queryClient.invalidateQueries({ queryKey: ['product', productIdKey, 'batches', 'edit'] })
    queryClient.invalidateQueries({ queryKey: ['product', productIdKey, 'stock'] })
    queryClient.invalidateQueries({ queryKey: ['product', productIdKey, 'bags'] })
    queryClient.invalidateQueries({ queryKey: ['products'] })
    queryClient.invalidateQueries({ queryKey: ['products', 'warehouse'] })
    queryClient.invalidateQueries({ queryKey: ['warehouse-stock'] })
    queryClient.invalidateQueries({ queryKey: ['warehouse-batches'] })
  }

  if (batches.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          لا توجد دُفعات بعد. يمكن إضافة دفعة يدوياً أو عبر الاستلام.
        </p>
        {canManageBatches &&
          (warehouseOptions.length === 0 ? (
            <p className="text-xs text-amber-600">لا توجد مخازن — أضف مخزناً من الإعدادات أولاً.</p>
          ) : !showAdd ? (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
            >
              + إضافة دفعة يدوياً
            </button>
          ) : (
            <NewBatchForm
              product={product}
              warehouseOptions={warehouseOptions}
              onCancel={() => setShowAdd(false)}
              onCreated={() => {
                invalidate()
                setShowAdd(false)
              }}
            />
          ))}
      </div>
    )
  }

  return (
    <div className="space-y-4 overflow-x-auto">
      <table className="w-full text-sm min-w-[640px] border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
            <th className="text-right py-2 px-2">المخزن</th>
            <th className="text-right py-2 px-2">تاريخ الصلاحية</th>
            {isBulk ? (
              <>
                <th className="text-right py-2 px-2">عدد الشكاير</th>
                <th className="text-right py-2 px-2">وزن الشكارة</th>
                <th className="text-right py-2 px-2">كيلو متبقي</th>
                <th className="text-right py-2 px-2">شراء/كيلو</th>
                <th className="text-right py-2 px-2">بيع/كيلو</th>
              </>
            ) : (
              <>
                <th className="text-right py-2 px-2">الكمية</th>
                <th className="text-right py-2 px-2">سعر الشراء</th>
                <th className="text-right py-2 px-2">سعر البيع</th>
              </>
            )}
            {canManageBatches && <th className="w-24 py-2 px-2" />}
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <BatchRow
              key={b.id}
              batch={b}
              productUnitBulk={isBulk}
              canManage={canManageBatches}
              isSuperAdmin={isSuperAdmin}
              onSaved={invalidate}
            />
          ))}
        </tbody>
      </table>
      {canManageBatches && (
        <div>
          {warehouseOptions.length === 0 ? (
            <p className="text-xs text-amber-600">لا توجد مخازن — أضف مخزناً من الإعدادات أولاً.</p>
          ) : !showAdd ? (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
            >
              + إضافة دفعة يدوياً
            </button>
          ) : (
            <NewBatchForm
              product={product}
              warehouseOptions={warehouseOptions}
              onCancel={() => setShowAdd(false)}
              onCreated={() => {
                invalidate()
                setShowAdd(false)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function BatchRow({
  batch,
  productUnitBulk,
  canManage,
  isSuperAdmin,
  onSaved,
}: {
  batch: ProductBatch
  productUnitBulk: boolean
  canManage: boolean
  isSuperAdmin: boolean
  onSaved: () => void
}) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [expiryInput, setExpiryInput] = useState(() => expiryToInputValue(batch.expiry_date))
  const [qty, setQty] = useState(String(batch.quantity ?? 0))
  const [kgRem, setKgRem] = useState(String(batch.kg_remaining ?? 0))
  const [pp, setPp] = useState(batch.purchase_price != null ? String(batch.purchase_price) : '')
  const [sp, setSp] = useState(batch.selling_price != null ? String(batch.selling_price) : '')
  const [saving, setSaving] = useState(false)
  const [rowErr, setRowErr] = useState('')

  useEffect(() => {
    setExpiryInput(expiryToInputValue(batch.expiry_date))
    setQty(String(batch.quantity ?? 0))
    setKgRem(String(batch.kg_remaining ?? 0))
    setPp(batch.purchase_price != null ? String(batch.purchase_price) : '')
    setSp(batch.selling_price != null ? String(batch.selling_price) : '')
    setRowErr('')
  }, [batch])

  const isExpired =
    batch.expiry_date &&
    !isSentinelExpiry(batch.expiry_date) &&
    batch.expiry_date < todayStr
  const isSentinel = isSentinelExpiry(batch.expiry_date)

  const soldU = batch.sold_units ?? 0
  const pieceStock = batch.quantity ?? 0
  const bulkStock = batch.kg_remaining ?? 0
  const hasStock = productUnitBulk ? bulkStock > 0.0001 : pieceStock > 0
  const canDelete = !hasStock || isSuperAdmin

  const handleSave = async () => {
    setRowErr('')
    const purchaseNum = pp === '' ? null : Number(pp)
    const sellingNum = sp === '' ? null : Number(sp)
    if (purchaseNum != null && (Number.isNaN(purchaseNum) || purchaseNum < 0)) {
      setRowErr('سعر شراء غير صالح')
      return
    }
    if (sellingNum != null && (Number.isNaN(sellingNum) || sellingNum < 0)) {
      setRowErr('سعر بيع غير صالح')
      return
    }

    const expPayload = inputValueToExpiry(expiryInput)

    if (!productUnitBulk) {
      const q = Math.floor(Number(qty))
      if (!Number.isFinite(q) || q < 0) {
        setRowErr('كمية غير صالحة')
        return
      }
      if (q < soldU) {
        window.alert(
          `لا يمكن تقليل الكمية إلى أقل من الكمية المباعة (${soldU} وحدة)`
        )
        return
      }
    } else {
      const kr = Number(kgRem)
      if (!Number.isFinite(kr) || kr < 0) {
        setRowErr('كيلو متبقي غير صالح')
        return
      }
      if (
        kr !== (batch.kg_remaining ?? 0) &&
        !window.confirm('تعديل الكيلوات المتبقية سيؤثر على حسابات المخزون. هل تريد المتابعة؟')
      ) {
        return
      }
    }

    setSaving(true)
    try {
      await patchProductBatch(batch.id, {
        expiry_date: expPayload,
        purchase_price: purchaseNum,
        selling_price: sellingNum,
        ...(productUnitBulk
          ? { kg_remaining: Number(kgRem) }
          : { quantity: Math.floor(Number(qty)) }),
      })
      onSaved()
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : 'فشل الحفظ')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (
      !window.confirm(
        'حذف هذه الدفعة سيؤثر على المخزون. هل أنت متأكد؟'
      )
    ) {
      return
    }
    if (!canDelete) {
      window.alert('لا يمكن الحذف — المخزون غير صفر (يتطلب صلاحية مدير أعلى)')
      return
    }
    setSaving(true)
    setRowErr('')
    try {
      await deleteProductBatch(batch.id)
      onSaved()
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : 'فشل الحذف')
    } finally {
      setSaving(false)
    }
  }

  const whName =
    batch.warehouse_name_ar ?? `مخزن ${batch.warehouse_id}`
  const originalExpiryInput = expiryToInputValue(batch.expiry_date)
  const expiryChanged =
    inputValueToExpiry(expiryInput) !== inputValueToExpiry(originalExpiryInput)

  return (
    <tr
      className={`border-b border-gray-100 dark:border-gray-700 last:border-0 ${
        isExpired ? 'bg-red-50 dark:bg-red-900/10' : ''
      }`}
    >
      <td className="py-2 px-2 align-top">{whName}</td>
      <td className="py-2 px-2 align-top">
        {canManage ? (
          <div>
            <input
              type="date"
              value={expiryInput}
              onChange={(e) => setExpiryInput(e.target.value)}
              onBlur={() => {
                // Auto-save expiry when user leaves the field so it persists
                // even if they use the main product save button afterwards.
                if (!saving && expiryChanged) {
                  void handleSave()
                }
              }}
              className="w-full max-w-[11rem] px-1 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-xs"
            />
            {!expiryInput && (
              <span className="block text-xs text-gray-400 mt-0.5">بدون تاريخ</span>
            )}
          </div>
        ) : isSentinel ? (
          <span className="text-gray-400">بدون تاريخ</span>
        ) : (
          <span className={isExpired ? 'text-red-600 font-medium' : ''}>
            {batch.expiry_date}
            {isExpired && (
              <span className="mr-1 text-xs bg-red-100 dark:bg-red-900/40 px-1 rounded">منتهي</span>
            )}
          </span>
        )}
      </td>
      {productUnitBulk ? (
        <>
          <td className="py-2 px-2 align-top font-medium">{batch.bag_count ?? batch.quantity ?? '—'}</td>
          <td className="py-2 px-2 align-top">{batch.kg_per_bag ?? '—'}</td>
          <td className="py-2 px-2 align-top">
            {canManage ? (
              <div>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={kgRem}
                  onChange={(e) => setKgRem(e.target.value)}
                  className="w-20 px-1 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                />
                <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5 max-w-[8rem]">
                  تعديل الكيلوات المتبقية سيؤثر على حسابات المخزون
                </p>
              </div>
            ) : (
              batch.kg_remaining ?? '—'
            )}
          </td>
          <td className="py-2 px-2 align-top">
            {canManage ? (
              <input
                type="number"
                min={0}
                step={0.01}
                value={pp}
                onChange={(e) => setPp(e.target.value)}
                className="w-24 px-1 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            ) : (
              batch.purchase_price != null ? formatCurrency(batch.purchase_price) : '—'
            )}
          </td>
          <td className="py-2 px-2 align-top">
            {canManage ? (
              <input
                type="number"
                min={0}
                step={0.01}
                value={sp}
                onChange={(e) => setSp(e.target.value)}
                className="w-24 px-1 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            ) : (
              batch.selling_price != null ? formatCurrency(batch.selling_price) : '—'
            )}
          </td>
        </>
      ) : (
        <>
          <td className="py-2 px-2 align-top">
            {canManage ? (
              <div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-16 px-1 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
                />
                {soldU > 0 && (
                  <span className="block text-[10px] text-gray-500">مباع: {soldU}</span>
                )}
              </div>
            ) : (
              <>
                {batch.quantity}
                {soldU > 0 && (
                  <span className="block text-[10px] text-gray-500">مباع: {soldU}</span>
                )}
              </>
            )}
          </td>
          <td className="py-2 px-2 align-top">
            {canManage ? (
              <input
                type="number"
                min={0}
                step={0.01}
                value={pp}
                onChange={(e) => setPp(e.target.value)}
                className="w-24 px-1 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            ) : (
              batch.purchase_price != null ? formatCurrency(batch.purchase_price) : '—'
            )}
          </td>
          <td className="py-2 px-2 align-top">
            {canManage ? (
              <input
                type="number"
                min={0}
                step={0.01}
                value={sp}
                onChange={(e) => setSp(e.target.value)}
                className="w-24 px-1 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            ) : (
              batch.selling_price != null ? formatCurrency(batch.selling_price) : '—'
            )}
          </td>
        </>
      )}
      {canManage && (
        <td className="py-2 px-2 align-top">
          {rowErr && <p className="text-xs text-red-600 mb-1">{rowErr}</p>}
          <div className="flex flex-col gap-1 items-stretch">
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="text-xs py-1 px-2 rounded bg-primary-600 text-white disabled:opacity-50"
            >
              حفظ التغييرات
            </button>
            <button
              type="button"
              disabled={saving || !canDelete}
              onClick={handleDelete}
              title={!canDelete ? 'يتطلب مخزون صفر أو صلاحية مدير أعلى' : ''}
              className="p-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30"
            >
              <Trash2 className="w-4 h-4 mx-auto" />
            </button>
          </div>
        </td>
      )}
    </tr>
  )
}

function NewBatchForm({
  product,
  warehouseOptions,
  onCancel,
  onCreated,
}: {
  product: Product
  warehouseOptions: WarehouseOption[]
  onCancel: () => void
  onCreated: () => void
}) {
  const [warehouse_id, setWarehouseId] = useState<number | ''>(
    warehouseOptions[0]?.id ?? ''
  )
  const [expiryInput, setExpiryInput] = useState('')
  const [quantity, setQuantity] = useState('0')
  const [bag_count, setBagCount] = useState('1')
  const [kg_per_bag, setKgPerBag] = useState(
    String(product.bag_weight_kg ?? '')
  )
  const [kg_remaining, setKgRemaining] = useState('')
  const [pp, setPp] = useState(String(product.purchase_price ?? ''))
  const [sp, setSp] = useState(String(product.selling_price ?? ''))
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const isBulk = product.unit_type === 'bulk'

  const submit = async () => {
    setErr('')
    const wh = warehouse_id === '' ? NaN : Number(warehouse_id)
    if (!Number.isInteger(wh)) {
      setErr('اختر المخزن')
      return
    }
    const body: Record<string, unknown> = {
      warehouse_id: wh,
      expiry_date: expiryInput.trim() === '' ? null : expiryInput.trim(),
      purchase_price: pp === '' ? null : Number(pp),
      selling_price: sp === '' ? null : Number(sp),
    }
    if (isBulk) {
      const bc = Math.max(1, Math.floor(Number(bag_count) || 1))
      const kpb = Math.max(0, Number(kg_per_bag) || 0)
      body.bag_count = bc
      body.kg_per_bag = kpb
      if (kg_remaining.trim() !== '') body.kg_remaining = Number(kg_remaining)
    } else {
      body.quantity = Math.max(0, Math.floor(Number(quantity) || 0))
    }
    setLoading(true)
    try {
      await createProductBatch(product.id, body)
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'فشل الإنشاء')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-3 rounded-lg border border-dashed border-primary-300 dark:border-primary-700 space-y-2 text-sm">
      <p className="font-medium">دفعة جديدة</p>
      {err && <p className="text-red-600 text-xs">{err}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-xs mb-0.5">المخزن</label>
          <select
            value={warehouse_id === '' ? '' : warehouse_id}
            onChange={(e) => setWarehouseId(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          >
            {warehouseOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name_ar}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs mb-0.5">تاريخ الصلاحية</label>
          <input
            type="date"
            value={expiryInput}
            onChange={(e) => setExpiryInput(e.target.value)}
            className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          />
        </div>
        {isBulk ? (
          <>
            <div>
              <label className="block text-xs mb-0.5">عدد الشكاير</label>
              <input
                type="number"
                min={1}
                value={bag_count}
                onChange={(e) => setBagCount(e.target.value)}
                className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs mb-0.5">وزن الشكارة (كجم)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={kg_per_bag}
                onChange={(e) => setKgPerBag(e.target.value)}
                className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs mb-0.5">كيلو متبقي (اختياري)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={kg_remaining}
                onChange={(e) => setKgRemaining(e.target.value)}
                placeholder="افتراضي = عدد الشكاير × الوزن"
                className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              />
            </div>
          </>
        ) : (
          <div>
            <label className="block text-xs mb-0.5">الكمية</label>
            <input
              type="number"
              min={0}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
            />
          </div>
        )}
        <div>
          <label className="block text-xs mb-0.5">سعر الشراء</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={pp}
            onChange={(e) => setPp(e.target.value)}
            className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          />
        </div>
        <div>
          <label className="block text-xs mb-0.5">سعر البيع</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={sp}
            onChange={(e) => setSp(e.target.value)}
            className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-sm"
        >
          إلغاء
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={submit}
          className="px-3 py-1 rounded bg-primary-600 text-white text-sm disabled:opacity-50"
        >
          {loading ? '...' : 'إنشاء الدفعة'}
        </button>
      </div>
    </div>
  )
}
