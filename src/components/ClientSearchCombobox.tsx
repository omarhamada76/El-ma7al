import { useState, useRef, useEffect, useId } from 'react'
import { Search, ChevronDown, X } from 'lucide-react'
import { cn, formatCurrency, normalizeSearchText } from '@/lib/utils'
import type { Client } from '@/types/api'

interface ClientSearchComboboxProps {
  clients: Client[]
  value: string
  onChange: (clientId: string) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
  /** Show debt balance next to each client name */
  showBalance?: boolean
  /** Debt alert threshold for coloring */
  debtAlertThreshold?: number
}

export default function ClientSearchCombobox({
  clients,
  value,
  onChange,
  placeholder = '— اختر العميل —',
  disabled = false,
  required = false,
  showBalance = true,
  debtAlertThreshold = 5000,
}: ClientSearchComboboxProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = clients.find((c) => String(c.id) === value) ?? null

  // Normalize search
  const norm = normalizeSearchText(query)
  const filtered = norm
    ? clients.filter(
        (c) =>
          normalizeSearchText(c.name).includes(norm) ||
          (c.phone ?? '').replace(/\s/g, '').includes(norm.replace(/\s/g, ''))
      )
    : clients

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Focus input when dropdown opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  function handleSelect(client: Client) {
    onChange(String(client.id))
    setOpen(false)
    setQuery('')
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setQuery('')
  }

  const balanceColor = (balance: number) => {
    if (balance <= 0) return 'text-emerald-600 dark:text-emerald-400'
    if (balance >= debtAlertThreshold) return 'text-red-600 dark:text-red-400'
    return 'text-amber-600 dark:text-amber-400'
  }

  const debtChip = (balance: number) => {
    if (balance <= 0)
      return (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 shrink-0">
          صافر
        </span>
      )
    if (balance >= debtAlertThreshold)
      return (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 shrink-0">
          دين كبير
        </span>
      )
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 shrink-0">
        مديون
      </span>
    )
  }

  return (
    <div ref={containerRef} className="relative" id={id}>
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        required={required}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-right transition-all duration-200',
          'bg-white dark:bg-gray-800 text-sm',
          open
            ? 'border-primary-500 ring-2 ring-primary-500/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500',
          disabled && 'opacity-50 cursor-not-allowed',
          !selected && 'text-gray-400 dark:text-gray-500'
        )}
      >
        {selected ? (
          <span className="flex-1 flex items-center gap-2 min-w-0">
            <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{selected.name}</span>
            {showBalance && selected.balance != null && debtChip(selected.balance)}
          </span>
        ) : (
          <span className="flex-1 truncate">{placeholder}</span>
        )}
        <span className="shrink-0 flex items-center gap-1">
          {selected && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => e.key === 'Enter' && handleClear(e as unknown as React.MouseEvent)}
              className="p-0.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600"
              aria-label="مسح الاختيار"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown
            className={cn('w-4 h-4 text-gray-400 transition-transform duration-200', open && 'rotate-180')}
          />
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1.5 w-full glass-modal rounded-2xl shadow-2xl border border-gray-200/40 dark:border-gray-700/40 overflow-hidden animate-modal-in">
          {/* Search input */}
          <div className="p-2 border-b border-gray-100/50 dark:border-gray-700/50">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="بحث بالاسم أو الهاتف..."
                className="w-full pr-9 pl-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50/80 dark:bg-gray-800/80 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                dir="rtl"
                autoComplete="off"
              />
            </div>
          </div>

          {/* List */}
          <ul
            role="listbox"
            className="max-h-64 overflow-y-auto overscroll-contain py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                لا توجد نتائج
              </li>
            ) : (
              filtered.map((client) => {
                const balance = client.balance ?? client.initial_debt
                return (
                  <li key={client.id} role="option" aria-selected={String(client.id) === value}>
                    <button
                      type="button"
                      onClick={() => handleSelect(client)}
                      className={cn(
                        'w-full flex items-center justify-between gap-3 px-4 py-2.5 text-right text-sm transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-700/50',
                        String(client.id) === value && 'bg-primary-50/60 dark:bg-primary-900/20'
                      )}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{client.name}</span>
                        {client.phone && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 truncate" dir="ltr">
                            {client.phone}
                          </span>
                        )}
                      </div>
                      {showBalance && (
                        <div className="flex flex-col items-end shrink-0 gap-0.5">
                          <span className={cn('text-xs font-bold tabular-nums', balanceColor(balance))}>
                            {formatCurrency(balance)}
                          </span>
                          {debtChip(balance)}
                        </div>
                      )}
                    </button>
                  </li>
                )
              })
            )}
          </ul>

          {filtered.length > 0 && (
            <div className="px-4 py-1.5 border-t border-gray-100/50 dark:border-gray-700/50 text-xs text-gray-400">
              {filtered.length} عميل
            </div>
          )}
        </div>
      )}
    </div>
  )
}
