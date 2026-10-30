/** Redimensionne une image pour la couverture projet (JPEG data URL léger). */

const MAX_EDGE = 720
const QUALITY = 0.82
const MAX_OUTPUT_CHARS = 550_000

export async function fileToCoverDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('invalid_cover')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('invalid_cover')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY)
  if (dataUrl.length > MAX_OUTPUT_CHARS) throw new Error('cover_too_large')
  return dataUrl
}
