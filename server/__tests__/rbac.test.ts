import {
  canViewFinancials,
  canManageProductBatches,
  canCancelFullInvoice,
  isStaffRole,
} from '../../src/lib/roles'

describe('Role-based permissions', () => {
  it('super_admin has financial access', () => {
    expect(canViewFinancials('super_admin')).toBe(true)
  })

  it('admin has financial access', () => {
    expect(canViewFinancials('admin')).toBe(true)
  })

  it('staff has no financial access', () => {
    expect(canViewFinancials('staff')).toBe(false)
  })

  it('only finance roles can manage product batches', () => {
    expect(canManageProductBatches('super_admin')).toBe(true)
    expect(canManageProductBatches('admin')).toBe(true)
    expect(canManageProductBatches('staff')).toBe(false)
  })

  it('only finance roles can cancel full invoices', () => {
    expect(canCancelFullInvoice('super_admin')).toBe(true)
    expect(canCancelFullInvoice('admin')).toBe(true)
    expect(canCancelFullInvoice('staff')).toBe(false)
  })

  it('isStaffRole identifies only staff role', () => {
    expect(isStaffRole('staff')).toBe(true)
    expect(isStaffRole('admin')).toBe(false)
    expect(isStaffRole('super_admin')).toBe(false)
    expect(isStaffRole(undefined)).toBe(false)
  })
})
