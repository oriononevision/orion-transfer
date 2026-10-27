import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import type { Storage } from './deps.ts'
import { contentDisposition } from './storageR2.ts'

/**
 * Stockage via Supabase Storage (bucket privé).
 * Les gros fichiers sont découpés en morceaux `{key}/c/{i}` côté client.
 */
export class SupabaseStorage implements Storage {
  private admin: SupabaseClient
  private bucket: string
  private url: string
  private serviceKey: string

  constructor(opts: { url: string; serviceKey: string; bucket: string }) {
    this.url = opts.url.replace(/\/$/, '')
    this.serviceKey = opts.serviceKey
    this.bucket = opts.bucket
    this.admin = createClient(opts.url, opts.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  private objectUrl(key: string): string {
    const path = key.split('/').map(encodeURIComponent).join('/')
    return `${this.url}/storage/v1/object/${encodeURIComponent(this.bucket)}/${path}`
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
    }
  }

  async signUpload(key: string, _expiresIn: number): Promise<string> {
    const { data, error } = await this.admin.storage.from(this.bucket).createSignedUploadUrl(key, {
      upsert: true,
    })
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || 'storage_sign_upload')
    }
    return data.signedUrl
  }

  async signDownload(key: string, fileName: string, expiresIn: number): Promise<string> {
    const { data, error } = await this.admin.storage.from(this.bucket).createSignedUrl(key, expiresIn, {
      download: fileName,
    })
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || 'storage_sign_download')
    }
    const url = new URL(data.signedUrl)
    if (!url.searchParams.has('download')) {
      url.searchParams.set('response-content-disposition', contentDisposition(fileName))
    }
    return url.toString()
  }

  async size(key: string): Promise<number | null> {
    const res = await fetch(this.objectUrl(key), {
      method: 'HEAD',
      headers: this.authHeaders(),
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`storage_head_${res.status}`)
    return Number(res.headers.get('content-length') ?? '0')
  }

  async readHead(key: string, bytes: number): Promise<Uint8Array> {
    const res = await fetch(this.objectUrl(key), {
      headers: { ...this.authHeaders(), Range: `bytes=0-${Math.max(0, bytes - 1)}` },
    })
    if (res.status === 404 || res.status === 416) return new Uint8Array()
    if (!res.ok && res.status !== 206) throw new Error(`storage_get_${res.status}`)
    return new Uint8Array(await res.arrayBuffer()).slice(0, bytes)
  }

  async remove(key: string): Promise<void> {
    const toDelete = [key]
    const folder = `${key}/c`
    const { data: listed } = await this.admin.storage.from(this.bucket).list(folder, { limit: 1000 })
    if (listed?.length) {
      for (const row of listed) {
        if (row.name) toDelete.push(`${folder}/${row.name}`)
      }
    }
    const { error } = await this.admin.storage.from(this.bucket).remove(toDelete)
    if (error && !/not found|404/i.test(error.message)) throw new Error(error.message)
  }
}
