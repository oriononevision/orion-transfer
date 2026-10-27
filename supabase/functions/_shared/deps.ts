/**
 * Ce dont les fonctions serveur ont besoin, sous forme d'interfaces.
 * En production : Supabase, Cloudflare R2 et Resend (prod.ts).
 * En test : PostgreSQL local, stockage en mémoire, e-mails collectés.
 */

export type FileForCheck = {
  id: string
  storage_key: string
  size: number
  name: string
  status: 'pending' | 'uploaded' | 'rejected'
  rejected_reason: string | null
}

export type TransferForCheck = {
  id: string
  sender_id: string
  status: 'uploading' | 'ready' | 'expired' | 'deleted'
  message: string | null
  files: FileForCheck[]
}

export type CreatedRpc = {
  transfer_id: string
  expires_at: string
  files: Array<{ id: string; name: string; size: number; storage_key: string }>
}

export interface Db {
  /** Identifiant de l'utilisateur à qui appartient ce jeton, sinon null. */
  userIdFromToken(token: string): Promise<string | null>
  /** Appels faits AU NOM de l'utilisateur (auth.uid() = lui). */
  createTransfer(token: string, args: {
    recipients: string[]
    files: Array<{ name: string; size: number; type?: string | null; path?: string | null }>
    expiryDays: number
    message: string | null
  }): Promise<CreatedRpc>
  authorizeDownload(token: string, fileId: string): Promise<{ storage_key: string; name: string; size: number }>
  /** Appels réservés au serveur. */
  filesForCheck(transferId: string): Promise<TransferForCheck | null>
  recordFileCheck(fileId: string, actualSize: number, detectedType: string, rejectedReason: string | null): Promise<void>
  finalizeTransfer(transferId: string): Promise<{ sender_id: string; recipients: string[]; expires_at: string }>
  senderInfo(userId: string): Promise<{ email: string; name: string | null }>
  expireDue(): Promise<number>
  purgeCandidates(limit: number): Promise<Array<{ file_id: string; storage_key: string }>>
  markPurged(fileIds: string[]): Promise<void>
}

export interface Storage {
  /** URL signée pour déposer un fichier, valable `expiresIn` secondes. */
  signUpload(key: string, expiresIn: number): Promise<string>
  /** URL signée de téléchargement : toujours en pièce jointe, jamais affichée. */
  signDownload(key: string, fileName: string, expiresIn: number): Promise<string>
  /** Taille réelle de l'objet, ou null s'il n'existe pas. */
  size(key: string): Promise<number | null>
  /** Premiers octets de l'objet. */
  readHead(key: string, bytes: number): Promise<Uint8Array>
  /** Efface l’objet et, le cas échéant, ses morceaux `{key}/c/*`. */
  remove(key: string): Promise<void>
}

export type Mail = { to: string; subject: string; html: string; text: string }

export interface Mailer {
  send(mail: Mail): Promise<void>
}

export type Config = {
  appUrl: string
  allowedOrigins: string[]
  cronSecret: string | null
  mailFrom: string
}

export type Deps = { db: Db; storage: Storage; mailer: Mailer; config: Config; log?: (msg: string, data?: Record<string, unknown>) => void }

/** Erreur dont le message est un code connu de l'interface (fr.ts). */
export class AppError extends Error {
  constructor(public code: string, public status = 400) {
    super(code)
  }
}
