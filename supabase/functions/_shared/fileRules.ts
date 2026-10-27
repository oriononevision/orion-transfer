/**
 * Règles appliquées aux fichiers AVANT l'envoi, dans le navigateur.
 *
 * Elles servent à prévenir l'utilisateur tôt et clairement. Elles ne sont
 * PAS une protection : le serveur refait toutes les vérifications
 * (voir supabase/migrations et la fonction d'envoi).
 *
 * Ce module n'utilise aucune API du navigateur, pour pouvoir être testé et
 * réutilisé tel quel par les fonctions serveur.
 */

const MB = 1024 * 1024

/** Doit rester identique à transfer.limits() côté base. */
export const LIMITS = {
  maxFileBytes: 250 * MB,
  maxTransferBytes: 1024 * MB,
  maxFiles: 20,
  maxRecipients: 20,
  maxActiveBytes: 2048 * MB,
  expiryDays: [1, 7, 14] as const,
  defaultExpiryDays: 7,
  maxMessageChars: 2000,
}

/** Doit rester identique à transfer.blocked_extensions() côté base. */
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'msp', 'msix', 'appx', 'scr', 'com', 'pif', 'cpl', 'dll', 'sys',
  'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'wsf', 'wsh', 'hta', 'reg', 'lnk',
  'apk', 'dmg', 'pkg', 'mpkg', 'deb', 'rpm',
])

/** Dossiers jamais envoyés quand on dépose un dossier de projet. */
export const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', '.vercel', '.turbo', '.cache',
  '__pycache__', '.venv', '.idea',
])

/** Fichiers système sans intérêt, ignorés en silence. */
const IGNORED_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])

export function extensionOf(name: string): string {
  const match = /\.([^./\\]+)$/.exec(name)
  return match ? match[1].toLowerCase() : ''
}

export function isBlockedName(name: string): boolean {
  return BLOCKED_EXTENSIONS.has(extensionOf(name))
}

/** Retire les caractères de contrôle et d'inversion de sens d'écriture. */
export function sanitizeName(name: string): string {
  return name
    // oxlint-disable-next-line no-control-regex -- retrait volontaire des caractères de contrôle
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[/\\]/g, '_')
    .trim()
    .slice(0, 255)
}

/**
 * Pour un fichier déposé dans un dossier : faut-il l'ignorer ?
 * `relativePath` ressemble à « orion-core/src/App.tsx ».
 */
export function excludedByPath(relativePath: string): 'excluded-dir' | 'system-file' | null {
  const parts = relativePath.split(/[/\\]/).filter(Boolean)
  const fileName = (parts.at(-1) ?? '').toLowerCase()
  if (IGNORED_FILES.has(fileName)) return 'system-file'
  // Le premier segment est le dossier déposé lui-même : on ne l'exclut pas.
  if (parts.slice(1, -1).some((dir) => EXCLUDED_DIRS.has(dir))) return 'excluded-dir'
  return null
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

const SAFE_ENV_SUFFIXES = new Set(['example', 'sample', 'template', 'dist', 'defaults'])

/** Le nom du fichier laisse-t-il penser qu'il contient des secrets ? */
export function secretByName(name: string): string | null {
  const lower = name.toLowerCase()
  if (lower === '.env' || lower.startsWith('.env.')) {
    const suffix = lower.slice(5)
    return SAFE_ENV_SUFFIXES.has(suffix) ? null : 'env-file'
  }
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(lower)) return 'ssh-key'
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(lower)) return 'private-key'
  if (['.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials.json'].includes(lower)) return 'credentials'
  if (/^service[-_]?account.*\.json$/.test(lower)) return 'credentials'
  return null
}

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['supabase-access-token', /\bsbp_[0-9a-f]{40}\b/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['stripe-secret-key', /\b[sr]k_live_[0-9A-Za-z]{20,}\b/],
  ['slack-token', /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['openai-or-anthropic-key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/],
]

/** Taille maximale lue pour chercher des secrets dans le contenu. */
export const SECRET_SCAN_MAX_BYTES = 1 * MB

/**
 * Cherche des secrets dans le texte d'un fichier. L'analyse se fait
 * uniquement dans le navigateur : rien n'est envoyé pour l'analyser.
 */
export function secretInContent(text: string): string | null {
  for (const [kind, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) return kind
  }
  // Clé Supabase « service_role » (un JWT dont le contenu indique ce rôle).
  for (const jwt of text.match(/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g) ?? []) {
    const payload = decodeBase64Url(jwt.split('.')[1])
    if (payload && /"role"\s*:\s*"service_role"/.test(payload)) return 'supabase-service-key'
  }
  return null
}

function decodeBase64Url(part: string): string | null {
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Programmes déguisés (contenu réel)
// ---------------------------------------------------------------------------

/**
 * Reconnaît un programme exécutable à ses premiers octets, quel que soit
 * son nom. Utilisé dans le navigateur (avertissement) et par le serveur
 * (refus définitif).
 */
export function detectExecutable(head: Uint8Array): string | null {
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return 'windows-executable' // « MZ »
  if (head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return 'linux-executable' // ELF
  if (head.length >= 4) {
    const magic = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) return 'macos-executable'
    // 0xCAFEBABE : binaire macOS universel… ou classe Java. Un binaire
    // universel annonce ensuite un petit nombre d'architectures ; une classe
    // Java, un numéro de version ≥ 45.
    if (magic === 0xcafebabe && head.length >= 8) {
      const next = ((head[4] << 24) | (head[5] << 16) | (head[6] << 8) | head[7]) >>> 0
      if (next > 0 && next < 30) return 'macos-executable'
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Vérification d'une sélection complète
// ---------------------------------------------------------------------------

export type CandidateFile = {
  name: string
  size: number
  /** Chemin dans le dossier déposé, s'il y en a un. */
  path?: string
}

export type FileIssue =
  | { kind: 'blocked-type'; name: string }
  | { kind: 'too-large'; name: string; size: number }
  | { kind: 'empty'; name: string }

export type SelectionCheck = {
  accepted: CandidateFile[]
  rejected: FileIssue[]
  excludedCount: number
  totalBytes: number
  tooManyFiles: boolean
  tooLarge: boolean
}

export function checkSelection(files: CandidateFile[]): SelectionCheck {
  const accepted: CandidateFile[] = []
  const rejected: FileIssue[] = []
  let excludedCount = 0

  for (const file of files) {
    if (file.path && excludedByPath(file.path)) {
      excludedCount += 1
      continue
    }
    const name = sanitizeName(file.name)
    if (isBlockedName(name)) rejected.push({ kind: 'blocked-type', name })
    else if (file.size <= 0) rejected.push({ kind: 'empty', name })
    else if (file.size > LIMITS.maxFileBytes) rejected.push({ kind: 'too-large', name, size: file.size })
    else accepted.push({ ...file, name })
  }

  const totalBytes = accepted.reduce((sum, f) => sum + f.size, 0)
  return {
    accepted,
    rejected,
    excludedCount,
    totalBytes,
    tooManyFiles: accepted.length > LIMITS.maxFiles,
    tooLarge: totalBytes > LIMITS.maxTransferBytes,
  }
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return EMAIL.test(email) && email.length <= 320 ? email : null
}

/** « 84 Mo », « 2,1 Mo », « 880 Ko » — format français. */
export function formatBytes(bytes: number): string {
  const units = ['octets', 'Ko', 'Mo', 'Go']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: digits })} ${units[unit]}`
}

/** Type réel probable d'après les premiers octets (indicatif, pour l'historique). */
export function sniffType(head: Uint8Array): string {
  const starts = (...sig: number[]) => sig.every((b, i) => head[i] === b)
  if (detectExecutable(head)) return 'executable'
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'pdf'
  if (starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06)) return 'zip'
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (starts(0x1f, 0x8b)) return 'gzip'
  if (starts(0x37, 0x7a, 0xbc, 0xaf)) return '7z'
  if (starts(0x52, 0x61, 0x72, 0x21)) return 'rar'
  if (head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'mp4'
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return 'office-legacy'
  return 'other'
}
