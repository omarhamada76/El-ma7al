import React, { useState, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, CreditCard, Pencil, Trash2, Download, Share2 } from 'lucide-react'
import {
  getSupplier,
  getSupplierBalance,
  getSupplierAccountStatement,
  updateSupplier,
  deleteSupplier,
} from '@/api/suppliers'
import { formatCurrency, formatDate, localISODate, cn } from '@/lib/utils'
import AddSupplierModal from '@/components/AddSupplierModal'
import AccountStatementTable from '@/components/AccountStatementTable'
import {
  createStatementPdfBlob,
  downloadStatementPdf,
  shareStatementToWhatsApp,
} from '@/lib/accountStatementPdf'

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)

  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return localISODate(d)
  })
  const [to, setTo] = useState(() => localISODate())
  const [pdfBusy, setPdfBusy] = useState(false)

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => getSupplier(id!),
    enabled: !!id,
  })

  const { data: balanceData } = useQuery({
    queryKey: ['supplier', id, 'balance'],
    queryFn: () => getSupplierBalance(id!),
    enabled: !!id,
  })

  const { data: statement, isLoading: statementLoading } = useQuery({
    queryKey: ['account-statement', 'supplier', id, from, to],
    queryFn: () => getSupplierAccountStatement(id!, { from, to }),
    enabled: !!id,
  })

  const balance = balanceData?.balance ?? 0

  const updateSupplierMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateSupplier>[1]) => updateSupplier(id!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', id] })
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setEditOpen(false)
    },
  })

  const deleteSupplierMutation = useMutation({
    mutationFn: () => deleteSupplier(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      queryClient.invalidateQueries({ queryKey: ['supplier'] })
      navigate('/suppliers')
    },
  })

  const handleDeleteSupplier = () => {
    if (window.confirm('هل أنت متأكد من حذف هذا المورد؟')) deleteSupplierMutation.mutate()
  }

  const pageTitle = useMemo(() => {
    return `كشف حساب المورد — ${supplier?.name ?? ''}`
  }, [supplier])

  const pdfFileLabel = useMemo(() => {
    return supplier?.name ?? 'مورد'
  }, [supplier])

  async function handleDownloadPdf() {
    if (!statement || pdfBusy) return
    setPdfBusy(true)
    try {
      const blob = await createStatementPdfBlob(pageTitle, from, to, statement)
      await downloadStatementPdf(blob, pdfFileLabel, true)
    } finally {
      setPdfBusy(false)
    }
  }

  async function handleShareWhatsApp() {
    if (!statement || pdfBusy) return
    setPdfBusy(true)
    try {
      const blob = await createStatementPdfBlob(pageTitle, from, to, statement)
      await shareStatementToWhatsApp(blob, pdfFileLabel, {
        phone: supplier?.phone,
        from,
        to,
        isSupplier: true,
      })
    } finally {
      setPdfBusy(false)
    }
  }

  if (!id) return null
  if (isLoading || !supplier)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    )

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl sm:text-2xl font-bold truncate">{supplier.name}</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/suppliers/${id}/purchases/new`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
          >
            <Plus className="w-4 h-4" />
            فاتورة شراء
          </Link>
          <Link
            to="/supplier-payments/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
          >
            <CreditCard className="w-4 h-4" />
            سداد لمورد
          </Link>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
          >
            <Pencil className="w-4 h-4" />
            تعديل
          </button>
          <button
            type="button"
            onClick={handleDeleteSupplier}
            disabled={deleteSupplierMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            حذف
          </button>
        </div>
      </div>
      <AddSupplierModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initialValues={{
          name: supplier.name,
          phone: supplier.phone ?? '',
          email: supplier.email ?? '',
          address: supplier.address ?? '',
          notes: supplier.notes ?? '',
        }}
        onSubmit={async (data) => {
          await updateSupplierMutation.mutateAsync({
            name: data.name,
            phone: data.phone || null,
            email: data.email || null,
            address: data.address || null,
            notes: data.notes || null,
          })
        }}
      />

      <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-right">
        <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">ما نستحق له (رصيد المورد الكلي)</p>
        <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
          {formatCurrency(balance)}
        </p>
      </div>

      <div
        className={cn(
          'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40',
          'p-3 sm:p-4 space-y-4 text-right'
        )}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">من تاريخ</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-right text-base"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">إلى تاريخ</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-right text-base"
            />
          </div>
        </div>
      </div>

      {statement && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-right">
            <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20">
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">الحساب السابق في الفترة المحددة</p>
              <p className="text-xl font-bold">{formatCurrency(statement.opening_balance)}</p>
            </div>
            <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-emerald-50 dark:bg-emerald-900/20">
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">الرصيد الحالي في الفترة المحددة</p>
              <p className="text-xl font-bold">{formatCurrency(statement.closing_balance)}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap justify-stretch sm:justify-end gap-2">
            <button
              type="button"
              disabled={pdfBusy}
              onClick={handleDownloadPdf}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2.5 sm:min-h-0 sm:py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 w-full sm:w-auto"
            >
              <Download className="h-4 w-4 shrink-0" />
              تحميل PDF
            </button>
            <button
              type="button"
              disabled={pdfBusy}
              onClick={handleShareWhatsApp}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2.5 sm:min-h-0 sm:py-2 text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 w-full sm:w-auto"
            >
              <Share2 className="h-4 w-4 shrink-0" />
              واتساب
            </button>
          </div>
        </>
      )}

      <div
        className={cn(
          'block w-max min-w-full max-w-6xl mx-auto rounded-xl',
          'border border-gray-200 dark:border-gray-700',
          'bg-white dark:bg-gray-800',
          'px-0 py-3 sm:px-4 sm:py-4 md:px-5 md:py-5',
          'shadow-sm sm:ring-1 sm:ring-gray-950/[0.06] dark:sm:ring-white/10'
        )}
      >
        <AccountStatementTable rows={statement?.rows ?? []} isLoading={statementLoading} />
      </div>
    </div>
  )
}
