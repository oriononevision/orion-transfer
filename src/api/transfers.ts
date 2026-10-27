/**
 * Accès aux données de TRANSFER.
 *
 * Lectures : fonctions SQL du schéma `transfer` (protégées par les règles
 * d'accès). Écritures sensibles (créer un envoi, valider les fichiers,
 * signer un téléchargement) : fonctions serveur Supabase, qui seules
 * détiennent les clés du stockage.
 */
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase, transferDb } from '../lib/supabase'
import * as demo from '../demo/demoApi'

/** Mode démonstration : aucune donnée réelle, aucun serveur (voir src/demo). */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1'

export type TransferStatus = 'uploading' | 'ready' | 'expired' | 'deleted'

export type InboxItem = {
  id: string
  sender_name: string | null
  sender_email: string
  message: string | null
  status: TransferStatus
  expires_at: string
  total_bytes: number
  file_count: number
  created_at: string
  first_downloaded_at: string | null
}

export type OutboxItem = {
  id: string
  recipient_emails: string[]
  recipient_count: number
  downloaded_count: number
  message: string | null
  status: TransferStatus
  expires_at: string
  total_bytes: number
  file_count: number
  created_at: string
}

export type TransferRow = {
  id: string
  sender_id: string
  message: string | null
  status: TransferStatus
  expires_at: string
  total_bytes: number
  file_count: number
  created_at: string
}

export type FileRow = {
  id: string
  display_name: string
  relative_path: string | null
  size_bytes: number
  detected_type: string | null
  status: 'pending' | 'uploaded' | 'rejected'
}

export type RecipientRow = {
  id: string
  email: string
  revoked_at: string | null
  first_downloaded_at: string | null
}

export type EventRow = {
  id: number
  kind: 'created' | 'ready' | 'invited' | 'downloaded' | 'revoked' | 'deleted' | 'expired'
  detail: Record<string, unknown>
  created_at: string
}

export type Usage = { active_bytes: number }

/** Erreur dont le message est un code connu (« storage_quota_exceeded »…). */
export class TransferError extends Error {}

function fail(error: { message?: string } | null | undefined): never {
  throw new TransferError(error?.message?.trim() || 'unknown')
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function claimInvitations(): Promise<void> {
  if (IS_DEMO) return
  const { error } = await transferDb.rpc('claim_invitations')
  if (error) fail(error)
}

export async function fetchInbox(): Promise<InboxItem[]> {
  if (IS_DEMO) return demo.fetchInbox()
  const { data, error } = await transferDb.rpc('inbox', { p_limit: 50 })
  if (error) fail(error)
  return (data ?? []) as InboxItem[]
}

export async function fetchOutbox(): Promise<OutboxItem[]> {
  if (IS_DEMO) return demo.fetchOutbox()
  const { data, error } = await transferDb.rpc('outbox', { p_limit: 50 })
  if (error) fail(error)
  return (data ?? []) as OutboxItem[]
}

export async function fetchUsage(): Promise<Usage> {
  if (IS_DEMO) return demo.fetchUsage()
  const { data, error } = await transferDb.rpc('my_usage')
  if (error) fail(error)
  return { active_bytes: Number((data as { active_bytes?: number })?.active_bytes ?? 0) }
}

export type TransferDetail = {
  transfer: TransferRow
  files: FileRow[]
  recipients: RecipientRow[]
  events: EventRow[]
}

/** Les règles d'accès filtrent : un transfert inaccessible renvoie null. */
export async function fetchTransfer(id: string): Promise<TransferDetail | null> {
  if (IS_DEMO) return demo.fetchTransfer(id)
  const [t, f, r, e] = await Promise.all([
    transferDb.from('transfers').select('id, sender_id, message, status, expires_at, total_bytes, file_count, created_at').eq('id', id).maybeSingle(),
    transferDb.from('files').select('id, display_name, relative_path, size_bytes, detected_type, status').eq('transfer_id', id).order('display_name'),
    transferDb.from('recipients').select('id, email, revoked_at, first_downloaded_at').eq('transfer_id', id).order('created_at'),
    transferDb.from('events').select('id, kind, detail, created_at').eq('transfer_id', id).order('created_at', { ascending: false }).limit(50),
  ])
  for (const res of [t, f, r, e]) if (res.error) fail(res.error)
  if (!t.data) return null
  return {
    transfer: t.data as TransferRow,
    files: (f.data ?? []) as FileRow[],
    recipients: (r.data ?? []) as RecipientRow[],
    events: (e.data ?? []) as EventRow[],
  }
}

// ---------------------------------------------------------------------------
// Actions de l'expéditeur
// ---------------------------------------------------------------------------

export async function revokeRecipient(recipientId: string): Promise<void> {
  if (IS_DEMO) return demo.revokeRecipient(recipientId)
  const { error } = await transferDb.rpc('revoke_recipient', { p_recipient_id: recipientId })
  if (error) fail(error)
}

export async function deleteTransfer(transferId: string): Promise<void> {
  if (IS_DEMO) return demo.deleteTransfer(transferId)
  const { error } = await transferDb.rpc('delete_transfer', { p_transfer_id: transferId })
  if (error) fail(error)
}

// ---------------------------------------------------------------------------
// Fonctions serveur (envoi et téléchargement)
// ---------------------------------------------------------------------------

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new TransferError(typeof payload?.error === 'string' ? payload.error : 'unknown')
    }
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('failed to send') || msg.includes('fetch') || msg.includes('network')) {
      throw new TransferError('network')
    }
    throw new TransferError('network')
  }
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
    throw new TransferError((data as { error: string }).error)
  }
  return data as T
}

export type OrionMember = {
  id: string
  email: string
  display_name: string | null
}

/** Membres ORION (profils) pour le destinataire « membre ». */
export async function searchOrionMembers(query = '', limit = 12): Promise<OrionMember[]> {
  if (IS_DEMO) {
    const demo = [
      { id: 'demo-1', email: 'alice@orion.dev', display_name: 'Alice' },
      { id: 'demo-2', email: 'bob@orion.dev', display_name: 'Bob' },
    ]
    const q = query.trim().toLowerCase()
    return demo.filter((m) => !q || m.email.includes(q) || (m.display_name?.toLowerCase().includes(q) ?? false)).slice(0, limit)
  }
  const { data, error } = await transferDb.rpc('search_members', {
    p_query: query,
    p_limit: limit,
  })
  if (error) fail(error)
  return (data ?? []) as OrionMember[]
}

export type NewFile = { name: string; size: number; type?: string; path?: string }

export type CreatedTransfer = {
  transfer_id: string
  expires_at: string
  uploads: Array<{ file_id: string; name: string; url: string }>
}

export function createTransfer(input: {
  recipients: string[]
  files: NewFile[]
  expiryDays: number
  message?: string
}): Promise<CreatedTransfer> {
  if (IS_DEMO) return demo.createTransfer(input)
  return invoke('transfer-create', {
    recipients: input.recipients,
    files: input.files,
    expiry_days: input.expiryDays,
    message: input.message || null,
  })
}

export type CompletedTransfer = {
  status: 'ready'
  rejected: Array<{ file_id: string; reason: string }>
}

export function completeTransfer(transferId: string): Promise<CompletedTransfer> {
  if (IS_DEMO) return demo.completeTransfer(transferId)
  return invoke('transfer-complete', { transfer_id: transferId })
}

export async function downloadFile(fileId: string): Promise<void> {
  if (IS_DEMO) return demo.downloadFile(fileId)
  const { url } = await invoke<{ url: string }>('transfer-download', { file_id: fileId })
  // URL signée de courte durée, servie depuis le domaine du stockage avec
  // « Content-Disposition: attachment » : le fichier n'est jamais affiché ni
  // exécuté dans l'application.
  window.location.assign(url)
}

/**
 * Dépose un fichier directement dans le stockage (sans passer par nos
 * serveurs), avec suivi de progression.
 */
export function uploadToSignedUrl(
  url: string,
  file: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (IS_DEMO) return demo.uploadToSignedUrl(url, file, onProgress)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new TransferError('upload_failed')))
    xhr.onerror = () => reject(new TransferError('network'))
    xhr.onabort = () => reject(new TransferError('aborted'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}

// ---------------------------------------------------------------------------
// Réception en direct
// ---------------------------------------------------------------------------

/**
 * Prévient dès qu'un transfert reçu devient disponible, ou qu'un destinataire
 * télécharge un envoi. Supabase Realtime n'envoie à chaque navigateur que les
 * changements que ses règles d'accès l'autorisent à lire.
 * Renvoie une fonction pour se désabonner.
 */
export function subscribeToChanges(onChange: () => void): () => void {
  if (IS_DEMO) return demo.subscribe(onChange)
  const channel = supabase
    .channel('transfer-live')
    .on('postgres_changes', { event: '*', schema: 'transfer', table: 'transfers' }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'transfer', table: 'recipients' }, onChange)
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}
