import Header from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { t } from '../i18n'
import { CORE_URL } from '../lib/supabase'

export default function AccountPage() {
  const { user, signOut } = useAuth()
  return (
    <div className="page">
      <Header />
      <main className="container stack-24">
        <h1 className="title">{t('account.title')}</h1>
        <section className="card stack-12">
          <span className="muted small">{t('account.email')}</span>
          <span>{user?.email}</span>
        </section>
        <div className="row-wrap">
          <a className="btn btn--ghost" href={CORE_URL}>
            {t('account.coreLink')}
          </a>
          <button type="button" className="btn btn--ghost" onClick={signOut}>
            {t('account.signOut')}
          </button>
        </div>
      </main>
    </div>
  )
}
