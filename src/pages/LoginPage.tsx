import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { Wordmark } from '../components/Icons'
import { errorMessage, t } from '../i18n'
import { safeNextPath, sendMagicLink, signInWithPassword } from '../lib/auth'

/**
 * Connexion. Avec `?invite=1&email=…` (lien de l'e-mail d'invitation), la
 * page s'adresse au destinataire et propose directement le lien de connexion.
 * Le texte est volontairement identique que le compte existe ou non.
 */
export default function LoginPage() {
  const [params] = useSearchParams()
  const invited = params.get('invite') === '1'
  const next = safeNextPath(params.get('next'))
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'link' | 'password'>('link')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'link') {
        await sendMagicLink(email, next)
        setSentTo(email.trim().toLowerCase())
      } else {
        await signInWithPassword(email, password)
      }
    } catch (err) {
      setError(mode === 'password' ? 'E-mail ou mot de passe incorrect.' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <Wordmark />
      <main className="auth__card stack-24">
        <div className="stack-8">
          <h1 className="title title--sm">{invited ? t('auth.invitedTitle') : t('auth.title')}</h1>
          <p className="muted">{invited ? t('auth.invitedSubtitle') : t('auth.subtitle')}</p>
        </div>

        {sentTo ? (
          <p className="notice notice--success" role="status">
            <Mail size={20} aria-hidden="true" /> {t('auth.linkSent', { email: sentTo })}
          </p>
        ) : (
          <form className="stack-12" onSubmit={submit}>
            <label className="field__label" htmlFor="email">
              {t('auth.email')}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {mode === 'password' ? (
              <>
                <label className="field__label" htmlFor="password">
                  {t('auth.password')}
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </>
            ) : null}
            {error ? (
              <p className="danger-text small" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
              {mode === 'password' ? t('auth.signIn') : invited ? t('auth.receiveLink') : t('auth.magicLink')}
            </button>
            <button type="button" className="link-btn" onClick={() => setMode(mode === 'link' ? 'password' : 'link')}>
              {mode === 'link' ? t('auth.usePassword') : t('auth.useMagicLink')}
            </button>
          </form>
        )}

        <p className="muted small">{t('auth.accountNote')}</p>
      </main>
    </div>
  )
}
