type FeedbackType = 'success' | 'error' | 'warning'

type FeedbackBannerProps = {
  type: FeedbackType
  message: string
  fixed?: boolean
  className?: string
}

const styles: Record<FeedbackType, string> = {
  error:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  warning:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
}

export default function FeedbackBanner({ type, message, fixed = false, className = '' }: FeedbackBannerProps) {
  return (
    <div
      className={`${fixed ? 'fixed top-4 left-4 right-4 z-50 mx-auto max-w-lg shadow-lg' : ''} rounded-lg border px-4 py-3 text-sm ${styles[type]} ${className}`}
      role="status"
    >
      {message}
    </div>
  )
}
