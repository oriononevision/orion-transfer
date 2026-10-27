/**
 * Logique des quatre fonctions serveur, indépendante de Supabase, R2 et
 * Resend (injectés via `deps`) pour pouvoir être testée de bout en bout.
 */
import { AppError, type Deps } from './deps.ts'
import { bearer, errorResponse, json, readJson, uuidParam, corsHeaders } from './http.ts'
import { detectExecutable, sniffType } from './fileRules.ts'
import { invitationMail } from './mailTemplate.ts'

/** 2 h : laisse le temps d’envoyer jusqu’à 1 Go sur une connexion moyenne. */
const UPLOAD_URL_SECONDS = 2 * 60 * 60
const DOWNLOAD_URL_SECONDS = 2 * 60

type Handler = (req: Request, deps: Deps) => Promise<Response>

/** Préflight CORS, méthode POST, gestion d'erreur commune. */
function endpoint(run: (req: Request, deps: Deps) => Promise<unknown>): Handler {
  return async (req, deps) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req, deps.config) })
    if (req.method !== 'POST') return json(req, deps.config, { error: 'invalid_request' }, 405)
    try {
      return json(req, deps.config, await run(req, deps))
    } catch (err) {
      return errorResponse(req, deps.config, err, deps.log)
    }
  }
}

async function requireUser(req: Request, deps: Deps): Promise<{ token: string; userId: string }> {
  const token = bearer(req)
  const userId = token ? await deps.db.userIdFromToken(token) : null
  if (!token || !userId) throw new AppError('not_authenticated', 401)
  return { token, userId }
}

// ---------------------------------------------------------------------------
// transfer-create : enregistre l'envoi et renvoie une URL de dépôt par fichier
// ---------------------------------------------------------------------------

export const handleCreate: Handler = endpoint(async (req, deps) => {
  const { token } = await requireUser(req, deps)
  const body = await readJson(req)

  const recipients = body.recipients
  const files = body.files
  if (!Array.isArray(recipients) || !recipients.every((r) => typeof r === 'string')) throw new AppError('invalid_recipient')
  if (!Array.isArray(files) || files.length === 0) throw new AppError('no_files')

  const cleanFiles = files.map((f) => {
    if (!f || typeof f !== 'object') throw new AppError('invalid_request')
    const { name, size, type, path } = f as Record<string, unknown>
    if (typeof name !== 'string' || typeof size !== 'number' || !Number.isSafeInteger(size)) throw new AppError('invalid_request')
    return {
      name,
      size,
      type: typeof type === 'string' ? type : null,
      path: typeof path === 'string' ? path : null,
    }
  })

  const created = await deps.db.createTransfer(token, {
    recipients: recipients as string[],
    files: cleanFiles,
    expiryDays: typeof body.expiry_days === 'number' ? body.expiry_days : 7,
    message: typeof body.message === 'string' ? body.message : null,
  })

  const uploads = await Promise.all(
    created.files.map(async (f) => ({
      file_id: f.id,
      name: f.name,
      url: await deps.storage.signUpload(f.storage_key, UPLOAD_URL_SECONDS),
    })),
  )

  return { transfer_id: created.transfer_id, expires_at: created.expires_at, uploads }
})

// ---------------------------------------------------------------------------
// transfer-complete : vérifie chaque fichier déposé, publie, prévient
// ---------------------------------------------------------------------------

export const handleComplete: Handler = endpoint(async (req, deps) => {
  const { userId } = await requireUser(req, deps)
  const transferId = uuidParam(await readJson(req), 'transfer_id')

  const transfer = await deps.db.filesForCheck(transferId)
  // Même réponse si le transfert n'existe pas ou appartient à quelqu'un d'autre.
  if (!transfer || transfer.sender_id !== userId) throw new AppError('not_found', 404)

  if (transfer.status === 'ready') {
    // Appel répété : rien à refaire.
    return {
      status: 'ready',
      rejected: transfer.files.filter((f) => f.status === 'rejected').map((f) => ({ file_id: f.id, reason: f.rejected_reason ?? 'rejected' })),
    }
  }
  if (transfer.status !== 'uploading') throw new AppError('not_found', 404)

  const rejected: Array<{ file_id: string; reason: string }> = []
  for (const file of transfer.files) {
    if (file.status !== 'pending') continue
    const actual = await deps.storage.size(file.storage_key)
    if (actual == null) {
      await deps.db.recordFileCheck(file.id, 0, 'missing', 'missing')
      rejected.push({ file_id: file.id, reason: 'missing' })
      continue
    }
    // Le contenu réel compte, pas le nom : un programme renommé en .pdf est refusé.
    const head = await deps.storage.readHead(file.storage_key, 16)
    const executable = detectExecutable(head)
    const reason = executable ? 'executable' : actual !== file.size ? 'size_mismatch' : null
    await deps.db.recordFileCheck(file.id, actual, sniffType(head), reason)
    if (reason) rejected.push({ file_id: file.id, reason })
  }

  const done = await deps.db.finalizeTransfer(transferId)

  // E-mails : un par destinataire (personne ne voit les autres adresses).
  // Un échec d'envoi d'e-mail n'annule pas le transfert.
  const sender = await deps.db.senderInfo(done.sender_id)
  const fileCount = transfer.files.length - rejected.length
  await Promise.all(
    done.recipients.map(async (to) => {
      try {
        await deps.mailer.send(
          invitationMail({
            to,
            senderName: sender.name,
            senderEmail: sender.email,
            fileCount,
            message: transfer.message,
            expiresAt: done.expires_at,
            transferId,
            appUrl: deps.config.appUrl,
          }),
        )
      } catch (err) {
        deps.log?.('e-mail non envoyé', { error: err instanceof Error ? err.message : String(err) })
      }
    }),
  )

  return { status: 'ready', rejected }
})

// ---------------------------------------------------------------------------
// transfer-download : vérifie le droit, renvoie une URL signée très courte
// ---------------------------------------------------------------------------

export const handleDownload: Handler = endpoint(async (req, deps) => {
  const { token } = await requireUser(req, deps)
  const fileId = uuidParam(await readJson(req), 'file_id')
  const file = await deps.db.authorizeDownload(token, fileId)
  return { url: await deps.storage.signDownload(file.storage_key, file.name, DOWNLOAD_URL_SECONDS) }
})

// ---------------------------------------------------------------------------
// transfer-cleanup : expiration et effacement du stockage (tâche planifiée)
// ---------------------------------------------------------------------------

export const handleCleanup: Handler = endpoint(async (req, deps) => {
  const secret = deps.config.cronSecret
  if (!secret || bearer(req) !== secret) throw new AppError('forbidden', 403)

  const expired = await deps.db.expireDue()
  let purged = 0
  for (let round = 0; round < 10; round += 1) {
    const batch = await deps.db.purgeCandidates(200)
    if (batch.length === 0) break
    const ok: string[] = []
    for (const item of batch) {
      try {
        await deps.storage.remove(item.storage_key)
        ok.push(item.file_id)
      } catch (err) {
        deps.log?.('effacement impossible', { file: item.file_id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    if (ok.length === 0) break
    await deps.db.markPurged(ok)
    purged += ok.length
  }
  return { expired, purged }
})
