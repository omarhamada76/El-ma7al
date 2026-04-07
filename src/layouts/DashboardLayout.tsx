import { useState, useCallback } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { useInvoiceStore } from '@/stores/invoiceStore'
import { extractProductBarcodeForLookup } from '@/lib/barcodeLookup'

export default function DashboardLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const addProductByBarcode = useInvoiceStore((s) => s.addProductByBarcode)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'error' | 'info' } | null>(null)

  const showToast = useCallback((message: string, tone: 'error' | 'info' = 'error', durationMs = 2500) => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), durationMs)
  }, [])

  useBarcodeScanner({
    onScan: (barcode) => {
      void (async () => {
        const logical = extractProductBarcodeForLookup(barcode)
        if (/^B\d+$/i.test(logical) || /^G\d+$/i.test(logical)) {
          showToast('Batch/bag label detected — opening full invoice screen', 'info', 3200)
          navigate(`/invoices/new?barcode=${encodeURIComponent(logical)}`)
          return
        }
        // New invoice page: never add to the quick-invoice store (wrong cart). Route through ?barcode=
        // so InvoiceNew runs a single scan — avoids duplicate lines when focus leaves the barcode field.
        if (location.pathname === '/invoices/new') {
          const params = new URLSearchParams(location.search)
          params.set('barcode', logical)
          navigate({ pathname: '/invoices/new', search: params.toString() }, { replace: true })
          return
        }
        try {
          await addProductByBarcode(barcode)
          if (location.pathname !== '/invoice') {
            navigate('/invoice')
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : `Product not found for barcode "${barcode.trim()}"`
          showToast(message, 'error', 6000)
        }
      })()
    },
  })

  return (
    <div className="h-dvh max-h-dvh min-h-0 overflow-hidden flex flex-col bg-gray-50 dark:bg-gray-900 md:flex-row">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen((o) => !o)} />
        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4 md:p-6">
          <Outlet />
        </main>
        {toast && (
          <div
            className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[min(100vw-2rem,42rem)] rounded-lg px-4 py-3 text-sm shadow-lg break-words ${
              toast.tone === 'info'
                ? 'bg-amber-600 text-white'
                : 'bg-red-600 text-white'
            }`}
            role="status"
          >
            {toast.message}
          </div>
        )}
      </div>
    </div>
  )
}
