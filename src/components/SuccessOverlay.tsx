import { useEffect, useRef } from 'react'
import { CheckCircle2 } from 'lucide-react'

export type SuccessOverlayProps = {
  open: boolean
  title: string
  /** Optional second line; omit for a single-line celebration */
  subtitle?: string
  /** Time until `onComplete` runs (ms). Default matches invoice flow. */
  durationMs?: number
  /** Called after the delay; clear local state and/or navigate here. */
  onComplete: () => void
  className?: string
}

/**
 * Full-screen success celebration (same motion as invoice save): backdrop fade + card pop + check icon.
 */
export default function SuccessOverlay({
  open,
  title,
  subtitle,
  durationMs = 1650,
  onComplete,
  className = 'z-[200]',
}: SuccessOverlayProps) {
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => onCompleteRef.current(), durationMs)
    return () => window.clearTimeout(t)
  }, [open, durationMs])

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 ${className} flex items-center justify-center p-4 invoice-success-backdrop`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="absolute inset-0 bg-black/45 dark:bg-black/55" aria-hidden />
      <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-600 px-8 py-10 text-center invoice-success-card-anim">
        <CheckCircle2
          className="w-[4.5rem] h-[4.5rem] mx-auto text-emerald-500 dark:text-emerald-400 mb-4 drop-shadow-sm"
          strokeWidth={1.35}
          aria-hidden
        />
        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</p>
        {subtitle ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{subtitle}</p>
        ) : null}
      </div>
    </div>
  )
}
