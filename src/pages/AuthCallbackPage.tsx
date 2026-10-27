import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
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
  if (timedOut || params.get('error')) return <Navigate to="/connexion" replace />

  return (
    <div className="auth">
      <p className="muted" role="status">
        {t('auth.finishing')}
      </p>
    </div>
  )
}
