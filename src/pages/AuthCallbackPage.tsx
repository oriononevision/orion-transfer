import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import { useAuth } from '../context/AuthContext'
import { t } from '../i18n'
import { safeNextPath } from '../lib/auth'

/** Arrivée depuis le lien de connexion (le client Supabase finalise la session). */
export default function AuthCallbackPage() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 8000)
    return () => window.clearTimeout(timer)
  }, [])

  if (!loading && session) return <Navigate to={safeNextPath(params.get('next'))} replace />

  if (timedOut || params.get('error')) {
    return (
      <AuthShell mode="login" title="Connexion">
        <div className="auth__done">
          <p className="auth__error">La connexion n’a pas pu aboutir. Réessayez.</p>
          <Link to="/connexion" className="auth__btn">
            Retour
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell mode="login" title="Connexion">
      <div className="auth__done">
        <p role="status">{t('auth.finishing')}</p>
      </div>
    </AuthShell>
  )
}
