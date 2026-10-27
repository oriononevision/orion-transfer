/**
 * Mode démonstration (VITE_DEMO=1) : même interface que l'API réelle, mais
 * tout reste dans la mémoire du navigateur. Rien n'est envoyé à personne.
 * Sert à montrer l'application sans serveur ; un bandeau le signale.
 */
import type {
  CompletedTransfer,
  CreatedTransfer,
  EventRow,
  FileRow,
  InboxItem,
  NewFile,
  OutboxItem,
  RecipientRow,
  TransferDetail,
  TransferRow,
} from '../api/transfers'
import { detectExecutable, isBlockedName, LIMITS, normalizeEmail, sanitizeName } from '../lib/fileRules'

export const DEMO_USER = {
  id: 'demo-0000-0000-0000-000000000001',
  email: 'alex@orion.dev',
  first_name: 'Alex',
  last_name: 'Martin',
}

type Stored = {
  transfer: TransferRow
  files: FileRow[]
  recipients: RecipientRow[]
  events: EventRow[]
  senderName: string
  senderEmail: string
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MB = 1024 * 1024
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()
let seq = 100
const id = (prefix: string) => `${prefix}-${(seq++).toString(36)}`

const blobs = new Map<string, Blob>()
const store = new Map<string, Stored>()
let eventSeq = 1

function seed(o: {
  from: [string, string]
  minutesAgo: number
  expiresInDays: number
  message: string | null
  files: Array<[string, number]>
  recipients: Array<[string, number | null]>
  status?: TransferRow['status']
}) {
  const tid = id('t')
  const fromMe = o.from[1] === DEMO_USER.email
  const created = ago(o.minutesAgo * 60_000)
  const files: FileRow[] = o.files.map(([name, size]) => ({
    id: id('f'), display_name: name, relative_path: null, size_bytes: size, detected_type: null, status: 'uploaded',
  }))
  const recipients: RecipientRow[] = o.recipients.map(([email, downloadedMinutesAgo]) => ({
    id: id('r'),
    email,
    revoked_at: null,
    first_downloaded_at: downloadedMinutesAgo == null ? null : ago(downloadedMinutesAgo * 60_000),
  }))
  store.set(tid, {
    senderName: o.from[0],
    senderEmail: o.from[1],
    transfer: {
      id: tid,
      sender_id: fromMe ? DEMO_USER.id : 'someone-else',
      message: o.message,
      status: o.status ?? 'ready',
      expires_at: ahead(o.expiresInDays * DAY),
      total_bytes: files.reduce((s, f) => s + f.size_bytes, 0),
      file_count: files.length,
      created_at: created,
    },
    files,
    recipients,
    events: [
      { id: eventSeq++, kind: 'created', detail: {}, created_at: created },
      { id: eventSeq++, kind: 'ready', detail: {}, created_at: created },
      ...recipients
        .filter((r) => r.first_downloaded_at)
        .map((r) => ({ id: eventSeq++, kind: 'downloaded' as const, detail: { file: files[0].display_name }, created_at: r.first_downloaded_at! })),
    ],
  })
}

// Données fictives de démonstration.
seed({ from: ['Sam Leroy', 'sam@orion.dev'], minutesAgo: 25, expiresInDays: 7, message: 'Build du Hub v3 et captures pour la démo', files: [['orion-hub-v3-build.zip', 4.8 * MB], ['capture-hub.png', 1.2 * MB], ['notes-de-version.md', 6 * 1024]], recipients: [[DEMO_USER.email, null]] })
seed({ from: ['Sam Leroy', 'sam@orion.dev'], minutesAgo: 22 * 60, expiresInDays: 5, message: null, files: [['export-profiles.csv', 2.1 * MB]], recipients: [[DEMO_USER.email, 20 * 60]] })
seed({ from: ['Léa Morel', 'lea@studio-morel.fr'], minutesAgo: 5 * 24 * 60, expiresInDays: 1.5, message: 'Maquettes onboarding', files: [['onboarding-v2.fig', 12 * MB]], recipients: [[DEMO_USER.email, 4 * 24 * 60]] })
seed({ from: ['Sam Leroy', 'sam@orion.dev'], minutesAgo: 15 * 24 * 60, expiresInDays: -1, message: 'Enregistrement de la démo', files: [['demo-client.mov', 240 * MB], ['demo-client-court.mp4', 100 * MB]], recipients: [[DEMO_USER.email, null]], status: 'expired' })
seed({ from: [`${DEMO_USER.first_name} ${DEMO_USER.last_name}`, DEMO_USER.email], minutesAgo: 70, expiresInDays: 7, message: 'Livraison du build Hub v3', files: [['orion-hub-v3-build.zip', 4.8 * MB], ['maquette-hub-v3.fig', 56 * MB]], recipients: [['sam@orion.dev', 40], ['lea@studio-morel.fr', null]] })
seed({ from: [`${DEMO_USER.first_name} ${DEMO_USER.last_name}`, DEMO_USER.email], minutesAgo: 30 * 60, expiresInDays: 6, message: null, files: [['specs-transfer.pdf', 880 * 1024]], recipients: [['sam@orion.dev', null]] })

const isExpired = (t: TransferRow) => t.status === 'expired' || new Date(t.expires_at) <= new Date()
const mine = (s: Stored) => s.transfer.sender_id === DEMO_USER.id
const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms))

export async function fetchInbox(): Promise<InboxItem[]> {
  await pause()
  return [...store.values()]
    .filter((s) => !mine(s) && s.transfer.status !== 'deleted')
    .map((s) => ({
      id: s.transfer.id,
      sender_name: s.senderName,
      sender_email: s.senderEmail,
      message: s.transfer.message,
      status: isExpired(s.transfer) ? 'expired' as const : s.transfer.status,
      expires_at: s.transfer.expires_at,
      total_bytes: s.transfer.total_bytes,
      file_count: s.transfer.file_count,
      created_at: s.transfer.created_at,
      first_downloaded_at: s.recipients[0]?.first_downloaded_at ?? null,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function fetchOutbox(): Promise<OutboxItem[]> {
  await pause()
  return [...store.values()]
    .filter((s) => mine(s) && s.transfer.status !== 'deleted')
    .map((s) => {
      const active = s.recipients.filter((r) => !r.revoked_at)
      return {
        id: s.transfer.id,
        recipient_emails: s.recipients.map((r) => r.email),
        recipient_count: active.length,
        downloaded_count: active.filter((r) => r.first_downloaded_at).length,
        message: s.transfer.message,
        status: isExpired(s.transfer) ? 'expired' as const : s.transfer.status,
        expires_at: s.transfer.expires_at,
        total_bytes: s.transfer.total_bytes,
        file_count: s.transfer.file_count,
        created_at: s.transfer.created_at,
      }
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function fetchUsage() {
  return {
    active_bytes: [...store.values()]
      .filter((s) => mine(s) && !isExpired(s.transfer) && s.transfer.status !== 'deleted')
      .reduce((sum, s) => sum + s.transfer.total_bytes, 0),
  }
}

export async function fetchTransfer(tid: string): Promise<TransferDetail | null> {
  await pause(150)
  const s = store.get(tid)
  if (!s || s.transfer.status === 'deleted') return null
  return {
    transfer: { ...s.transfer, status: isExpired(s.transfer) ? 'expired' : s.transfer.status },
    files: s.files.filter((f) => mine(s) || f.status === 'uploaded'),
    recipients: mine(s) ? s.recipients : s.recipients.slice(0, 1),
    events: mine(s) ? [...s.events].reverse() : [],
  }
}

export async function revokeRecipient(rid: string) {
  for (const s of store.values()) {
    const r = s.recipients.find((x) => x.id === rid)
    if (r && mine(s)) {
      r.revoked_at = new Date().toISOString()
      s.events.push({ id: eventSeq++, kind: 'revoked', detail: { email: r.email }, created_at: r.revoked_at })
      return
    }
  }
  throw new Error('not_found')
}

export async function deleteTransfer(tid: string) {
  const s = store.get(tid)
  if (!s || !mine(s)) throw new Error('not_found')
  s.transfer.status = 'deleted'
}

export async function createTransfer(input: { recipients: string[]; files: NewFile[]; expiryDays: number; message?: string }): Promise<CreatedTransfer> {
  await pause(400)
  const recipients = [...new Set(input.recipients.map((r) => normalizeEmail(r)).filter((r): r is string => Boolean(r)))]
  if (recipients.length === 0) throw new Error('no_recipients')
  if (input.files.length > LIMITS.maxFiles) throw new Error('too_many_files')
  if (input.files.some((f) => isBlockedName(f.name))) throw new Error('blocked_file_type')
  const tid = id('t')
  const files: FileRow[] = input.files.map((f) => ({
    id: id('f'), display_name: sanitizeName(f.name), relative_path: f.path ?? null, size_bytes: f.size, detected_type: null, status: 'pending',
  }))
  const now = new Date().toISOString()
  store.set(tid, {
    senderName: `${DEMO_USER.first_name} ${DEMO_USER.last_name}`,
    senderEmail: DEMO_USER.email,
    transfer: {
      id: tid, sender_id: DEMO_USER.id, message: input.message ?? null, status: 'uploading',
      expires_at: ahead(input.expiryDays * DAY), total_bytes: files.reduce((s, f) => s + f.size_bytes, 0),
      file_count: files.length, created_at: now,
    },
    files,
    recipients: recipients.map((email) => ({ id: id('r'), email, revoked_at: null, first_downloaded_at: null })),
    events: [{ id: eventSeq++, kind: 'created', detail: {}, created_at: now }],
  })
  return {
    transfer_id: tid,
    expires_at: ahead(input.expiryDays * DAY),
    uploads: files.map((f) => ({ file_id: f.id, name: f.display_name, url: `demo://${f.id}` })),
  }
}

export async function uploadToSignedUrl(url: string, file: Blob, onProgress: (fraction: number) => void) {
  const key = url.replace('demo://', '')
  const steps = 12
  for (let i = 1; i <= steps; i += 1) {
    await pause(60 + Math.random() * 80)
    onProgress(i / steps)
  }
  blobs.set(key, file)
}

export async function completeTransfer(tid: string): Promise<CompletedTransfer> {
  await pause(300)
  const s = store.get(tid)
  if (!s) throw new Error('not_found')
  const rejected: CompletedTransfer['rejected'] = []
  for (const f of s.files) {
    const blob = blobs.get(f.id)
    if (!blob) {
      f.status = 'rejected'
      rejected.push({ file_id: f.id, reason: 'missing' })
      continue
    }
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
    if (detectExecutable(head)) {
      f.status = 'rejected'
      rejected.push({ file_id: f.id, reason: 'executable' })
    } else f.status = 'uploaded'
  }
  if (rejected.length === s.files.length) {
    s.transfer.status = 'deleted'
    throw new Error('no_valid_files')
  }
  s.transfer.status = 'ready'
  s.events.push({ id: eventSeq++, kind: 'ready', detail: {}, created_at: new Date().toISOString() })
  s.events.push({ id: eventSeq++, kind: 'invited', detail: {}, created_at: new Date().toISOString() })
  return { status: 'ready', rejected }
}

export async function downloadFile(fid: string) {
  for (const s of store.values()) {
    const f = s.files.find((x) => x.id === fid)
    if (!f) continue
    if (isExpired(s.transfer)) throw new Error('not_available')
    // Fichier déposé pendant la démo : on le rend tel quel. Sinon, un fichier
    // texte d'exemple (les fichiers de démonstration n'existent pas).
    const blob = blobs.get(fid) ?? new Blob([`Fichier de démonstration ORION Transfer : ${f.display_name}\n`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = blobs.has(fid) ? f.display_name : `${f.display_name}.demo.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    if (!mine(s) && s.recipients[0] && !s.recipients[0].first_downloaded_at) {
      s.recipients[0].first_downloaded_at = new Date().toISOString()
    }
    return
  }
  throw new Error('not_found')
}
