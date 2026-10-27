/**
 * Parcours complet des fonctions serveur sur une vraie base PostgreSQL
 * (migration réelle, règles d'accès réelles). Lancer avec
 * scripts/test-functions.sh.
 */
import postgres from 'npm:postgres@3.4.7'
import { assert, assertEquals, assertMatch, assertStringIncludes } from './assert.ts'
import { handleCleanup, handleComplete, handleCreate, handleDownload } from '../_shared/handlers.ts'
import { call, makeDeps } from './helpers.ts'

const sql = postgres(Deno.env.get('DATABASE_URL')!, { onnotice: () => {}, max: 4 })

const ALICE = 'a0000000-0000-4000-8000-000000000001'
const BOB = 'b0000000-0000-4000-8000-000000000002'
const MALLORY = 'c0000000-0000-4000-8000-000000000003'

await sql`insert into auth.users (id, email, email_confirmed_at) values
  (${ALICE}, 'alice@orion.dev', now()), (${BOB}, 'bob@orion.dev', now()), (${MALLORY}, 'mallory@evil.test', now())
  on conflict do nothing`
await sql`insert into public.profiles (id, email, first_name, last_name) values (${ALICE}, 'alice@orion.dev', 'Alice', 'Martin') on conflict do nothing`

const enc = new TextEncoder()
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...enc.encode('contenu du zip')])
const TEXT = enc.encode('# Notes de version\n')
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])

async function body(res: Response) {
  return await res.json()
}

/** Crée un envoi et dépose les fichiers ; renvoie l'identifiant et les URL. */
async function createAndUpload(
  ctx: ReturnType<typeof makeDeps>,
  files: Array<{ name: string; bytes: Uint8Array; declared?: number }>,
  recipients = ['bob@orion.dev'],
  message: string | null = null,
) {
  const res = await handleCreate(
    call(ALICE, {
      recipients,
      expiry_days: 7,
      message,
      files: files.map((f) => ({ name: f.name, size: f.declared ?? f.bytes.length })),
    }),
    ctx.deps,
  )
  assertEquals(res.status, 200, JSON.stringify(await res.clone().json()))
  const created = await body(res)
  created.uploads.forEach((
    u: { url?: string; chunks?: Array<{ url: string; start: number; end: number }> },
    i: number,
  ) => {
    const bytes = files[i].bytes
    if (!bytes.length) return
    if (u.chunks?.length) {
      for (const chunk of u.chunks) {
        ctx.storage.put(chunk.url, bytes.slice(chunk.start, chunk.end))
      }
      return
    }
    if (u.url) ctx.storage.put(u.url, bytes)
  })
  return created as {
    transfer_id: string
    uploads: Array<{ file_id: string; url?: string; chunks?: Array<{ url: string }> }>
  }
}

Deno.test('refuse une requête sans session', async () => {
  const { deps } = makeDeps(sql)
  const res = await handleCreate(call(null, {}), deps)
  assertEquals(res.status, 401)
  assertEquals((await body(res)).error, 'not_authenticated')
})

Deno.test('répond au préflight CORS seulement pour les origines autorisées', async () => {
  const { deps } = makeDeps(sql)
  const ok = await handleCreate(call(null, null, { method: 'OPTIONS', origin: 'http://localhost:5175' }), deps)
  assertEquals(ok.headers.get('access-control-allow-origin'), 'http://localhost:5175')
  const other = await handleCreate(call(null, null, { method: 'OPTIONS', origin: 'https://evil.test' }), deps)
  assertEquals(other.headers.get('access-control-allow-origin'), 'https://transfer.orion.test')
})

Deno.test('parcours complet : envoi, vérification, e-mails, téléchargement', async () => {
  const ctx = makeDeps(sql)
  const created = await createAndUpload(
    ctx,
    [{ name: 'build.zip', bytes: ZIP }, { name: 'notes.md', bytes: TEXT }],
    ['bob@orion.dev', 'invite@client.fr'],
    'Voici le build <script>alert(1)</script>',
  )
  assertEquals(created.uploads.length, 2)
  assertMatch(created.uploads[0].chunks?.[0]?.url ?? '', /expires=/)

  // Un autre utilisateur ne peut pas valider l'envoi d'Alice.
  const stolen = await handleComplete(call(MALLORY, { transfer_id: created.transfer_id }), ctx.deps)
  assertEquals(stolen.status, 404)

  const done = await handleComplete(call(ALICE, { transfer_id: created.transfer_id }), ctx.deps)
  assertEquals(done.status, 200)
  assertEquals(await body(done), { status: 'ready', rejected: [] })

  // Un e-mail par destinataire, sans lien de téléchargement direct.
  assertEquals(ctx.mailer.sent.map((m) => m.to).sort(), ['bob@orion.dev', 'invite@client.fr'])
  const mail = ctx.mailer.sent.find((m) => m.to === 'invite@client.fr')!
  assertEquals(mail.subject, 'Alice Martin vous a envoyé 2 fichiers')
  assertStringIncludes(mail.html, '&lt;script&gt;')
  assert(!mail.html.includes('<script>'), 'le message doit être échappé')
  assert(!mail.html.includes('storage.test') && !mail.text.includes('storage.test'), 'aucun lien de stockage dans l’e-mail')
  assertStringIncludes(mail.text, '/connexion?invite=1&email=invite%40client.fr&next=%2Ft%2F' + created.transfer_id)

  // Appel répété : sans effet, pas de second e-mail.
  const again = await handleComplete(call(ALICE, { transfer_id: created.transfer_id }), ctx.deps)
  assertEquals((await body(again)).status, 'ready')
  assertEquals(ctx.mailer.sent.length, 2)

  // Bob télécharge : URL courte, en pièce jointe.
  const fileId = created.uploads[0].file_id
  const dl = await handleDownload(call(BOB, { file_id: fileId }), ctx.deps)
  assertEquals(dl.status, 200)
  const url = new URL((await body(dl)).url)
  assertEquals(url.searchParams.get('expires'), '300')
  assertStringIncludes(url.searchParams.get('disposition')!, 'attachment')

  // Mallory ne peut pas, même avec l'identifiant exact.
  const denied = await handleDownload(call(MALLORY, { file_id: fileId }), ctx.deps)
  assertEquals(denied.status, 404)
  assertEquals((await body(denied)).error, 'not_found')
})

Deno.test('un programme renommé en .pdf est refusé sur son contenu réel', async () => {
  const ctx = makeDeps(sql)
  const created = await createAndUpload(ctx, [{ name: 'rapport.pdf', bytes: EXE }, { name: 'notes.md', bytes: TEXT }])
  const done = await handleComplete(call(ALICE, { transfer_id: created.transfer_id }), ctx.deps)
  const result = await body(done)
  assertEquals(result.status, 'ready')
  assertEquals(result.rejected, [{ file_id: created.uploads[0].file_id, reason: 'executable' }])
  assertEquals(ctx.mailer.sent[0].subject, 'Alice Martin vous a envoyé 1 fichier')

  const dl = await handleDownload(call(BOB, { file_id: created.uploads[0].file_id }), ctx.deps)
  assertEquals(dl.status, 410)
})

Deno.test('un fichier plus gros que déclaré, ou absent, est refusé', async () => {
  const ctx = makeDeps(sql)
  const created = await createAndUpload(ctx, [
    { name: 'a.txt', bytes: TEXT, declared: 3 },
    { name: 'jamais-envoye.txt', bytes: new Uint8Array(), declared: 10 },
    { name: 'ok.zip', bytes: ZIP },
  ])
  const result = await body(await handleComplete(call(ALICE, { transfer_id: created.transfer_id }), ctx.deps))
  assertEquals(result.rejected.map((r: { reason: string }) => r.reason).sort(), ['missing', 'size_mismatch'])
})

Deno.test('un envoi sans aucun fichier valide n’est jamais publié', async () => {
  const ctx = makeDeps(sql)
  const created = await createAndUpload(ctx, [{ name: 'setup.pdf', bytes: EXE }])
  const res = await handleComplete(call(ALICE, { transfer_id: created.transfer_id }), ctx.deps)
  assertEquals(res.status, 422)
  assertEquals((await body(res)).error, 'no_valid_files')
  assertEquals(ctx.mailer.sent.length, 0)
})

Deno.test('les erreurs de saisie sont renvoyées avec un code lisible', async () => {
  const { deps } = makeDeps(sql)
  const exe = await handleCreate(call(ALICE, { recipients: ['bob@orion.dev'], files: [{ name: 'setup.exe', size: 10 }] }), deps)
  assertEquals((await body(exe)).error, 'blocked_file_type')
  const bad = await handleCreate(call(ALICE, { recipients: 'pas une liste', files: [] }), deps)
  assertEquals(bad.status, 400)
  const garbage = await handleComplete(call(ALICE, { transfer_id: "'; drop table transfer.files; --" }), deps)
  assertEquals((await body(garbage)).error, 'invalid_request')
})

Deno.test('nettoyage : protégé par secret, expire et efface du stockage', async () => {
  const ctx = makeDeps(sql)
  const created = await createAndUpload(ctx, [{ name: 'vieux.zip', bytes: ZIP }])
  await handleComplete(call(ALICE, { transfer_id: created.transfer_id }), ctx.deps)
  const key = [...ctx.storage.objects.keys()][0]

  const refused = await handleCleanup(call('mauvais-secret', {}), ctx.deps)
  assertEquals(refused.status, 403)

  await sql`update transfer.transfers set expires_at = now() - interval '1 minute' where id = ${created.transfer_id}`
  const res = await handleCleanup(call('secret-de-test', {}), ctx.deps)
  const result = await body(res)
  assert(result.expired >= 1, 'au moins un transfert expiré')
  assert(result.purged >= 1, 'au moins un fichier effacé')
  assert(!ctx.storage.objects.has(key), 'le fichier a disparu du stockage')
})

Deno.test({
  name: 'fermeture',
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    await sql.end()
  },
})
