import { supabase } from './supabase'

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw error
}

/**
 * Lien de connexion à usage unique. Crée le compte s'il n'existe pas : c'est
 * ainsi qu'un destinataire invité récupère ses fichiers sans mot de passe.
 * La réponse est la même que le compte existe ou non (rien n'est révélé).
 */
export async function sendMagicLink(email: string, next = '/') {
  const redirect = new URL('/auth/callback', window.location.origin)
  redirect.searchParams.set('next', safeNextPath(next))
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: redirect.toString(), shouldCreateUser: true },
  })
  if (error) throw error
}

export async function signOut() {
  await supabase.auth.signOut()
}

/** N'accepte qu'un chemin interne, pour ne jamais rediriger vers un autre site. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/'
  return next
}

/**
 * Reprend une session transmise par ORION CORE ou le site (même mécanisme
 * que CORE : jetons dans le fragment `#`, effacés aussitôt de l'adresse).
 */
export async function acceptHandoffFromHash(): Promise<boolean> {
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return false
  const params = new URLSearchParams(raw)
  if (params.get('type') !== 'orion_handoff') return false

  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  if (!access_token || !refresh_token) return false

  const { error } = await supabase.auth.setSession({ access_token, refresh_token })
  if (error) throw error
  return true
}

export function displayName(meta: Record<string, unknown> | undefined, email: string | undefined): string {
  const first = meta?.first_name ?? meta?.given_name ?? meta?.full_name ?? meta?.name
  if (typeof first === 'string' && first.trim()) return first.trim()
  return email?.split('@')[0] ?? ''
}

export function initials(nameOrEmail: string): string {
  const parts = nameOrEmail.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}
