/**
 * Vérifie le client R2 contre un faux serveur S3 local : URL signées
 * correctes, requêtes signées, gestion des fichiers absents.
 */
import { assert, assertEquals, assertStringIncludes } from './assert.ts'
import { contentDisposition, R2Storage } from '../_shared/storageR2.ts'

Deno.test('URL signées de dépôt et de téléchargement', async () => {
  const r2 = new R2Storage({ accountId: 'acc', accessKeyId: 'AKID', secretAccessKey: 'secret', bucket: 'orion-transfer' })
  const put = new URL(await r2.signUpload('u1/t1/f1', 900))
  assertEquals(put.host, 'acc.r2.cloudflarestorage.com')
  assertEquals(put.pathname, '/orion-transfer/u1/t1/f1')
  assertEquals(put.searchParams.get('X-Amz-Expires'), '900')
  assertEquals(put.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256')
  assert(put.searchParams.get('X-Amz-Signature')?.length === 64)

  const get = new URL(await r2.signDownload('u1/t1/f1', 'Résumé "final".pdf', 120))
  assertEquals(get.searchParams.get('X-Amz-Expires'), '120')
  assertEquals(get.searchParams.get('response-content-type'), 'application/octet-stream')
  assertStringIncludes(get.searchParams.get('response-content-disposition')!, 'attachment;')
})

Deno.test('nom de fichier en pièce jointe sans injection', () => {
  assertEquals(
    contentDisposition('Résumé "final".pdf'),
    `attachment; filename="Re_sume_ _final_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf`,
  )
})

Deno.test('taille, début de fichier et suppression via l’API S3', async () => {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>([['/b/u/t/f', new Uint8Array([1, 2, 3, 4, 5])]])
  const seen: string[] = []
  const server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
    const path = new URL(req.url).pathname
    seen.push(`${req.method} ${path} ${req.headers.get('authorization')?.slice(0, 16)}`)
    const obj = objects.get(path)
    if (req.method === 'DELETE') {
      objects.delete(path)
      return new Response(null, { status: 204 })
    }
    if (!obj) return new Response(null, { status: 404 })
    if (req.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(obj.length) } })
    const range = /bytes=0-(\d+)/.exec(req.headers.get('range') ?? '')
    return new Response(range ? obj.slice(0, Number(range[1]) + 1) : obj, { status: range ? 206 : 200 })
  })
  try {
    const r2 = new R2Storage({ accountId: 'x', accessKeyId: 'AKID', secretAccessKey: 's', bucket: 'b', endpoint: `http://localhost:${server.addr.port}` })
    assertEquals(await r2.size('u/t/f'), 5)
    assertEquals(await r2.size('u/t/absent'), null)
    assertEquals([...(await r2.readHead('u/t/f', 2))], [1, 2])
    await r2.remove('u/t/f')
    assertEquals(await r2.size('u/t/f'), null)
    assert(seen.every((line) => line.endsWith('AWS4-HMAC-SHA256')), 'chaque requête est signée')
  } finally {
    await server.shutdown()
  }
})
