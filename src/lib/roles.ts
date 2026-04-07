/** Full financial / admin areas (reports, safe, suppliers ledger, statements, settings markup, user admin). */
export function canViewFinancials(role?: string | null): boolean {
  return role === 'super_admin' || role === 'admin'
}

/** Inline batch edit (prices, quantities, add/delete batch) on product edit — not موظف. */
export function canManageProductBatches(role?: string | null): boolean {
  return canViewFinancials(role)
}

/** Shown in sidebar for operational daily work (includes موظف). */
export function isStaffRole(role?: string | null): boolean {
  return role === 'staff'
}

/** Full invoice cancellation (soft cancel + safe reversal) — admin / super_admin only. */
export function canCancelFullInvoice(role?: string | null): boolean {
  return canViewFinancials(role)
}
