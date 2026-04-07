/** Labels for the invoice line quantity column (bulk = weight in kg, piece = count). */

export type UnitKind = 'bulk' | 'piece'

export function quantityColumnLabels(unitTypes: UnitKind[]): { full: string; short: string } {
  if (unitTypes.length === 0) {
    return { full: 'الكمية / الوزن', short: 'كمية/وزن' }
  }
  const bulkCount = unitTypes.filter((u) => u === 'bulk').length
  if (bulkCount === unitTypes.length) {
    return { full: 'الوزن', short: 'وزن' }
  }
  if (bulkCount === 0) {
    return { full: 'الكمية', short: 'كمية' }
  }
  return { full: 'الكمية / الوزن', short: 'كمية/وزن' }
}

/** Uses `product_unit_type` from API invoice items (GET invoice join). */
export function quantityColumnHeaderFromInvoiceItems(
  items: { product_unit_type?: string | null }[]
): string {
  const unitTypes: UnitKind[] = items.map((i) =>
    i.product_unit_type === 'bulk' ? 'bulk' : 'piece'
  )
  return quantityColumnLabels(unitTypes).full
}

export function quantityColumnLabelsForInvoiceNewRows(
  rows: { product_id: number }[],
  productsWithStock: { product: { id: number; unit_type: string } }[]
): { full: string; short: string } {
  const unitTypes: UnitKind[] = rows.map((row) => {
    const p = productsWithStock.find((x) => x.product.id === row.product_id)
    return p?.product.unit_type === 'bulk' ? 'bulk' : 'piece'
  })
  return quantityColumnLabels(unitTypes)
}
