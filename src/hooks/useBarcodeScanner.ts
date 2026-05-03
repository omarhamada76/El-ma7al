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
  manualTypingResetMs = 800,
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
    let firstKeyTime = 0
    let keyCount = 0
    let lastFired = { barcode: '', time: 0 }
    let flushTimeout: number | null = null

    const fireScan = (barcode: string, now: number) => {
      const { duplicateDebounceMs: dupMs, minBarcodeLength: minLen } = optsRef.current
      if (barcode.length >= minLen) {
        if (barcode === lastFired.barcode && now - lastFired.time < dupMs) {
          if (import.meta.env.DEV) console.debug('[useBarcodeScanner] Duplicate scan debounced')
          return
        }
        
        // If we are currently in an input, clear it so the barcode isn't left as text.
        // We only do this for "true" scans (fast) to avoid wiping manual typing.
        const active = document.activeElement
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
          const totalTime = lastKeyTime - firstKeyTime
          const avgGap = keyCount > 1 ? totalTime / (keyCount - 1) : 0
          if (avgGap < 60) {
            if (import.meta.env.DEV) console.debug('[useBarcodeScanner] Clearing active input after high-speed scan')
            active.value = ''
          }
        }

        lastFired = { barcode, time: now }
        onScanRef.current(barcode)
      }
    }

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const { manualTypingResetMs: resetMs } = optsRef.current
      const now = Date.now()
      const inInput = isTypingTarget(e.target)

      if (flushTimeout) {
        window.clearTimeout(flushTimeout)
        flushTimeout = null
      }

      if (e.key === 'Enter') {
        const barcode = buffer.trim()
        buffer = ''
        
        if (barcode) {
          const totalTime = lastKeyTime - firstKeyTime
          const avgGap = keyCount > 1 ? totalTime / (keyCount - 1) : 0
          const isScannerSpeed = keyCount >= 2 && avgGap < 60
          
          if (!inInput || isScannerSpeed) {
            if (import.meta.env.DEV) {
              console.debug(`[useBarcodeScanner] Enter scan! Avg gap: ${avgGap}ms, barcode: ${barcode}`)
            }
            fireScan(barcode, now)
            if (inInput) {
              e.preventDefault()
              e.stopPropagation()
            }
          } else {
            if (import.meta.env.DEV) {
              console.debug(`[useBarcodeScanner] Ignored Enter (slow typing in input). Avg gap: ${avgGap}ms`)
            }
          }
        }
        return
      }

      // Reset buffer if paused for too long
      if (now - lastKeyTime > resetMs) {
        buffer = ''
        keyCount = 0
        firstKeyTime = now
      }

      if (e.key.length === 1) {
        // Normalize Arabic numerals immediately
        const char = e.key.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
                           .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
        
        if (buffer === '') {
          firstKeyTime = now
        }
        
        buffer += char
        keyCount++
        lastKeyTime = now
        
        const currentFirstKeyTime = firstKeyTime
        const currentKeyCount = keyCount
        const currentLastKeyTime = lastKeyTime

        flushTimeout = window.setTimeout(() => {
          const barcode = buffer.trim()
          if (!barcode) return
          
          const totalTime = currentLastKeyTime - currentFirstKeyTime
          const avgGap = currentKeyCount > 1 ? totalTime / (currentKeyCount - 1) : 0
          const isScannerSpeed = currentKeyCount >= 2 && avgGap < 60
          
          if (!inInput || isScannerSpeed) {
            if (import.meta.env.DEV) {
              console.debug(`[useBarcodeScanner] Timeout flush! Avg gap: ${avgGap}ms, barcode: ${barcode}`)
            }
            buffer = ''
            fireScan(barcode, Date.now())
          } else {
            if (import.meta.env.DEV) {
              console.debug(`[useBarcodeScanner] Timeout ignored (slow typing in input). Avg gap: ${avgGap}ms`)
            }
          }
        }, 300)
      }
    }

    // Use capture: true so we intercept the keys before React's synthetic event system
    // handles them on individual input elements.
    window.addEventListener('keydown', handler, { capture: true })
    return () => {
      window.removeEventListener('keydown', handler, { capture: true })
      if (flushTimeout) window.clearTimeout(flushTimeout)
    }
  }, [])
}

export default useBarcodeScanner
