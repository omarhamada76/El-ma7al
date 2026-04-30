import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import type { DashboardStats } from '@/types/api'
import { getSalesByCategory, getTopProducts } from '@/api/dashboard'
import { getClients } from '@/api/clients'
import { getSuppliers } from '@/api/suppliers'
import { getInvoices } from '@/api/invoices'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { getProducts } from '@/api/products'

export type KpiInsightKey =
  | 'total_sales'
  | 'total_profit'
  | 'client_debt'
  | 'safe_balance'
  | 'supplier_payable'
  | 'product_count'
  | 'low_stock_count'
  | 'expiring_count'
  | 'unpaid_invoices_count'
  | 'inventory_value_purchase'
  | 'inventory_value_selling'

export function invoicesListHref(opts: { from?: string; to?: string; unpaid?: boolean }): string {
  const q = new URLSearchParams()
  if (opts.from) q.set('from', opts.from)
  if (opts.to) q.set('to', opts.to)
  if (opts.unpaid) q.set('unpaid', '1')
  const s = q.toString()
  return s ? `/invoices?${s}` : '/invoices'
}

export function clientsListHref(sortDebt: boolean): string {
  return sortDebt ? '/clients?sort=debt_desc' : '/clients'
}

export function suppliersListHref(sortBalance: boolean): string {
  return sortBalance ? '/suppliers?sort=balance_desc' : '/suppliers'
}

const titles: Record<KpiInsightKey, string> = {
  total_sales: 'إجمالي المبيعات',
  total_profit: 'إجمالي الأرباح',
  client_debt: 'إجمالي مديونية العملاء',
  safe_balance: 'رصيد الخزنة',
  supplier_payable: 'إجمالي المديونية للموردين',
  product_count: 'عدد المنتجات',
  low_stock_count: 'منتجات منخفضة المخزون',
  expiring_count: 'قاربت على الانتهاء',
  unpaid_invoices_count: 'فواتير غير مسددة',
  inventory_value_purchase: 'قيمة المخزون (شراء)',
  inventory_value_selling: 'قيمة المخزون (بيع)',
}

export interface KpiInsightDrawerProps {
  open: boolean
  onClose: () => void
  kpiKey: KpiInsightKey | null
  stats: DashboardStats | undefined
  periodFrom: string
  periodTo: string
  showFinancials: boolean
}

export default function KpiInsightDrawer({
  open,
  onClose,
  kpiKey,
  stats,
  periodFrom,
  periodTo,
  showFinancials,
}: KpiInsightDrawerProps) {
  const hasPeriod = Boolean(periodFrom && periodTo)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const showSalesBreakdown =
    open && !!kpiKey && (kpiKey === 'total_sales' || kpiKey === 'total_profit') && hasPeriod && showFinancials

  const { data: categories = [], isLoading: catLoading } = useQuery({
    queryKey: ['reports', 'by-category', periodFrom, periodTo, 'kpi-drawer'],
    queryFn: () => getSalesByCategory({ from: periodFrom, to: periodTo }),
    enabled: showSalesBreakdown,
  })

  const { data: topProducts = [], isLoading: prodLoading } = useQuery({
    queryKey: ['reports', 'top-products', periodFrom, periodTo, 'kpi-drawer'],
    queryFn: () => getTopProducts({ from: periodFrom, to: periodTo, limit: 5 }),
    enabled: showSalesBreakdown,
  })

  const showTopClients =
    open &&
    kpiKey === 'client_debt' &&
    showFinancials

  const { data: topClientsData, isLoading: clientsLoading } = useQuery({
    queryKey: ['clients', 'kpi-drawer', 'debt'],
    queryFn: () => getClients({ sort: 'debt_desc', limit: 6 }),
    enabled: showTopClients,
  })

  const showTopSuppliers = open && kpiKey === 'supplier_payable' && showFinancials

  const { data: topSuppliersData, isLoading: supLoading } = useQuery({
    queryKey: ['suppliers', 'kpi-drawer', 'balance'],
    queryFn: () => getSuppliers({ sort: 'balance_desc', limit: 6 }),
    enabled: showTopSuppliers,
  })

  const showUnpaidTeaser = open && kpiKey === 'unpaid_invoices_count'
  const { data: unpaidSample, isLoading: unpaidLoading } = useQuery({
    queryKey: ['invoices', 'kpi-drawer', 'unpaid'],
    queryFn: () => getInvoices({ unpaid: true, limit: 5 }),
    enabled: showUnpaidTeaser,
  })

  const showProductsTeaser = open && (kpiKey === 'product_count' || kpiKey === 'low_stock_count' || kpiKey === 'expiring_count')
  const { data: productsSampleData, isLoading: productsLoading } = useQuery({
    queryKey: ['products', 'kpi-drawer', kpiKey],
    queryFn: () => getProducts({
      low_stock: kpiKey === 'low_stock_count',
      expiring: kpiKey === 'expiring_count',
      limit: 6
    }),
    enabled: showProductsTeaser,
  })

  if (!open || !kpiKey) return null

  const title = titles[kpiKey]
  const topClients = topClientsData?.data ?? []
  const topSuppliers = topSuppliersData?.data ?? []
  const unpaidRows = unpaidSample?.data ?? []
  const productRows = productsSampleData?.data ?? []

  const primaryCta = (() => {
    switch (kpiKey) {
      case 'total_sales':
      case 'total_profit':
        return { to: invoicesListHref({ from: periodFrom, to: periodTo }), label: 'عرض فواتير الفترة' }
      case 'client_debt':
        return { to: clientsListHref(true), label: 'عرض العملاء حسب المديونية' }
      case 'safe_balance':
        return { to: '/safe?focus=activity', label: 'الخزنة وسجل الحركات' }
      case 'supplier_payable':
        return { to: suppliersListHref(true), label: 'عرض الموردين حسب المستحق' }
      case 'product_count':
        return { to: '/inventory', label: 'المخزون' }
      case 'low_stock_count':
        return { to: '/inventory?lowStock=1', label: 'منتجات منخفضة المخزون' }
      case 'expiring_count':
        return { to: '/inventory?expiring=1', label: 'منتجات قاربت على الانتهاء' }
      case 'unpaid_invoices_count':
        return { to: invoicesListHref({ unpaid: true }), label: 'كل الفواتير غير المسددة' }
      case 'inventory_value_purchase':
      case 'inventory_value_selling':
        return { to: '/inventory', label: 'المخزون' }
      default:
        return { to: '/', label: '' }
    }
  })()

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        aria-label="إغلاق"
        onClick={onClose}
      />
      <div
        className={cn(
          'fixed z-50 inset-y-0 end-0 w-full max-w-md shadow-xl',
          'bg-white dark:bg-gray-900 border-s border-gray-200 dark:border-gray-700',
          'flex flex-col animate-in slide-in-from-end-2 duration-200'
        )}
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-drawer-title"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 id="kpi-drawer-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {title}
            </h2>
            {(kpiKey === 'total_sales' || kpiKey === 'total_profit') && hasPeriod && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                المبيعات والأرباح أعلاه للفترة {periodFrom} — {periodTo}
              </p>
            )}
            {kpiKey !== 'total_sales' && kpiKey !== 'total_profit' && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                هذا المؤشر يعكس وضعاً حالياً أو تراكمياً في النظام (ليس مرتبطاً بفترة التقرير فقط).
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label="إغلاق اللوحة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {stats && (
            <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">
              {kpiKey === 'product_count' ||
              kpiKey === 'low_stock_count' ||
              kpiKey === 'expiring_count' ||
              kpiKey === 'unpaid_invoices_count'
                ? String(
                    kpiKey === 'product_count'
                      ? stats.product_count
                      : kpiKey === 'low_stock_count'
                        ? stats.low_stock_count
                        : kpiKey === 'expiring_count'
                          ? stats.expiring_count
                          : stats.unpaid_invoices_count
                  )
                : formatCurrency(
                    kpiKey === 'total_sales'
                      ? stats.total_sales
                      : kpiKey === 'total_profit'
                        ? stats.total_profit
                        : kpiKey === 'client_debt'
                          ? stats.client_debt
                          : kpiKey === 'safe_balance'
                              ? stats.safe_balance
                              : kpiKey === 'inventory_value_purchase'
                                ? stats.inventory_value_purchase ?? 0
                                : kpiKey === 'inventory_value_selling'
                                  ? stats.inventory_value_selling ?? 0
                                  : stats.supplier_payable
                  )}
            </p>
          )}

          {showSalesBreakdown && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">أعلى الفئات (حسب الفترة)</h3>
              {catLoading ? (
                <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ) : categories.length === 0 ? (
                <p className="text-sm text-gray-500">لا بيانات في هذه الفترة.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {categories.slice(0, 5).map((row) => (
                    <li key={row.category} className="flex justify-between gap-2">
                      <span className="text-gray-700 dark:text-gray-300 truncate">{row.category}</span>
                      <span className="font-medium shrink-0">{formatCurrency(row.total_sales)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 pt-2">أعلى المنتجات مبيعاً</h3>
              {prodLoading ? (
                <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ) : topProducts.length === 0 ? (
                <p className="text-sm text-gray-500">لا بيانات في هذه الفترة.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {topProducts.map((row) => (
                    <li key={row.product_id} className="flex justify-between gap-2">
                      <span className="text-gray-700 dark:text-gray-300 truncate">{row.name}</span>
                      <span className="font-medium shrink-0">{formatCurrency(row.total_sales)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {kpiKey === 'total_profit' && (
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  هامش الربح يختلف حسب المنتج؛ راجع تفاصيل كل فاتورة من سجل الفواتير للفترة نفسها.
                </p>
              )}
            </section>
          )}

          {showTopClients && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">أعلى العملاء مديونية</h3>
              {clientsLoading ? (
                <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ) : topClients.length === 0 ? (
                <p className="text-sm text-gray-500">لا عملاء.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {topClients.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <Link
                        to={`/clients/${c.id}`}
                        className="text-primary-600 dark:text-primary-400 hover:underline truncate"
                        onClick={onClose}
                      >
                        {c.name}
                      </Link>
                      <span className="font-medium shrink-0">{formatCurrency(c.balance ?? 0)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {showTopSuppliers && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">أعلى الموردين مستحقات</h3>
              {supLoading ? (
                <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ) : topSuppliers.length === 0 ? (
                <p className="text-sm text-gray-500">لا موردين.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {topSuppliers.map((s) => (
                    <li key={s.id} className="flex justify-between gap-2">
                      <Link
                        to={`/suppliers/${s.id}`}
                        className="text-primary-600 dark:text-primary-400 hover:underline truncate"
                        onClick={onClose}
                      >
                        {s.name}
                      </Link>
                      <span className="font-medium shrink-0">{formatCurrency(s.balance ?? 0)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {showUnpaidTeaser && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">أحدث الفواتير ذات المتبقي</h3>
              {unpaidLoading ? (
                <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ) : unpaidRows.length === 0 ? (
                <p className="text-sm text-gray-500">لا توجد فواتير غير مسددة بالكامل.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {unpaidRows.map((inv) => (
                    <li key={inv.id} className="flex justify-between gap-2">
                      <Link
                        to={`/invoices/${inv.id}`}
                        className="text-primary-600 dark:text-primary-400 hover:underline"
                        onClick={onClose}
                      >
                        #{inv.id} — {inv.customer_name}
                      </Link>
                      <span className="font-medium shrink-0">{formatCurrency(inv.remaining_amount ?? 0)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {showProductsTeaser && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {kpiKey === 'product_count' ? 'قائمة المنتجات' : 'أصناف تحتاج متابعة'}
              </h3>
              {productsLoading ? (
                <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ) : productRows.length === 0 ? (
                <p className="text-sm text-gray-500">لا توجد منتجات مطابقة.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {productRows.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <Link
                        to={`/inventory?search=${encodeURIComponent(p.name)}`}
                        className="text-primary-600 dark:text-primary-400 hover:underline truncate"
                        onClick={onClose}
                      >
                        {p.name}
                      </Link>
                      <span className="font-medium shrink-0 text-gray-500">
                        {p.unit_type === 'bulk' ? `${p.batch_total_quantity || 0} كجم` : `${p.batch_total_quantity || 0} وحدة`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {(kpiKey === 'product_count' || kpiKey === 'low_stock_count' || kpiKey === 'expiring_count') && (
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              {kpiKey === 'product_count' &&
                'العدد الإجمالي للمنتجات في النظام؛ استخدم المخزون للفلترة والتعديل.'}
              {kpiKey === 'low_stock_count' &&
                'المنتجات التي وصلت إلى حد التنبيه أو أقل؛ راجع الكميات والطلبات.'}
              {kpiKey === 'expiring_count' &&
                'منتجات أو دفعات قاربت على الانتهاء؛ راجع قائمة الانتهاء في المخزون.'}
            </p>
          )}

          {kpiKey === 'safe_balance' && showFinancials && (
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              الرصيد الحالي للخزنة من مجموع الحركات المسجّلة؛ افتح سجل الحركات لمطابقة الإيداع والسحب.
            </p>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          {primaryCta.label && (
            <Link
              to={primaryCta.to}
              onClick={onClose}
              className="block w-full text-center py-3 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-700"
            >
              {primaryCta.label}
            </Link>
          )}
        </div>
      </div>
    </>
  )
}
