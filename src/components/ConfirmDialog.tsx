import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { AlertTriangle, Info } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'info'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  const iconClass = {
    danger: 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400',
    warning: 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400',
    info: 'bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400',
  }[variant]

  const confirmClass = {
    danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white',
    warning: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500 text-white',
    info: 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500 text-white',
  }[variant]

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" dir="rtl">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-md"
        onClick={onCancel}
        aria-hidden
      />
      {/* Dialog card */}
      <div className="relative w-full max-w-sm glass-modal rounded-2xl shadow-2xl animate-modal-in p-6 flex flex-col gap-5">
        {/* Icon + title */}
        <div className="flex items-start gap-4">
          <div className={cn('p-2.5 rounded-xl flex-shrink-0', iconClass)}>
            {variant === 'info'
              ? <Info className="w-5 h-5" aria-hidden />
              : <AlertTriangle className="w-5 h-5" aria-hidden />
            }
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 leading-tight">{title}</h2>
            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{message}</p>
          </div>
        </div>
        {/* Actions */}
        <div className="flex flex-row-reverse gap-2 pt-1">
          <button
            type="button"
            autoFocus
            disabled={loading}
            onClick={onConfirm}
            className={cn(
              'flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50',
              confirmClass
            )}
          >
            {loading ? 'جاري التنفيذ…' : confirmLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 hover:bg-gray-50 dark:hover:bg-gray-700/70 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
