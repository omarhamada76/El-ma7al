export interface Product {
  id: string
  name: string
  barcode: string
  price: number
  /** From API — bulk = sold by weight (kg). */
  unit_type?: 'piece' | 'bulk'
}
