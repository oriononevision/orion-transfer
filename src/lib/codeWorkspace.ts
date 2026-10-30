/**
 * Workspace multi-fichiers pour le code partagé (stocké en JSON dans une révision).
 */

export type FileMap = Record<string, string>

export type WorkspacePayload = {
  v: 1
  files: FileMap
}

const MAX_FILES = 80
const MAX_FILE_CHARS = 200_000
const MAX_TOTAL_CHARS = 1_400_000
const TEXT_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|css|scss|html|htm|svg|yml|yaml|toml|env|gitignore|dockerignore|sql|py|rs|go|java|kt|swift|c|h|cpp|hpp|cs|php|rb|sh|bat|ps1|xml|csv|ini|cfg|conf|vue|svelte|astro)$/i
const TEXT_NAMES = /^(Dockerfile|Makefile|LICENSE|README|CHANGELOG|\.gitignore|\.env|\.env\.example|\.editorconfig|\.prettierrc|\.eslintrc)$/i

export function emptyWorkspace(): FileMap {
  return { 'README.md': '# Nouveau projet\n\nOuvrez un dossier ou créez des fichiers.\n' }
}

/** Accepte l’ancien format (texte brut) ou le JSON workspace. */
export function parseWorkspace(raw: string): FileMap {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) return emptyWorkspace()
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as Partial<WorkspacePayload> & { files?: FileMap }
      if (data && typeof data.files === 'object' && data.files) {
        const out: FileMap = {}
        for (const [path, content] of Object.entries(data.files)) {
          if (typeof path === 'string' && typeof content === 'string') {
            out[normalizePath(path)] = content
          }
        }
        if (Object.keys(out).length > 0) return out
      }
    } catch {
      /* plain text fallback */
    }
  }
  return { 'main.txt': raw }
}

export function serializeWorkspace(files: FileMap): string {
  const clean: FileMap = {}
  for (const [path, content] of Object.entries(files)) {
    const p = normalizePath(path)
    if (p) clean[p] = content
  }
  const payload: WorkspacePayload = { v: 1, files: clean }
  return JSON.stringify(payload)
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .split('/')
    .filter((s) => s && s !== '.')
    .join('/')
}

export function workspaceStats(files: FileMap): { count: number; chars: number } {
  let chars = 0
  for (const c of Object.values(files)) chars += c.length
  return { count: Object.keys(files).length, chars }
}

export function assertWorkspaceLimits(files: FileMap): string | null {
  const { count, chars } = workspaceStats(files)
  if (count > MAX_FILES) return 'workspace_too_many_files'
  if (chars > MAX_TOTAL_CHARS) return 'content_too_large'
  for (const c of Object.values(files)) {
    if (c.length > MAX_FILE_CHARS) return 'content_too_large'
  }
  return null
}

export function isProbablyTextFile(name: string): boolean {
  const base = name.split('/').pop() || name
  return TEXT_EXT.test(base) || TEXT_NAMES.test(base) || !base.includes('.')
}

export type TreeNode =
  | { kind: 'dir'; name: string; path: string; children: TreeNode[] }
  | { kind: 'file'; name: string; path: string }

/** Construit une arborescence triée (dossiers puis fichiers). */
export function buildTree(files: FileMap): TreeNode[] {
  type Dir = { kind: 'dir'; name: string; path: string; children: Map<string, Dir | TreeNode> }
  const root: Dir = { kind: 'dir', name: '', path: '', children: new Map() }

  for (const path of Object.keys(files).sort()) {
    const parts = path.split('/')
    let cur = root
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!
      const isFile = i === parts.length - 1
      const full = parts.slice(0, i + 1).join('/')
      if (isFile) {
        cur.children.set(part, { kind: 'file', name: part, path: full })
      } else {
        let next = cur.children.get(part) as Dir | undefined
        if (!next || next.kind !== 'dir') {
          next = { kind: 'dir', name: part, path: full, children: new Map() }
          cur.children.set(part, next)
        }
        cur = next
      }
    }
  }

  const toArray = (dir: Dir): TreeNode[] => {
    const dirs: TreeNode[] = []
    const fileNodes: TreeNode[] = []
    for (const node of dir.children.values()) {
      if (node.kind === 'dir' && 'children' in node && node.children instanceof Map) {
        const asDir = node as Dir
        dirs.push({ kind: 'dir', name: asDir.name, path: asDir.path, children: toArray(asDir) })
      } else if (node.kind === 'file') {
        fileNodes.push(node)
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    fileNodes.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    return [...dirs, ...fileNodes]
  }

  return toArray(root)
}

/** Charge des File[] (ex. webkitdirectory) dans une map. */
export async function filesFromFolderInput(list: FileList | null): Promise<{
  files: FileMap
  skipped: number
}> {
  const files: FileMap = {}
  let skipped = 0
  for (const file of Array.from(list ?? [])) {
    const rel = normalizePath(file.webkitRelativePath || file.name)
    if (!rel) continue
    // Retire le premier segment (nom du dossier racine) pour un workspace relatif.
    const parts = rel.split('/')
    const path = parts.length > 1 ? parts.slice(1).join('/') : parts[0]!
    if (!path) continue
    if (!isProbablyTextFile(path)) {
      skipped += 1
      continue
    }
    if (file.size > MAX_FILE_CHARS * 2) {
      skipped += 1
      continue
    }
    try {
      const text = await file.text()
      // Ignore les binaires grossiers
      if (text.includes('\u0000')) {
        skipped += 1
        continue
      }
      files[path] = text.slice(0, MAX_FILE_CHARS)
    } catch {
      skipped += 1
    }
  }
  return { files, skipped }
}

export function languageHint(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TSX',
    js: 'JavaScript',
    jsx: 'JSX',
    json: 'JSON',
    md: 'Markdown',
    css: 'CSS',
    html: 'HTML',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    sql: 'SQL',
    yml: 'YAML',
    yaml: 'YAML',
  }
  return map[ext] || ext.toUpperCase() || 'Texte'
}
