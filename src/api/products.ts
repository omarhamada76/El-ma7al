import { api } from './client'
import type { Product, ProductWarehouseStock, ProductBatch, BagInstance } from '@/types/api'

export interface ProductsParams {
  page?: number
  limit?: number
  search?: string
  category?: string
  warehouse_id?: number
  low_stock?: boolean
  unpriced?: boolean
  expiring?: boolean
  expired?: boolean
  out_of_stock?: boolean
  ids?: string
  show_archived?: boolean
}

export async function getProducts(params: ProductsParams = {}): Promise<{
  data: Product[]
  total: number
}> {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') q.set(k, String(v))
  })
  const query = q.toString()
  return api.get(`/products${query ? `?${query}` : ''}`)
}

export async function getProduct(id: string): Promise<Product> {
  return api.get(`/products/${id}`)
}

/** Resolve `products.barcode` (supplier packaging). Not used for POS batch labels (B/G). */
export async function getProductByBarcode(barcode: string): Promise<Product | null> {
  const res = await api.get<Product | null>(`/products/by-barcode?barcode=${encodeURIComponent(barcode)}`)
  return res ?? null
}

export async function getProductStock(id: string): Promise<ProductWarehouseStock[]> {
  const res = await api.get<ProductWarehouseStock[]>(`/products/${id}/stock`)
  return Array.isArray(res) ? res : []
}

/** Products that have stock in the given warehouse (for new invoice) */
export async function getProductsWithStockInWarehouse(
  warehouseId: number
): Promise<{ product: Product; stock: number }[]> {
  const res = await api.get<{ product: Product; stock: number }[]>(`/warehouses/${warehouseId}/products-with-stock`)
  return Array.isArray(res) ? res : []
}

/** Stock quantity per product in a warehouse (for inventory page). product_id -> quantity */
export async function getWarehouseStockMap(
  warehouseId: number
): Promise<Record<number, number>> {
  const res = await api.get<Record<number, number>>(`/warehouses/${warehouseId}/stock-map`)
  return res && typeof res === 'object' ? res : {}
}

/** Opening stock rows when creating a product (piece or bulk). */
export interface InitialBatchEntry {
  warehouse_id: number
  expiry_date: string | null
  purchase_price: number
  selling_price: number
  quantity?: number
  bag_count?: number
  kg_per_bag?: number
  has_open_bag?: boolean
  open_kg_remaining?: number | null
}

export async function createProduct(
  body: Partial<Product> & {
    warehouse_id?: number
    initial_batches?: InitialBatchEntry[]
    /** @deprecated Map to initial_batches on the server during migration */
    initial_bulk_stock?: {
      warehouse_id: number
      bag_count: number
      has_open_bag: boolean
      open_kg_remaining: number | null
    }[]
  }
): Promise<Product> {
  return api.post('/products', body)
}

export async function updateProduct(id: string, body: Partial<Product>): Promise<Product> {
  return api.patch(`/products/${id}`, body)
}

/** Opening stock for an existing product with no batches yet (piece or bulk). */
export async function seedInitialBulkStockForProduct(
  id: string | number,
  body: {
    initial_batches?: InitialBatchEntry[]
    /** @deprecated Map on server */
    initial_bulk_stock?: {
      warehouse_id: number
      bag_count: number
      has_open_bag: boolean
      open_kg_remaining: number | null
    }[]
  }
): Promise<Product> {
  return api.post(`/products/${id}/initial-bulk-stock`, body)
}

export async function deleteProduct(id: string, force: boolean = false): Promise<void> {
  return api.delete(`/products/${id}${force ? '?force=true' : ''}`)
}

export async function archiveProduct(id: string): Promise<Product> {
  return updateProduct(id, { is_active: false } as Partial<Product>)
}

export async function restoreProduct(id: string): Promise<Product> {
  return updateProduct(id, { is_active: true } as Partial<Product>)
}

export async function adjustStock(
  id: string,
  body: { warehouse_id: number; quantity_delta: number; reason?: string }
): Promise<void> {
  return api.post(`/products/${id}/stock-adjustment`, body)
}

export async function getProductBatches(
  id: string | number,
  warehouseId?: number,
  opts?: { includeEmpty?: boolean }
): Promise<ProductBatch[]> {
  const q = new URLSearchParams()
  if (warehouseId != null) q.set('warehouse_id', String(warehouseId))
  if (opts?.includeEmpty) q.set('include_empty', '1')
  const qs = q.toString()
  const res = await api.get<ProductBatch[]>(`/products/${id}/batches${qs ? `?${qs}` : ''}`)
  return Array.isArray(res) ? res : []
}

export async function patchProductBatch(
  batchId: number,
  body: Partial<{
    quantity: number
    kg_remaining: number
    purchase_price: number | null
    selling_price: number | null
    expiry_date: string | null
  }>
): Promise<ProductBatch> {
  return api.patch<ProductBatch>(`/batches/${batchId}`, body)
}

export async function createProductBatch(
  productId: string | number,
  body: Record<string, unknown>
): Promise<ProductBatch> {
  return api.post<ProductBatch>(`/products/${productId}/batches`, body)
}

export async function deleteProductBatch(batchId: number): Promise<void> {
  await api.delete(`/products/batches/${batchId}`)
}

export async function getWarehouseBatches(
  warehouseId: number
): Promise<ProductBatch[]> {
  const res = await api.get<ProductBatch[]>(`/warehouses/${warehouseId}/batches`)
  return Array.isArray(res) ? res : []
}

export interface WarehousePickerData {
  productsWithStock: { product: Product; stock: number }[]
  warehouseBatches: ProductBatch[]
  topSellingRows: any[]
}

export async function getWarehousePickerData(
  warehouseId: number
): Promise<WarehousePickerData> {
  const res = await api.get<WarehousePickerData>(`/warehouses/${warehouseId}/picker-data`)
  return res && typeof res === 'object'
    ? res
    : { productsWithStock: [], warehouseBatches: [], topSellingRows: [] }
}


export type ProductBatchLookup =
  | { status: 'ok'; batch: ProductBatch }
  | { status: 'not_found' }
  | { status: 'request_failed'; message: string }

/** Resolve a batch by id when it may be missing from `getWarehouseBatches` (e.g. zero-qty rows filtered server-side). */
export async function lookupProductBatchById(batchId: number): Promise<ProductBatchLookup> {
  try {
    const batch = await api.get<ProductBatch>(`/batches/${batchId}`)
    return { status: 'ok', batch }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/\b404\b|غير موجودة|Not found/i.test(msg)) return { status: 'not_found' }
    return { status: 'request_failed', message: msg }
  }
}

export async function updateBatchSellingPrice(
  batchId: number,
  sellingPrice: number
): Promise<ProductBatch> {
  return patchProductBatch(batchId, { selling_price: sellingPrice })
}

export async function getProductBags(
  id: string | number,
  warehouseId?: number
): Promise<BagInstance[]> {
  const q = warehouseId ? `?warehouse_id=${warehouseId}` : ''
  const res = await api.get<BagInstance[]>(`/products/${id}/bags${q}`)
  return Array.isArray(res) ? res : []
}

export async function getBagInstance(bagId: number): Promise<BagInstance | null> {
  try {
    return await api.get<BagInstance>(`/bag-instances/${bagId}`)
  } catch {
    return null
  }
}
