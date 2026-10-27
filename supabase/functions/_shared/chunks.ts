/** Taille d’un morceau sous le plafond ~50 Mo de Supabase Storage (offre gratuite). */
export const STORAGE_CHUNK_BYTES = 45 * 1024 * 1024

export function chunkCountForSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 1
  return Math.max(1, Math.ceil(size / STORAGE_CHUNK_BYTES))
}

export function chunkObjectKey(storageKey: string, index: number): string {
  return `${storageKey}/c/${index}`
}

export function chunkByteRange(size: number, index: number): { start: number; end: number } {
  const start = index * STORAGE_CHUNK_BYTES
  const end = Math.min(size, start + STORAGE_CHUNK_BYTES)
  return { start, end }
}
