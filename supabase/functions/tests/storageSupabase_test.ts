/**
 * Vérifie le stockage Supabase contre un faux serveur Storage local :
 * liens signés de dépôt et de téléchargement, taille, début du fichier,
 * suppression.
 */
import { assert, assertEquals, assertStringIncludes } from './assert.ts'
import { SupabaseStorage } from '../_shared/storageSupabase.ts'

Deno.test('stockage Supabase : liens signés, taille, lecture, suppression', async () => {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>([['orion-transfer/u/t/f', new Uint8Array([0x25, 0x50, 0x44, 0x46, 9, 9])]])
  const auth: string[] = []
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url)
    const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ''))
    auth.push(req.headers.get('authorization') ?? '')
    if (req.method === 'POST' && path.startsWith('/object/upload/sign/')) {
      const key = path.replace('/object/upload/sign/', '')
      return Response.json({ url: `/object/upload/sign/${key}?token=tok-up`, token: 'tok-up' })
    }
    if (req.method === 'POST' && path.startsWith('/object/sign/')) {
      const body = await req.json()
      const key = path.replace('/object/sign/', '')
      return Response.json({ signedURL: `/object/sign/${key}?token=tok-dl&exp=${body.expiresIn}` })
    }
    if (req.method === 'DELETE' && path === '/object/orion-transfer') {
      const body = await req.json()
      for (const p of body.prefixes) objects.delete(`orion-transfer/${p}`)
      return Response.json([])
    }
    const key = path.replace('/object/authenticated/', '')
    const obj = objects.get(key)
    if (!obj) return new Response(null, { status: 404 })
    if (req.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(obj.length) } })
    const range = /bytes=0-(\d+)/.exec(req.headers.get('range') ?? '')
    return new Response(range ? obj.slice(0, Number(range[1]) + 1) : obj, { status: range ? 206 : 200 })
  })
  try {
    const storage = new SupabaseStorage({ url: `http://localhost:${server.addr.port}`, serviceKey: 'service-key', bucket: 'orion-transfer' })

    const up = new URL(await storage.signUpload('u/t/f', 900))
    assertStringIncludes(up.pathname, '/storage/v1/object/upload/sign/orion-transfer/u/t/f')
    assertEquals(up.searchParams.get('token'), 'tok-up')

    const dl = new URL(await storage.signDownload('u/t/f', 'rapport final.pdf', 120))
    assertStringIncludes(dl.pathname, '/object/sign/orion-transfer/u/t/f')
    assertEquals(dl.searchParams.get('exp'), '120')
    assert(dl.searchParams.has('download'), 'le fichier est servi en téléchargement')

    assertEquals(await storage.size('u/t/f'), 6)
    assertEquals(await storage.size('u/t/absent'), null)
    assertEquals([...(await storage.readHead('u/t/f', 4))], [0x25, 0x50, 0x44, 0x46])

    await storage.remove('u/t/f')
    assertEquals(await storage.size('u/t/f'), null)
    assert(auth.every((a) => a === 'Bearer service-key'), 'chaque appel utilise la clé serveur')
  } finally {
    await server.shutdown()
  }
})
