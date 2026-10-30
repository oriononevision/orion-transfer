import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import GoogleAuthButton from '../components/GoogleAuthButton'
import { useAuth } from '../context/AuthContext'
import { authErrorMessage } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { t } from '../i18n'

/** N’accepte que le retour vers le logiciel Transfer en local (port libre = callback Electron). */
function safeDesktopReturn(raw: string | null): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return null
    if (!u.pathname.startsWith('/auth/')) return null
    return u.origin + u.pathname
  } catch {
    return null
  }
}

function handoffToDesktop(returnBase: string, accessToken: string, refreshToken: string) {
  const target = new URL(returnBase)
  // Query (pas le hash) : le serveur local Electron reçoit les jetons.
  target.searchParams.set('access_token', accessToken)
  target.searchParams.set('refresh_token', refreshToken)
  target.searchParams.set('type', 'orion_handoff')
  target.hash = ''
  window.location.assign(target.toString())
}

/**
 * Page ouverte par le logiciel PC pour se connecter via Google sur l’origine web ORION,
 * puis renvoyer la session vers Transfer Desktop.
 */
export default function DesktopAuthPage() {
  const [params] = useSearchParams()
  const { session, loading } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const returnBase = useMemo(() => safeDesktopReturn(params.get('return')), [params])

  useEffect(() => {
    if (loading || !session || !returnBase) return
    handoffToDesktop(returnBase, session.access_token, session.refresh_token)
  }, [loading, session, returnBase])

  if (!returnBase) {
    return (
      <AuthShell mode="login" title={t('desktopAuth.title')}>
        <p className="auth__error">{t('desktopAuth.badReturn')}</p>
      </AuthShell>
    )
  }

  if (loading || session) {
    return (
      <AuthShell mode="login" title={t('desktopAuth.title')}>
        <p className="auth__switch" role="status">
          {t('desktopAuth.redirecting')}
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell mode="login" title={t('desktopAuth.title')}>
      <p className="muted" style={{ marginBottom: 20, lineHeight: 1.5 }}>
        {t('desktopAuth.lead')}
      </p>
      {error ? <p className="auth__error">{error}</p> : null}
      <GoogleAuthButton
        label={t('desktopAuth.google')}
        forceWeb
        onError={setError}
        onSuccess={async () => {
          try {
            const { data } = await supabase.auth.getSession()
            if (!data.session) throw new Error('Session manquante')
            handoffToDesktop(returnBase, data.session.access_token, data.session.refresh_token)
          } catch (err) {
            setError(authErrorMessage(err))
          }
        }}
      />
    </AuthShell>
  )
}
