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
        className="absolute inset-0 bg-black/30 backdrop-blur-md transition-all duration-300"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          'relative w-full max-h-[90vh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-2xl glass-modal shadow-2xl overflow-hidden flex flex-col animate-modal-in',
          'sm:max-w-md',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200/40 dark:border-gray-700/40 bg-transparent flex-shrink-0">
          <h2 className="text-lg font-bold truncate pr-2">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 -m-2.5 rounded-xl hover:bg-gray-100/50 dark:hover:bg-gray-700/50 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center font-bold text-xl"
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
