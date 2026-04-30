/** Client-side product photo: resize + JPEG data URL for `products.image_url`. */

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_EDGE = 384
const DEFAULT_QUALITY = 0.82

export type ResizeImageOptions = {
  /** Max input file size (default 5MB). */
  maxBytes?: number
  /** Max width/height after resize (default 384). */
  maxEdge?: number
  /** JPEG quality 0–1 (default 0.82). */
  quality?: number
}

/**
 * Reads an image file, draws it scaled to fit inside maxEdge×maxEdge, exports as JPEG data URL.
 * Returns `null` if file is too large, not an image, or canvas fails.
 */
export async function resizeImageFileToDataUrl(
  file: File,
  options: ResizeImageOptions = {}
): Promise<string | null> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE
  const quality = options.quality ?? DEFAULT_QUALITY

  if (!file.type.startsWith('image/')) return null
  if (file.size > maxBytes) return null

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }

  const { width: w0, height: h0 } = bitmap
  if (!w0 || !h0) {
    bitmap.close()
    return null
  }

  const scale = Math.min(1, maxEdge / Math.max(w0, h0))
  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return null
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  try {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    return dataUrl.length > 0 && dataUrl.startsWith('data:image/jpeg') ? dataUrl : null
  } catch {
    return null
  }
}
