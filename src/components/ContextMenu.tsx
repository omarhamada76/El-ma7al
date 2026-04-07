import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  icon?: React.ReactNode
  danger?: boolean
}

interface ContextMenuProps {
  open: boolean
  x: number
  y: number
  onClose: () => void
  items: ContextMenuItem[]
  className?: string
}

export default function ContextMenu({ open, x, y, onClose, items, className }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = () => onClose()
    const t = setTimeout(() => document.addEventListener('click', handleClick), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', handleClick)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open || items.length === 0) return null

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden />
      <div
        ref={ref}
        role="menu"
        dir="rtl"
        className={cn(
          'fixed z-50 min-w-[160px] py-1 rounded-lg border border-gray-200 dark:border-gray-600',
          'bg-white dark:bg-gray-800 shadow-lg',
          className
        )}
        style={{
          left: x,
          top: y,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item, i) => (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-right text-sm transition-colors',
              item.danger
                ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
            )}
            onClick={() => {
              item.onClick()
              onClose()
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
