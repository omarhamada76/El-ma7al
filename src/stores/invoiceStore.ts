import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getProductByBarcode } from '@/api/products'
import { extractProductBarcodeForLookup } from '@/lib/barcodeLookup'
import type { Product as ApiProduct } from '@/types/api'
import type { Product } from '@/types/product'

interface InvoiceLineItem {
  product: Product
  quantity: number
}

interface InvoiceStoreState {
  lineItems: InvoiceLineItem[]
  addProductByBarcode: (barcode: string) => Promise<void>
  incrementQuantity: (productId: string) => void
  decrementQuantity: (productId: string) => void
  removeLineItem: (productId: string) => void
  clearInvoice: () => void
}

function mapApiProduct(apiProduct: ApiProduct): Product {
  return {
    id: String(apiProduct.id),
    name: apiProduct.name,
    barcode: apiProduct.barcode || '',
    price: Number(apiProduct.selling_price || 0),
    unit_type: apiProduct.unit_type,
  }
}

export const useInvoiceStore = create<InvoiceStoreState>()(
  persist(
    (set) => ({
      lineItems: [],

      addProductByBarcode: async (barcode) => {
        const trimmed = extractProductBarcodeForLookup(barcode)
        if (!trimmed) return

        const found = await getProductByBarcode(trimmed)
        if (!found) {
          throw new Error(
            `Product not found for barcode "${trimmed}". ` +
              `Check that the product's Barcode field matches the physical label exactly, ` +
              `or use the New Invoice screen for batch (B…) and bag (G…) labels.`
          )
        }

        const mapped = mapApiProduct(found)
        set((state) => {
          const existing = state.lineItems.find((li) => li.product.id === mapped.id)
          if (existing) {
            return {
              lineItems: state.lineItems.map((li) =>
                li.product.id === mapped.id ? { ...li, quantity: li.quantity + 1 } : li
              ),
            }
          }
          return {
            lineItems: [...state.lineItems, { product: mapped, quantity: 1 }],
          }
        })
      },

      incrementQuantity: (productId) =>
        set((state) => ({
          lineItems: state.lineItems.map((li) =>
            li.product.id === productId ? { ...li, quantity: li.quantity + 1 } : li
          ),
        })),

      decrementQuantity: (productId) =>
        set((state) => ({
          lineItems: state.lineItems
            .map((li) => (li.product.id === productId ? { ...li, quantity: li.quantity - 1 } : li))
            .filter((li) => li.quantity > 0),
        })),

      removeLineItem: (productId) =>
        set((state) => ({
          lineItems: state.lineItems.filter((li) => li.product.id !== productId),
        })),

      clearInvoice: () => set({ lineItems: [] }),
    }),
    {
      name: 'vet-pharmacy-quick-invoice',
      partialize: (state) => ({ lineItems: state.lineItems }),
    }
  )
)
