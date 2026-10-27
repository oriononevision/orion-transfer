import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import type { CreatedRpc, Db, TransferForCheck } from './deps.ts'

/** Accès à la base via Supabase (production). */
export class SupabaseDb implements Db {
  private admin: SupabaseClient

  constructor(private url: string, private anonKey: string, serviceKey: string) {
    this.admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  }

  /** Client qui agit AU NOM de l'utilisateur : les règles d'accès s'appliquent. */
  private asUser(token: string): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  private async rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await client.schema('transfer').rpc(fn, args)
    if (error) throw new Error(error.message)
    return data as T
  }

  async userIdFromToken(token: string): Promise<string | null> {
    const { data, error } = await this.admin.auth.getUser(token)
    if (error || !data.user) return null
    return data.user.id
  }

  createTransfer(token: string, a: Parameters<Db['createTransfer']>[1]): Promise<CreatedRpc> {
    return this.rpc(this.asUser(token), 'create_transfer', {
      p_recipients: a.recipients,
      p_files: a.files,
      p_expiry_days: a.expiryDays,
      p_message: a.message,
    })
  }

  authorizeDownload(token: string, fileId: string) {
    return this.rpc<{ storage_key: string; name: string; size: number }>(this.asUser(token), 'authorize_download', { p_file_id: fileId })
  }

  filesForCheck(transferId: string) {
    return this.rpc<TransferForCheck | null>(this.admin, 'files_for_check', { p_transfer_id: transferId })
  }

  async recordFileCheck(fileId: string, actualSize: number, detectedType: string, rejectedReason: string | null) {
    await this.rpc(this.admin, 'record_file_check', {
      p_file_id: fileId,
      p_actual_size: actualSize,
      p_detected_type: detectedType,
      p_rejected_reason: rejectedReason,
    })
  }

  finalizeTransfer(transferId: string) {
    return this.rpc<{ sender_id: string; recipients: string[]; expires_at: string }>(this.admin, 'finalize_transfer', { p_transfer_id: transferId })
  }

  senderInfo(userId: string) {
    return this.rpc<{ email: string; name: string | null }>(this.admin, 'sender_info', { p_user_id: userId })
  }

  expireDue() {
    return this.rpc<number>(this.admin, 'expire_due')
  }

  purgeCandidates(limit: number) {
    return this.rpc<Array<{ file_id: string; storage_key: string }>>(this.admin, 'purge_candidates', { p_limit: limit })
  }

  async markPurged(fileIds: string[]) {
    await this.rpc(this.admin, 'mark_purged', { p_file_ids: fileIds })
  }
}
