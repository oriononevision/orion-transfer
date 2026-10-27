import { AwsClient } from 'npm:aws4fetch@1.0.20'
import type { Storage } from './deps.ts'

/**
 * Stockage Cloudflare R2 (API compatible S3). Le bucket est PRIVÉ : tout
 * accès passe par une URL signée de courte durée, créée après vérification
 * des droits.
 */
export class R2Storage implements Storage {
  private client: AwsClient
  private base: string

  constructor(opts: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; endpoint?: string }) {
    this.client = new AwsClient({
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      service: 's3',
      region: 'auto',
    })
    const host = opts.endpoint?.replace(/\/+$/, '') || `https://${opts.accountId}.r2.cloudflarestorage.com`
    this.base = `${host}/${encodeURIComponent(opts.bucket)}`
  }

  private url(key: string): URL {
    // Les clés sont « uuid/uuid/uuid » : on garde les « / », on encode le reste.
    return new URL(`${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`)
  }

  private async presign(method: 'PUT' | 'GET', url: URL, expiresIn: number): Promise<string> {
    url.searchParams.set('X-Amz-Expires', String(expiresIn))
    const signed = await this.client.sign(new Request(url, { method }), { aws: { signQuery: true } })
    return signed.url
  }

  signUpload(key: string, expiresIn: number): Promise<string> {
    return this.presign('PUT', this.url(key), expiresIn)
  }

  signDownload(key: string, fileName: string, expiresIn: number): Promise<string> {
    const url = this.url(key)
    url.searchParams.set('response-content-disposition', contentDisposition(fileName))
    // Type générique : le navigateur télécharge, il n'affiche ni n'exécute.
    url.searchParams.set('response-content-type', 'application/octet-stream')
    return this.presign('GET', url, expiresIn)
  }

  async size(key: string): Promise<number | null> {
    const res = await this.client.fetch(this.url(key), { method: 'HEAD' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`storage_head_${res.status}`)
    return Number(res.headers.get('content-length') ?? '0')
  }

  async readHead(key: string, bytes: number): Promise<Uint8Array> {
    const res = await this.client.fetch(this.url(key), { headers: { Range: `bytes=0-${bytes - 1}` } })
    if (res.status === 416) return new Uint8Array()
    if (!res.ok) throw new Error(`storage_get_${res.status}`)
    return new Uint8Array(await res.arrayBuffer()).slice(0, bytes)
  }

  async remove(key: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw new Error(`storage_delete_${res.status}`)
  }
}

/** « attachment » avec un nom ASCII de secours et le nom exact en UTF-8. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'fichier'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}
