import { AppError, type Config } from './deps.ts'

/** Codes d'erreur de la base → statut HTTP. Tout le reste devient « unknown ». */
const KNOWN: Record<string, number> = {
  not_authenticated: 401,
  email_not_verified: 403,
  invalid_expiry: 400,
  message_too_long: 400,
  daily_limit_reached: 429,
  no_recipients: 400,
  too_many_recipients: 400,
  invalid_recipient: 400,
  no_files: 400,
  too_many_files: 400,
  invalid_file_size: 400,
  file_too_large: 400,
  invalid_file_name: 400,
  blocked_file_type: 400,
  transfer_too_large: 400,
  storage_quota_exceeded: 413,
  not_found: 404,
  not_available: 410,
  files_pending: 409,
  no_valid_files: 422,
  invalid_request: 400,
  forbidden: 403,
}

export function corsHeaders(req: Request, config: Config): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allowed = config.allowedOrigins.includes(origin) ? origin : config.allowedOrigins[0] ?? ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function json(req: Request, config: Config, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, config), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/** Transforme n'importe quelle erreur en réponse sans détail interne. */
export function errorResponse(req: Request, config: Config, err: unknown, log?: (m: string, d?: Record<string, unknown>) => void): Response {
  let code = 'unknown'
  let status = 500
  if (err instanceof AppError) {
    code = err.code
    status = err.status
  } else {
    const message = err instanceof Error ? err.message : String(err)
    const candidate = message.trim()
    if (candidate in KNOWN) {
      code = candidate
      status = KNOWN[candidate]
    }
  }
  if (status >= 500) log?.('erreur interne', { error: err instanceof Error ? err.message : String(err) })
  return json(req, config, { error: code }, status)
}

export function bearer(req: Request): string | null {
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get('content-length') ?? '0')
  if (length > maxBytes) throw new AppError('invalid_request')
  const text = await req.text()
  if (text.length > maxBytes) throw new AppError('invalid_request')
  try {
    const value = JSON.parse(text)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // ignoré : réponse générique ci-dessous
  }
  throw new AppError('invalid_request')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function uuidParam(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || !UUID.test(value)) throw new AppError('invalid_request')
  return value
}
