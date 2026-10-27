import { Link } from 'react-router-dom'
import { t } from '../i18n'
import { initials, displayName } from '../lib/auth'
import { formatBytes, LIMITS } from '../lib/fileRules'
import { useAuth } from '../context/AuthContext'
import { Wordmark } from './Icons'

export default function Header({ usedBytes }: { usedBytes?: number }) {
  const { user } = useAuth()
  const name = displayName(user?.user_metadata, user?.email)
  const ratio = usedBytes == null ? null : Math.min(1, usedBytes / LIMITS.maxActiveBytes)

  return (
    <header className="header">
      <div className="header__inner">
        <Link to="/" className="header__home" aria-label={t('app.name')}>
          <Wordmark />
        </Link>
        <div className="header__right">
          {ratio != null ? (
            <div className="storage">
              <span className="storage__label">
                {t('nav.storage', { used: formatBytes(usedBytes ?? 0), max: formatBytes(LIMITS.maxActiveBytes) })}
              </span>
              <div
                className="storage__bar"
                role="meter"
                aria-label="Stockage utilisé"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(ratio * 100)}
              >
                <div style={{ width: `${ratio * 100}%` }} />
              </div>
            </div>
          ) : null}
          <Link to="/compte" className="avatar" aria-label={t('nav.account')} title={user?.email ?? ''}>
            {initials(name || user?.email || '')}
          </Link>
        </div>
      </div>
    </header>
  )
}
