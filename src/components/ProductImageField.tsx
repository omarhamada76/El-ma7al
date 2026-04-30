import { useRef } from 'react'
import { resizeImageFileToDataUrl } from '@/lib/productImage'

const PROCESSING_ERROR =
  'تعذّر معالجة الصورة — اختر ملف JPG أو PNG أصغر (حتى 5 ميجا)'

export type ProductImageFieldProps = {
  imageUrl: string | null
  onImageUrlChange: (url: string | null) => void
  /** Called with empty string on success to clear; error message on failure. */
  onError: (message: string) => void
  hint?: string
}

export default function ProductImageField({
  imageUrl,
  onImageUrlChange,
  onError,
  hint,
}: ProductImageFieldProps) {
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const url = await resizeImageFileToDataUrl(f)
    if (!url) {
      onError(PROCESSING_ERROR)
      return
    }
    onError('')
    onImageUrlChange(url)
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-1">صورة المنتج</label>
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="flex flex-wrap items-center gap-3">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="h-14 w-14 rounded-lg object-cover border border-gray-200 dark:border-gray-600 shrink-0"
          />
        ) : (
          <div className="h-14 w-14 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 shrink-0" />
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {imageUrl ? 'تغيير الصورة' : 'اختر صورة'}
          </button>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            التقط صورة
          </button>
          {imageUrl ? (
            <button
              type="button"
              onClick={() => onImageUrlChange(null)}
              className="px-3 py-2 text-sm rounded-lg text-red-600 dark:text-red-400 hover:underline"
            >
              إزالة الصورة
            </button>
          ) : null}
        </div>
      </div>
      {hint ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      ) : null}
    </div>
  )
}
