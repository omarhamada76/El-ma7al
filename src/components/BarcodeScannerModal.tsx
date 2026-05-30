import { useEffect, useState, useRef } from 'react'
import { Camera, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BarcodeScannerModalProps {
  open: boolean
  onClose: () => void
  onScanSuccess: (decodedText: string) => void
}

export default function BarcodeScannerModal({
  open,
  onClose,
  onScanSuccess,
}: BarcodeScannerModalProps) {
  const [error, setError] = useState('')
  const [cameraLoading, setCameraLoading] = useState(true)
  const scannerRef = useRef<any>(null)
  const isStartedRef = useRef(false)

  useEffect(() => {
    if (!open) return

    setError('')
    setCameraLoading(true)
    isStartedRef.current = true

    let isMounted = true

    const loadAndStart = async () => {
      try {
        // 1. Load library from CDN if not already loaded globally
        let Html5QrcodeClass = (window as any).Html5Qrcode
        if (!Html5QrcodeClass) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script')
            script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
            script.async = true
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Failed to load scanner library'))
            document.body.appendChild(script)
          })
          Html5QrcodeClass = (window as any).Html5Qrcode
        }

        if (!isMounted || !isStartedRef.current) return

        const scannerId = 'barcode-scanner-viewport'
        const element = document.getElementById(scannerId)
        if (!element) {
          throw new Error('Scanner container element not found')
        }

        const html5Qrcode = new Html5QrcodeClass(scannerId)
        scannerRef.current = html5Qrcode

        await html5Qrcode.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            qrbox: (width: number, height: number) => {
              // Standard barcode aspect ratio (wider than it is tall)
              const boxWidth = Math.floor(width * 0.85)
              const boxHeight = Math.floor(height * 0.45)
              return { width: boxWidth, height: boxHeight }
            },
            aspectRatio: 1.777778, // 16:9
          },
          (decodedText: string) => {
            if (isStartedRef.current && isMounted) {
              onScanSuccess(decodedText)
            }
          },
          () => {
            // Quiet fail frame misses
          }
        )

        if (isMounted) {
          setCameraLoading(false)
        }
      } catch (err) {
        console.error('Failed to start barcode scanner:', err)
        if (isMounted) {
          setError('تعذر تشغيل الكاميرا. تأكد من منح صلاحية الوصول للكاميرا وإغلاق أي تطبيق آخر يستخدمها.')
          setCameraLoading(false)
        }
      }
    }

    // Give the DOM element a moment to render before initializing
    const timer = setTimeout(() => {
      loadAndStart()
    }, 300)

    return () => {
      isMounted = false
      clearTimeout(timer)
      isStartedRef.current = false
      
      const scanner = scannerRef.current
      if (scanner && scanner.isScanning) {
        scanner.stop().catch((e: any) => {
          console.error('Error stopping scanner on unmount:', e)
        })
      }
    }
  }, [open, onScanSuccess])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 safe-area-padding" dir="rtl">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md transition-all duration-300"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-md rounded-2xl glass-modal shadow-2xl overflow-hidden flex flex-col animate-modal-in border border-gray-200/40 dark:border-gray-700/40">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200/40 dark:border-gray-700/40 bg-transparent flex-shrink-0">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Camera className="w-4 h-4 text-primary-500" />
            <span>مسح الباركود بالكاميرا</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -m-2 rounded-xl hover:bg-gray-100/50 dark:hover:bg-gray-700/50 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col items-center justify-center gap-4">
          {error ? (
            <div className="w-full p-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-400 flex flex-col items-center text-center gap-2">
              <AlertTriangle className="w-8 h-8 text-red-500 animate-bounce" />
              <p className="text-sm font-semibold leading-relaxed">{error}</p>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-xl bg-black aspect-video w-full border border-gray-200/50 dark:border-gray-700/50 flex items-center justify-center">
              {/* Scan target element for html5-qrcode */}
              <div id="barcode-scanner-viewport" className="w-full h-full" />

              {cameraLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950 text-white gap-2">
                  <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-400">جاري فتح الكاميرا...</span>
                </div>
              )}

              {/* Viewfinder Guideline Overlay */}
              {!cameraLoading && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  {/* Dashed selection target */}
                  <div className="w-[85%] h-[45%] border-2 border-dashed border-red-500 rounded-lg relative overflow-hidden bg-red-500/5">
                    {/* Glowing laser sweep line */}
                    <div className="animate-laser" />
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-400 text-center leading-relaxed max-w-xs">
            ضع الباركود أو كود الدفعة (مثال B7 / G15) داخل المربع الأحمر للمسح التلقائي.
          </p>
        </div>
      </div>
    </div>
  )
}
