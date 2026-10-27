/**
 * Lecture des fichiers déposés ou choisis, dossiers compris.
 * Les fichiers des dossiers exclus (node_modules, .git…) ne sont jamais lus.
 */
import { excludedByPath, secretByName, secretInContent, detectExecutable, SECRET_SCAN_MAX_BYTES } from './fileRules'

export type PickedFile = {
  file: File
  /** Chemin dans le dossier déposé (« orion-core/src/App.tsx »), sinon vide. */
  path: string
}

export type Collected = { files: PickedFile[]; excluded: number }

/** Fichiers choisis avec <input type="file"> (avec ou sans webkitdirectory). */
export function fromInput(list: FileList | null): Collected {
  const files: PickedFile[] = []
  let excluded = 0
  for (const file of Array.from(list ?? [])) {
    const path = file.webkitRelativePath || ''
    if (path && excludedByPath(path)) excluded += 1
    else files.push({ file, path })
  }
  return { files, excluded }
}

/** Fichiers et dossiers glissés-déposés. */
export async function fromDataTransfer(dt: DataTransfer): Promise<Collected> {
  const entries = Array.from(dt.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry))

  if (entries.length === 0) return fromInput(dt.files)

  const result: Collected = { files: [], excluded: 0 }
  for (const entry of entries) await walk(entry, '', result)
  return result
}

async function walk(entry: FileSystemEntry, parent: string, out: Collected): Promise<void> {
  const path = parent ? `${parent}/${entry.name}` : entry.name
  if (entry.isFile) {
    if (parent && excludedByPath(path)) {
      out.excluded += 1
      return
    }
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.files.push({ file, path: parent ? path : '' })
    return
  }
  if (entry.isDirectory) {
    // Un dossier exclu n'est même pas parcouru.
    if (parent && excludedByPath(`${path}/x`) === 'excluded-dir') {
      out.excluded += 1
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries renvoie les éléments par lots : on lit jusqu'à épuisement.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (batch.length === 0) break
      for (const child of batch) await walk(child, path, out)
    }
  }
}

export type FileWarning = 'secret' | 'executable' | null

const TEXT_LIKE = /\.(env.*|txt|md|json|ya?ml|toml|ini|cfg|conf|js|jsx|ts|tsx|mjs|cjs|py|php|rb|go|rs|java|kt|swift|sh|ps|sql|xml|html?|css|scss|properties|pem|key)$|^\.?[a-z0-9_-]+rc$|^id_/i

/** Analyse locale (rien n'est envoyé) : secret probable ou programme déguisé. */
export async function inspectFile(file: File): Promise<FileWarning> {
  if (secretByName(file.name)) return 'secret'

  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if (detectExecutable(head)) return 'executable'

  if (file.size <= SECRET_SCAN_MAX_BYTES && (TEXT_LIKE.test(file.name) || file.type.startsWith('text/'))) {
    const text = await file.text()
    if (secretInContent(text)) return 'secret'
  }
  return null
}
