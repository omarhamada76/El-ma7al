import { useEffect, useRef } from 'react'

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void
  /** Ignore same barcode if fired again within this window (duplicate scan / double listener guard). */
  duplicateDebounceMs?: number
  /** Minimum trimmed length to treat as a scan (filters stray keys). B/G labels need at least 2 (e.g. B1). */
  minBarcodeLength?: number
  /** If gap between keys exceeds this, treat as manual typing and reset buffer. */
  manualTypingResetMs?: number
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable || el.closest('[contenteditable="true"]') !== null
}

/**
 * Global keyboard-wedge barcode capture. Single `keydown` listener with `[]` deps + cleanup so
 * React StrictMode (dev mount → unmount → remount) does not stack listeners.
 */
export function useBarcodeScanner({
  onScan,
  duplicateDebounceMs = 500,
  minBarcodeLength = 2,
  manualTypingResetMs = 300,
}: UseBarcodeScannerOptions) {
  const onScanRef = useRef(onScan)
  const optsRef = useRef({ duplicateDebounceMs, minBarcodeLength, manualTypingResetMs })

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    optsRef.current = { duplicateDebounceMs, minBarcodeLength, manualTypingResetMs }
  }, [duplicateDebounceMs, minBarcodeLength, manualTypingResetMs])

  useEffect(() => {
    let buffer = ''
    let lastKeyTime = 0
    let lastFired = { barcode: '', time: 0 }

    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const { duplicateDebounceMs: dupMs, minBarcodeLength: minLen, manualTypingResetMs: resetMs } =
        optsRef.current
      const now = Date.now()

      if (e.key === 'Enter') {
        const barcode = buffer.trim()
        buffer = ''
        if (barcode.length >= minLen) {
          if (barcode === lastFired.barcode && now - lastFired.time < dupMs) return
          lastFired = { barcode, time: now }
          onScanRef.current(barcode)
        }
        return
      }

      if (now - lastKeyTime > resetMs) {
        buffer = ''
      }
      lastKeyTime = now
      if (e.key.length === 1) {
        buffer += e.key
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

export default useBarcodeScanner
