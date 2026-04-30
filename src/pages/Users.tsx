import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { getUsers, createUser, updateUser, deleteUser } from '@/api/users'
import type { User } from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import UserFormModal from '@/components/UserFormModal'
import FeedbackBanner from '@/components/FeedbackBanner'
import SuccessOverlay from '@/components/SuccessOverlay'

const roleLabels: Record<string, string> = {
  staff: 'موظف',
  admin: 'مشرف',
  super_admin: 'مدير النظام',
}

export default function Users() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)
  const canAssignSuperAdmin = currentUser?.role === 'super_admin'

  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [userCelebrate, setUserCelebrate] = useState<{ title: string; subtitle?: string } | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  })

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setFormOpen(false)
      setUserCelebrate({ title: 'تم إنشاء المستخدم بنجاح', subtitle: 'يمكنك المتابعة من القائمة' })
    },
    onError: (err: Error) => {
      setErrorMessage(err.message || 'تعذر إنشاء المستخدم')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string
      body: Parameters<typeof updateUser>[1]
    }) => updateUser(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setFormOpen(false)
      setEditingUser(null)
      setUserCelebrate({ title: 'تم تحديث المستخدم بنجاح' })
    },
    onError: (err: Error) => {
      setErrorMessage(err.message || 'تعذر تحديث المستخدم')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setUserCelebrate({ title: 'تم حذف المستخدم بنجاح' })
    },
    onError: (err: Error) => {
      setErrorMessage(err.message || 'تعذر حذف المستخدم')
    },
  })

  const users = data?.data ?? []
  const pending = createMutation.isPending || updateMutation.isPending

  useEffect(() => {
    if (!errorMessage) return
    const t = window.setTimeout(() => setErrorMessage(null), 4500)
    return () => window.clearTimeout(t)
  }, [errorMessage])

  return (
    <div className="space-y-6" dir="rtl">
      <SuccessOverlay
        open={!!userCelebrate}
        title={userCelebrate?.title ?? ''}
        subtitle={userCelebrate?.subtitle}
        durationMs={1500}
        onComplete={() => setUserCelebrate(null)}
      />
      {errorMessage && <FeedbackBanner type="error" message={errorMessage} />}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">إدارة المستخدمين</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            للمشرفين فقط. إضافة وتعديل وحذف المستخدمين والأدوار.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormMode('create')
            setEditingUser(null)
            setFormOpen(true)
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
        >
          <Plus className="w-4 h-4" />
          إضافة مستخدم
        </button>
      </div>

      {error && (
        <p className="text-red-600 text-sm">
          {(error as Error).message || 'تعذر تحميل المستخدمين'}
        </p>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
              />
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="p-8 text-center text-gray-500 dark:text-gray-400">
            لا يوجد مستخدمون.
          </p>
        ) : (
          <div className="responsive-table-container">
            <table className="responsive-table min-w-0">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="text-right py-3 px-4">البريد</th>
                  <th className="text-right py-3 px-4">الاسم</th>
                  <th className="text-right py-3 px-4">الدور</th>
                  <th className="text-right py-3 px-4 hidden sm:table-cell">الحالة</th>
                  <th className="text-right py-3 px-4 w-28">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = String(u.id) === String(currentUser?.id)
                  const targetIsSuper = u.role === 'super_admin'
                  const canEdit =
                    canAssignSuperAdmin ||
                    (!targetIsSuper && currentUser?.role === 'admin')
                  const canDelete =
                    !isSelf &&
                    (canAssignSuperAdmin ||
                      (!targetIsSuper && currentUser?.role === 'admin'))

                  return (
                    <tr
                      key={u.id}
                      className="border-b border-gray-100 dark:border-gray-700"
                    >
                      <td className="py-2 px-4" dir="ltr">
                        {u.email}
                      </td>
                      <td className="py-2 px-4">{u.display_name ?? '—'}</td>
                      <td className="py-2 px-4">{roleLabels[u.role] ?? u.role}</td>
                      <td className="py-2 px-4">
                        {u.is_active !== false ? 'نشط' : 'معطّل'}
                      </td>
                      <td className="py-2 px-4">
                        <div className="flex items-center gap-1">
                          {canEdit && (
                            <button
                              type="button"
                              title="تعديل"
                              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-primary-600"
                              onClick={() => {
                                setFormMode('edit')
                                setEditingUser(u)
                                setFormOpen(true)
                              }}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              title="حذف"
                              className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `حذف المستخدم «${u.email}»؟ لا يمكن التراجع.`
                                  )
                                ) {
                                  deleteMutation.mutate(u.id)
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UserFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditingUser(null)
        }}
        mode={formMode}
        initialUser={editingUser}
        canAssignSuperAdmin={canAssignSuperAdmin}
        isPending={pending}
        onSubmit={async (payload) => {
          if (formMode === 'create') {
            await createMutation.mutateAsync({
              email: payload.email!,
              password: payload.password!,
              display_name: payload.display_name,
              role: payload.role!,
            })
          } else if (editingUser) {
            await updateMutation.mutateAsync({
              id: editingUser.id,
              body: {
                display_name: payload.display_name,
                role: payload.role,
                is_active: payload.is_active,
                ...(payload.password ? { password: payload.password } : {}),
              },
            })
          }
        }}
      />
    </div>
  )
}
