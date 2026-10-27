import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  console.warn('[ORION Transfer] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants — connexion désactivée.')
}

/** Même projet Supabase que ORION CORE : les comptes sont partagés. */
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})

/** Accès au schéma `transfer` (à ajouter dans Settings → API → Exposed schemas). */
export const transferDb = supabase.schema('transfer')

export const CORE_URL = (import.meta.env.VITE_CORE_URL as string | undefined) || 'http://localhost:5174'

/** Même Client ID Google (GIS) que ORION Core / le site — auth Supabase `signInWithIdToken`. */
export const GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || ''
