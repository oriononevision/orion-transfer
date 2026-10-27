/**
 * Assemblage de production. Les secrets viennent des « secrets » des
 * fonctions Supabase (jamais du navigateur, jamais du dépôt Git).
 */
import { SupabaseDb } from './dbSupabase.ts'
import type { Deps, Mail, Mailer, Storage } from './deps.ts'
import { R2Storage } from './storageR2.ts'
import { SupabaseStorage } from './storageSupabase.ts'

function env(name: string, required = true): string {
  const value = Deno.env.get(name)?.trim() ?? ''
  if (!value && required) throw new Error(`configuration_manquante_${name}`)
  return value
}

function buildStorage(): Storage {
  const accountId = env('R2_ACCOUNT_ID', false)
  const accessKeyId = env('R2_ACCESS_KEY_ID', false)
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY', false)
  const bucket = env('R2_BUCKET', false) || env('TRANSFER_BUCKET', false) || 'orion-transfer'
  if (accountId && accessKeyId && secretAccessKey) {
    return new R2Storage({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      endpoint: env('R2_ENDPOINT', false) || undefined,
    })
  }
  // Secours : bucket privé Supabase Storage (sans Cloudflare R2).
  return new SupabaseStorage({
    url: env('SUPABASE_URL'),
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    bucket,
  })
}

class ResendMailer implements Mailer {
  constructor(private apiKey: string, private from: string) {}

  async send(mail: Mail): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
    })
    if (!res.ok) throw new Error(`resend_${res.status}`)
  }
}

/** Sans clé Resend (développement), les e-mails ne partent pas : on le signale. */
class SkipMailer implements Mailer {
  send(): Promise<void> {
    console.warn('[transfer] RESEND_API_KEY absent : e-mail non envoyé')
    return Promise.resolve()
  }
}

let cached: Deps | null = null

export function prodDeps(): Deps {
  if (cached) return cached
  const resendKey = env('RESEND_API_KEY', false)
  const appUrl = env('APP_URL')
  cached = {
    db: new SupabaseDb(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), env('SUPABASE_SERVICE_ROLE_KEY')),
    storage: buildStorage(),
    mailer: resendKey ? new ResendMailer(resendKey, env('MAIL_FROM')) : new SkipMailer(),
    config: {
      appUrl,
      allowedOrigins: (env('ALLOWED_ORIGINS', false) || appUrl).split(',').map((o) => o.trim()).filter(Boolean),
      cronSecret: env('CRON_SECRET', false) || null,
      mailFrom: env('MAIL_FROM', false),
    },
    // Journal minimal : jamais de jeton, d'URL signée ni de contenu de fichier.
    log: (msg, data) => console.error(`[transfer] ${msg}`, data ? JSON.stringify(data) : ''),
  }
  return cached
}
