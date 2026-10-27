import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mail } from 'lucide-react'
import GoogleAuthButton from '../components/GoogleAuthButton'
import { Wordmark } from '../components/Icons'
import { t } from '../i18n'
import {
  authErrorMessage,
  safeNextPath,
  sendMagicLink,
  signInWithPassword,
  signUpWithPassword,
} from '../lib/auth'

type AuthMode = 'login' | 'signup' | 'magic'

/**
 * Connexion / inscription — même compte ORION que Core (Supabase).
 * Google + e-mail/mot de passe ; lien magique pour les invitations.
 */
export default function LoginPage() {
  const [params] = useSearchParams()
  const invited = params.get('invite') === '1'
  const next = safeNextPath(params.get('next'))
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [mode, setMode] = useState<AuthMode>(invited ? 'magic' : 'login')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const title =
    invited && mode === 'magic'
      ? t('auth.invitedTitle')
      : mode === 'signup'
        ? t('auth.signupTitle')
        : t('auth.title')

  const subtitle =
    invited && mode === 'magic'
      ? t('auth.invitedSubtitle')
      : mode === 'signup'
        ? t('auth.signupSubtitle')
        : t('auth.subtitle')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'magic') {
        await sendMagicLink(email, next)
        setSentTo(email.trim().toLowerCase())
        return
      }
      if (mode === 'signup') {
        const { session, user } = await signUpWithPassword(email, password, fullName.trim() || undefined)
        if (!session && user) {
          setInfo(t('auth.confirmEmail'))
          return
        }
        return
      }
      await signInWithPassword(email, password)
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth__glow" aria-hidden="true" />
      <header className="auth__brand">
        <Wordmark />
      </header>

      <main className="auth__card">
        <div className="auth__intro">
          <h1 className="auth__title">{title}</h1>
          <p className="auth__subtitle">{subtitle}</p>
        </div>

        {sentTo ? (
          <p className="notice notice--success" role="status">
            <Mail size={20} aria-hidden="true" /> {t('auth.linkSent', { email: sentTo })}
          </p>
        ) : (
          <>
            {mode !== 'magic' ? (
              <div className="auth__social">
                <GoogleAuthButton
                  label={mode === 'signup' ? t('auth.googleSignup') : t('auth.googleLogin')}
                  onError={setError}
                />
                <div className="auth__divider" aria-hidden="true">
                  <span>{t('auth.or')}</span>
                </div>
              </div>
            ) : null}

            {!invited && mode !== 'magic' ? (
              <div className="auth__tabs" role="tablist" aria-label="Mode">
                <button
                  type="button"
                  role="tab"
                  className={mode === 'login' ? 'is-active' : ''}
                  aria-selected={mode === 'login'}
                  onClick={() => {
                    setMode('login')
                    setError(null)
                    setInfo(null)
                  }}
                >
                  {t('auth.tabLogin')}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={mode === 'signup' ? 'is-active' : ''}
                  aria-selected={mode === 'signup'}
                  onClick={() => {
                    setMode('signup')
                    setError(null)
                    setInfo(null)
                  }}
                >
                  {t('auth.tabSignup')}
                </button>
              </div>
            ) : null}

            <form className="auth__form" onSubmit={(e) => void submit(e)}>
              {mode === 'signup' ? (
                <label className="auth__field">
                  <span className="auth__label">{t('auth.fullName')}</span>
                  <input
                    type="text"
                    name="fullName"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Prénom Nom"
                  />
                </label>
              ) : null}

              <label className="auth__field">
                <span className="auth__label">{t('auth.email')}</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@entreprise.com"
                />
              </label>

              {mode !== 'magic' ? (
                <label className="auth__field">
                  <span className="auth__label">{t('auth.password')}</span>
                  <input
                    type="password"
                    name="password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </label>
              ) : null}

              {error ? (
                <p className="auth__error" role="alert">
                  {error}
                </p>
              ) : null}
              {info ? (
                <p className="notice notice--success" role="status">
                  {info}
                </p>
              ) : null}

              <button type="submit" className="btn btn--primary btn--block btn--glow" disabled={busy}>
                {busy
                  ? t('auth.working')
                  : mode === 'magic'
                    ? invited
                      ? t('auth.receiveLink')
                      : t('auth.magicLink')
                    : mode === 'signup'
                      ? t('auth.createAccount')
                      : t('auth.signIn')}
              </button>
            </form>

            {mode === 'magic' ? (
              <button
                type="button"
                className="auth__alt"
                onClick={() => {
                  setMode('login')
                  setError(null)
                }}
              >
                {t('auth.usePassword')}
              </button>
            ) : (
              <button
                type="button"
                className="auth__alt"
                onClick={() => {
                  setMode('magic')
                  setError(null)
                }}
              >
                {t('auth.useMagicLink')}
              </button>
            )}
          </>
        )}

        <p className="auth__note">{t('auth.accountNote')}</p>
      </main>
    </div>
  )
}
