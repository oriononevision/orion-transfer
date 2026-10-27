/**
 * Doublures de test : base PostgreSQL locale (vraies fonctions SQL et vraies
 * règles d'accès), stockage en mémoire, e-mails collectés.
 */
import postgres from 'npm:postgres@3.4.7'
import type { CreatedRpc, Db, Deps, Mail, Mailer, Storage, TransferForCheck } from '../_shared/deps.ts'

type Sql = ReturnType<typeof postgres>

/** En test, le « jeton » est simplement l'identifiant de l'utilisateur. */
export class PgDb implements Db {
  constructor(public sql: Sql) {}

  private as<T>(role: 'authenticated' | 'service_role', userId: string | null, run: (tx: Sql) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${userId ?? ''}, true)`
      await tx.unsafe(`set local role ${role}`)
      return run(tx as unknown as Sql)
    }) as Promise<T>
  }

  private one<T>(role: 'authenticated' | 'service_role', userId: string | null, query: (tx: Sql) => Promise<Array<{ r: T }>>) {
    return this.as(role, userId, async (tx) => (await query(tx))[0]?.r as T)
  }

  async userIdFromToken(token: string) {
    const rows = await this.sql`select id from auth.users where id::text = ${token}`
    return rows.length ? token : null
  }

  createTransfer(token: string, a: Parameters<Db['createTransfer']>[1]) {
    return this.one<CreatedRpc>('authenticated', token, (tx) =>
      tx`select transfer.create_transfer(${tx.array(a.recipients)}::text[], ${tx.json(a.files as unknown as postgres.JSONValue)}, ${a.expiryDays}, ${a.message}) as r`)
  }

  authorizeDownload(token: string, fileId: string) {
    return this.one<{ storage_key: string; name: string; size: number }>('authenticated', token, (tx) =>
      tx`select transfer.authorize_download(${fileId}::uuid) as r`)
  }

  filesForCheck(transferId: string) {
    return this.one<TransferForCheck | null>('service_role', null, (tx) => tx`select transfer.files_for_check(${transferId}::uuid) as r`)
  }

  async recordFileCheck(fileId: string, actualSize: number, detectedType: string, reason: string | null) {
    await this.as('service_role', null, (tx) => tx`select transfer.record_file_check(${fileId}::uuid, ${actualSize}, ${detectedType}, ${reason})`)
  }

  finalizeTransfer(transferId: string) {
    return this.one<{ sender_id: string; recipients: string[]; expires_at: string }>('service_role', null, (tx) =>
      tx`select transfer.finalize_transfer(${transferId}::uuid) as r`)
  }

  senderInfo(userId: string) {
    return this.one<{ email: string; name: string | null }>('service_role', null, (tx) => tx`select transfer.sender_info(${userId}::uuid) as r`)
  }

  expireDue() {
    return this.one<number>('service_role', null, (tx) => tx`select transfer.expire_due() as r`)
  }

  purgeCandidates(limit: number) {
    return this.as('service_role', null, async (tx) =>
      (await tx`select file_id, storage_key from transfer.purge_candidates(${limit})`) as unknown as Array<{ file_id: string; storage_key: string }>)
  }

  async markPurged(ids: string[]) {
    await this.as('service_role', null, (tx) => tx`select transfer.mark_purged(${tx.array(ids)}::uuid[])`)
  }
}

export class MemoryStorage implements Storage {
  objects = new Map<string, Uint8Array>()

  put(uploadUrl: string, bytes: Uint8Array) {
    const key = decodeURIComponent(new URL(uploadUrl).pathname.replace(/^\/put\//, ''))
    this.objects.set(key, bytes)
  }

  signUpload(key: string, expiresIn: number) {
    return Promise.resolve(`https://storage.test/put/${encodeURIComponent(key)}?expires=${expiresIn}`)
  }

  signDownload(key: string, fileName: string, expiresIn: number) {
    const url = new URL(`https://storage.test/get/${encodeURIComponent(key)}`)
    url.searchParams.set('expires', String(expiresIn))
    url.searchParams.set('disposition', `attachment; filename="${fileName}"`)
    return Promise.resolve(url.toString())
  }

  size(key: string) {
    return Promise.resolve(this.objects.get(key)?.length ?? null)
  }

  readHead(key: string, bytes: number) {
    return Promise.resolve((this.objects.get(key) ?? new Uint8Array()).slice(0, bytes))
  }

  remove(key: string) {
    this.objects.delete(key)
    return Promise.resolve()
  }
}

export class CollectMailer implements Mailer {
  sent: Mail[] = []
  send(mail: Mail) {
    this.sent.push(mail)
    return Promise.resolve()
  }
}

export function makeDeps(sql: Sql) {
  const storage = new MemoryStorage()
  const mailer = new CollectMailer()
  const deps: Deps = {
    db: new PgDb(sql),
    storage,
    mailer,
    config: {
      appUrl: 'https://transfer.orion.test',
      allowedOrigins: ['https://transfer.orion.test', 'http://localhost:5175'],
      cronSecret: 'secret-de-test',
      mailFrom: 'ORION Transfer <transfer@orion.test>',
    },
    log: () => {},
  }
  return { deps, storage, mailer }
}

export function call(token: string | null, body: unknown, init: { method?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: init.origin ?? 'https://transfer.orion.test' }
  if (token) headers.authorization = `Bearer ${token}`
  return new Request('https://functions.test/', {
    method: init.method ?? 'POST',
    headers,
    body: init.method === 'OPTIONS' ? undefined : JSON.stringify(body),
  })
}
