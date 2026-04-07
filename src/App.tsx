import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { canViewFinancials } from '@/lib/roles'
import AuthLayout from '@/layouts/AuthLayout'
import DashboardLayout from '@/layouts/DashboardLayout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Clients from '@/pages/Clients'
import ClientDetail from '@/pages/ClientDetail'
import ClientAccountStatement from '@/pages/ClientAccountStatement'
import BarnDetail from '@/pages/BarnDetail'
import BarnAccountStatement from '@/pages/BarnAccountStatement'
import Inventory from '@/pages/Inventory'
import ProductDetail from '@/pages/ProductDetail'
import Suppliers from '@/pages/Suppliers'
import SupplierDetail from '@/pages/SupplierDetail'
import SupplierPurchaseNew from '@/pages/SupplierPurchaseNew'
import ReceiptNew from '@/pages/ReceiptNew'
import SupplierPaymentNew from '@/pages/SupplierPaymentNew'
import Safe from '@/pages/Safe'
import InvoiceNew from '@/pages/InvoiceNew'
import Invoices from '@/pages/Invoices'
import InvoiceDetail from '@/pages/InvoiceDetail'
import PaymentNew from '@/pages/PaymentNew'
import Payments from '@/pages/Payments'
import Reports from '@/pages/Reports'
import Settings from '@/pages/Settings'
import Users from '@/pages/Users'
import Invoice from '@/pages/Invoice'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** موظف: لا يصل إلى التقارير، الخزنة، الموردين، الإعدادات المالية، كشوف الحساب، إلخ. */
function FinanceOnlyRoute({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role)
  if (!canViewFinancials(role)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
      </Route>
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route
          path="/clients/:id/account-statement"
          element={
            <FinanceOnlyRoute>
              <ClientAccountStatement />
            </FinanceOnlyRoute>
          }
        />
        <Route path="/barns/:id" element={<BarnDetail />} />
        <Route
          path="/barns/:id/account-statement"
          element={
            <FinanceOnlyRoute>
              <BarnAccountStatement />
            </FinanceOnlyRoute>
          }
        />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory/products/:id" element={<ProductDetail />} />
        <Route
          path="/suppliers"
          element={
            <FinanceOnlyRoute>
              <Suppliers />
            </FinanceOnlyRoute>
          }
        />
        <Route
          path="/suppliers/:id"
          element={
            <FinanceOnlyRoute>
              <SupplierDetail />
            </FinanceOnlyRoute>
          }
        />
        <Route
          path="/suppliers/:id/purchases/new"
          element={
            <FinanceOnlyRoute>
              <SupplierPurchaseNew />
            </FinanceOnlyRoute>
          }
        />
        <Route path="/receipt/new" element={<ReceiptNew />} />
        <Route
          path="/supplier-payments/new"
          element={
            <FinanceOnlyRoute>
              <SupplierPaymentNew />
            </FinanceOnlyRoute>
          }
        />
        <Route
          path="/safe"
          element={
            <FinanceOnlyRoute>
              <Safe />
            </FinanceOnlyRoute>
          }
        />
        <Route path="/invoices/new" element={<InvoiceNew />} />
        <Route path="/invoice" element={<Invoice />} />
        <Route path="/invoices/:id/edit" element={<InvoiceNew />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/payments/new" element={<PaymentNew />} />
        <Route path="/payments" element={<Payments />} />
        <Route
          path="/reports"
          element={
            <FinanceOnlyRoute>
              <Reports />
            </FinanceOnlyRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <FinanceOnlyRoute>
              <Settings />
            </FinanceOnlyRoute>
          }
        />
        <Route
          path="/users"
          element={
            <FinanceOnlyRoute>
              <Users />
            </FinanceOnlyRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default App
