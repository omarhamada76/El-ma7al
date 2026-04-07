export type UserRole = 'super_admin' | 'admin' | 'staff'

export interface User {
  id: string
  email: string
  display_name: string | null
  role: UserRole
  is_active?: boolean
}

export interface Warehouse {
  id: number
  name_ar: string
  name_en: string | null
  is_active: boolean
}

export interface Client {
  id: number
  name: string
  phone: string | null
  location: string | null
  initial_debt: number
  last_visit: string | null
  total_profit: number
  favorite: boolean
  pinned: boolean
  pinned_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  /** Present when client is loaded from list API (إجمالي حساب العميل) */
  balance?: number
}

export interface Barn {
  id: number
  client_id: number
  name: string
  initial_debt: number
  total_invoices: number
  total_profit: number
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: number
  name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  is_active: boolean
  balance: number
  created_at: string
  updated_at: string
}

export interface Product {
  id: number
  name: string
  company: string | null
  category: string | null
  barcode: string | null
  unit_type: 'piece' | 'bulk'
  bag_weight_kg?: number | null
  purchase_price: number
  selling_price: number
  alert_level: number
  /** When `unit_type === 'bulk'`, low-stock threshold in kilograms (optional). */
  alert_level_kg?: number | null
  expiry_date: string | null
  image_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
  /** Batch-derived price ranges — only present from list endpoint */
  purchase_price_min?: number | null
  purchase_price_max?: number | null
  selling_price_min?: number | null
  selling_price_max?: number | null
  batch_total_quantity?: number | null
  /** From list query — non-empty bag count (bulk). */
  bulk_bag_count?: number | null
  /** From list query — open bag has under 20% remaining (bulk). */
  bulk_open_bag_low?: boolean
}

export interface ProductWarehouseStock {
  product_id: number
  warehouse_id: number
  quantity: number
  updated_at: string
}

export interface ProductBatch {
  id: number
  product_id: number
  warehouse_id: number
  warehouse_name_ar?: string
  expiry_date: string | null
  quantity: number // For bulk: represents bag_count
  unit_type?: 'piece' | 'bulk'
  bag_count?: number | null
  kg_per_bag?: number | null
  kg_remaining?: number | null
  purchase_price: number | null
  selling_price: number | null
  created_at: string
  updated_at: string
  /** From list query joins — units sold from this batch (piece). */
  sold_units?: number
  /** From list query joins — kg sold from bags in this batch (bulk). */
  sold_kg?: number
}

export interface BagInstance {
  id: number
  batch_id: number
  product_id: number
  warehouse_id: number
  warehouse_name_ar?: string
  bag_number: number
  kg_total: number
  kg_remaining: number
  status: 'sealed' | 'open' | 'empty'
  expiry_date: string | null
  opened_at: string | null
  created_at: string
  purchase_price?: number | null
  selling_price?: number | null
}

/** Legacy client-level cycle (no longer started from UI). */
export interface BillingCycle {
  id: number
  client_id: number
  started_at: string
  ended_at: string | null
  carry_in: number
  carryover_out: number | null
  closed_at: string | null
  created_at: string
}

/** Barn-level accounting cycle (العنابر). */
export interface BarnBillingCycle {
  id: number
  barn_id: number
  started_at: string
  ended_at: string | null
  carry_in: number
  carryover_out: number | null
  closed_at: string | null
  created_at: string
}

export interface Invoice {
  id: number
  client_id: number
  barn_id: number | null
  warehouse_id: number
  customer_name: string
  total_amount: number
  paid_amount: number
  remaining_amount: number
  profit_amount: number
  payment_method: string
  /** Optional due date for deferred / overdue tracking (YYYY-MM-DD). */
  due_date?: string | null
  status: string
  /** 'active' | 'cancelled' — separate from payment status in `status`. */
  invoice_lifecycle?: string | null
  /** From GET invoice — configured edit window (days). */
  edit_window_days?: number
  /** From GET invoice — age since creation in fractional days. */
  invoice_age_days?: number
  /** True if created_at is within edit window (independent of role). */
  structural_edit_within_window?: boolean
  /** False for admin/staff when window expired; true for super_admin always. */
  structural_edit_allowed?: boolean
  last_edited_by?: number | null
  last_edited_at?: string | null
  edit_override_reason?: string | null
  notes: string | null
  discount_amount?: number
  billing_cycle_id?: number | null
  barn_billing_cycle_id?: number | null
  created_at: string
  created_by: string | null
}

export interface InvoiceItem {
  id: number
  invoice_id: number
  product_id: number | null
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
  batch_id: number | null
  created_at: string
  sold_from_bag_id?: number | null
  unit_purchase_price?: number | null
  unit_selling_price?: number | null
  batch_expiry_date?: string | null
  batch_warehouse_id?: number | null
  /** From GET invoice join — 'piece' | 'bulk' */
  product_unit_type?: string | null
  /** Original quantity as entered (e.g. 500 when sold in grams). */
  display_quantity?: number | null
  /** 'kg' | 'gram' — how display_quantity should be shown */
  display_unit?: string | null
}

export interface Payment {
  id: number
  client_id: number
  barn_id: number | null
  billing_cycle_id?: number | null
  barn_billing_cycle_id?: number | null
  amount: number
  payment_method: string
  notes: string | null
  payment_date: string
  created_at: string
  created_by: string | null
  invoice_id?: number | null
  wallet_id?: number | null
  settled_at?: string | null
}

export interface SafeTransaction {
  id: number
  type: 'initial' | 'customer_payment_in' | 'supplier_payment_out' | 'adjustment_in' | 'adjustment_out'
  amount: number
  reference_type: string | null
  reference_id: number | null
  notes: string | null
  created_at: string
  created_by: string | null
}

export interface SupplierPurchase {
  id: number
  supplier_id: number
  warehouse_id: number
  total_amount: number
  notes: string | null
  created_at: string
  created_by: string | null
}

export interface SupplierPurchaseItem {
  id: number
  supplier_purchase_id: number
  product_id: number
  quantity: number
  unit_price: number
  total_price: number
  created_at: string
}

/** Item with product name for display (e.g. last purchase invoices) */
export interface SupplierPurchaseItemWithProduct extends SupplierPurchaseItem {
  product_name: string
}

export interface SupplierPurchaseWithItems extends SupplierPurchase {
  items: SupplierPurchaseItemWithProduct[]
}

export interface SupplierPayment {
  id: number
  supplier_id: number
  amount: number
  payment_method: string
  notes: string | null
  payment_date: string
  created_at: string
  created_by: string | null
}

export interface DashboardStats {
  total_sales: number
  total_profit: number
  client_debt: number
  /** إجمالي آجل غير مسدّد (مجموع دفعات payment_method = deferred حيث settled_at فارغ). */
  total_deferred_receivable?: number
  product_count: number
  low_stock_count: number
  expiring_count: number
  unpaid_invoices_count: number
  safe_balance: number
  supplier_payable: number
  /** From local DB — optional when API omits (legacy) */
  clients_count?: number
  invoices_count?: number
}

export interface DailySalesPoint {
  day: string
  total_sales: number
  invoice_count: number
}

export interface AccountStatementRow {
  date: string
  type: 'invoice' | 'payment'
  description: string
  debit: number
  credit: number
  /** عرض مدين/دائن (يشمل سطر آجل بدون إعادة احتساب الرصيد) */
  display_debit?: number
  display_credit?: number
  balance: number
  /** اسم العنبر عند وجود فاتورة/دفعة مرتبطة بعنبر */
  barn_name?: string | null
  /** فاتورة */
  invoice_id?: number
  invoice_total?: number
  paid?: number
  remaining?: number
  status?: string
  items?: { product_name: string; quantity: number }[]
  /** دفعة */
  payment_id?: number
  payment_amount?: number
  payment_method?: string
  settled_at?: string | null
}

export interface AccountStatement {
  opening_balance: number
  closing_balance: number
  rows: AccountStatementRow[]
  /** Present when loaded via billing cycle statement API */
  cycle?: {
    id: number
    client_id?: number
    barn_id?: number
    started_at: string
    ended_at: string | null
    carry_in: number
    carryover_out?: number | null
    label?: string
  }
  /** Period from day after a closed cycle through today */
  after_cycle?: {
    cycle_id: number
    cycle_ended_at: string
    from: string
    to: string
  }
}
