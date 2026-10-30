import { supabase } from './supabase'

export function authErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Une erreur est survenue.'

  const msg = raw.toLowerCase()
  if (msg.includes('invalid login credentials')) {
    return 'E-mail ou mot de passe incorrect.'
  }
  if (msg.includes('user already registered') || msg.includes('already been registered')) {
    return 'Un compte existe déjà avec cet e-mail. Connectez-vous.'
  }
  if (msg.includes('password should be') || (msg.includes('password') && msg.includes('least'))) {
    return 'Mot de passe trop court (6 caractères minimum).'
  }
  if (msg.includes('email rate limit') || msg.includes('over_email_send_rate_limit')) {
    return 'Trop d’e-mails envoyés. Réessayez dans quelques minutes ou utilisez mot de passe / Google.'
  }
  if (msg.includes('email')) {
    return 'Adresse e-mail invalide.'
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'Impossible de joindre le serveur. Vérifiez votre connexion.'
  }
  if (
    msg.includes('origin_mismatch') ||
    msg.includes('origines javascript') ||
    msg.includes('javascript origin') ||
    msg.includes('orion-transfer.vercel.app')
  ) {
    return 'Google refuse cette origine. Ajoutez https://orion-transfer.vercel.app et http://localhost:5175 aux origines JavaScript du Client ID OAuth (Google Cloud → Identifiants).'
  }
  return raw
}

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw error
  return data
}

export async function signUpWithPassword(
  email: string,
  password: string,
  fullName?: string,
) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: fullName
        ? { full_name: fullName, first_name: fullName.split(/\s+/)[0] }
        : {},
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) throw error
  return data
}

export async function signInWithGoogleIdToken(credential: string, nonce?: string) {
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: credential,
    nonce,
  })
  if (error) throw error
  return data
}

/**
 * Lien de connexion à usage unique (invitations). Crée le compte s'il n'existe pas.
 * Préférez e-mail/mot de passe ou Google pour l’usage courant.
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
  return applyHandoffParams(window.location.hash.replace(/^#/, ''), true)
}

/** Applique un handoff depuis une URL complète (retour Google desktop). */
export async function acceptHandoffFromUrl(callbackUrl: string): Promise<boolean> {
  try {
    const u = new URL(callbackUrl)
    const hash = u.hash.replace(/^#/, '')
    if (hash && (await applyHandoffParams(hash, false))) return true
    const query = u.search.replace(/^\?/, '')
    return applyHandoffParams(query, false)
  } catch {
    return false
  }
}

async function applyHandoffParams(raw: string, clearHash: boolean): Promise<boolean> {
  if (!raw) return false
  const params = new URLSearchParams(raw)
  if (params.get('type') !== 'orion_handoff') return false

  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (clearHash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
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
