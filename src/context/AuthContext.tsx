import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { claimInvitations } from '../api/transfers'
import { acceptHandoffFromHash, signOut as authSignOut } from '../lib/auth'
import { supabase } from '../lib/supabase'

type AuthValue = {
  user: User | null
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    ;(async () => {
      try {
        await acceptHandoffFromHash()
      } catch (err) {
        console.warn('[ORION Transfer] reprise de session impossible', err)
      }
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      setLoading(false)
      // À chaque connexion, rattache les invitations reçues à cette adresse.
      if (next && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        claimInvitations().catch(() => undefined)
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      signOut: async () => {
        await authSignOut()
        setSession(null)
      },
    }),
    [session, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
