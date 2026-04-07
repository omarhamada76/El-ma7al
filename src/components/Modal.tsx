import { useEffect } from 'react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
}

export default function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (open) {
      const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
      document.addEventListener('keydown', h)
      return () => document.removeEventListener('keydown', h)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 safe-area-padding" dir="rtl">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          'relative w-full max-h-[90vh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col',
          'sm:max-w-md',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-semibold truncate pr-2">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 -m-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>
        <div className="p-4 overflow-y-auto overflow-x-hidden flex-1 min-h-0">{children}</div>
      </div>
    </div>
  )
}
