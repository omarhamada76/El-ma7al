import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { useInvoiceStore } from '@/stores/invoiceStore'
import {
  extractProductBarcodeForLookup,
  normalizeInvoiceScanToken,
  setInvoiceNewPendingBarcode,
} from '@/lib/barcodeLookup'

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
        const logical = normalizeInvoiceScanToken(extractProductBarcodeForLookup(barcode))
        if (/^B\d+$/i.test(logical) || /^G\d+$/i.test(logical)) {
          showToast('Batch/bag label detected — opening full invoice screen', 'info', 3200)
          setInvoiceNewPendingBarcode(logical)
          navigate(`/invoices/new?barcode=${encodeURIComponent(logical)}`)
          return
        }
        // New invoice page: never add to the quick-invoice store (wrong cart). Route through ?barcode=
        // so InvoiceNew runs a single scan — avoids duplicate lines when focus leaves the barcode field.
        // If we're on inventory, just update the search filter instead of navigating away
        if (location.pathname === '/inventory') {
          const params = new URLSearchParams(window.location.search)
          params.set('search', barcode)
          navigate(`/inventory?${params.toString()}`, { replace: true })
          return
        }

        if (location.pathname === '/invoices/new') {
          const params = new URLSearchParams(location.search)
          params.set('barcode', logical)
          setInvoiceNewPendingBarcode(logical)
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
            err instanceof Error ? err.message : `لم يتم العثور على المنتج للباركود "${barcode.trim()}"`
          // In dev/debug, show the raw string to help identify junk characters
          const debugMsg = `${message} (Raw: "${barcode}")`
          showToast(debugMsg, 'error', 8000)
        }
      })()
    },
  })

  return (
    <div className="h-dvh max-h-dvh min-h-0 overflow-hidden flex flex-col bg-gray-50 dark:bg-gray-900 md:flex-row">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {/* Mobile sidebar backdrop with blur */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-all md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen((o) => !o)} />
        {/* No top padding on <main>: padding on a scrollport leaves a fixed gap above `position:sticky` headers. */}
        <main className="min-h-0 flex-1 overflow-auto px-3 pb-3 sm:px-4 sm:pb-4 md:px-6 md:pb-6">
          <div className="pt-3 sm:pt-4 md:pt-6 min-h-0">
            <Outlet />
          </div>
        </main>
        {toast && (
          <div
            className={cn(
              "fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] max-w-sm w-[calc(100vw-2.5rem)]",
              "rounded-xl px-4 py-3 text-sm shadow-2xl ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-4 duration-300",
              toast.tone === 'info'
                ? 'bg-amber-600 text-white dark:bg-amber-500'
                : 'bg-red-600 text-white dark:bg-red-500'
            )}
            role="status"
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 font-medium">{toast.message}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
