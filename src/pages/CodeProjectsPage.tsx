import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Code2, Plus, Users } from 'lucide-react'
import { listCodeProjects, type CodeProjectListItem } from '../api/codeProjects'
import Header from '../components/Header'
import StatusPill from '../components/StatusPill'
import { errorMessage, formatRelativeDay, t } from '../i18n'

export default function CodeProjectsPage() {
  const [items, setItems] = useState<CodeProjectListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setItems(await listCodeProjects())
    } catch (err) {
      setError(errorMessage(err))
      setItems([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="page">
      <Header />
      <main className="container stack-32">
        <div className="stack-6">
          <p className="muted small">
            <Link to="/" className="text-link">
              {t('code.backHome')}
            </Link>
          </p>
          <h1 className="title">{t('code.title')}</h1>
          <p className="muted lead">{t('code.subtitle')}</p>
        </div>

        <div className="row-wrap">
          <Link to="/code/nouveau" className="btn btn--primary">
            <Plus size={18} aria-hidden="true" />
            {t('code.create')}
          </Link>
        </div>

        {error ? (
          <div className="empty" role="alert">
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={load}>
              {t('list.retry')}
            </button>
          </div>
        ) : items == null ? (
          <div className="list" aria-busy="true">
            {[0, 1].map((i) => (
              <div className="row skeleton" key={i} aria-hidden="true">
                <span className="skeleton__avatar" />
                <span className="skeleton__lines">
                  <span />
                  <span />
                </span>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="empty">
            <span className="empty__icon" aria-hidden="true">
              <Code2 size={24} />
            </span>
            <p className="empty__title">{t('code.empty')}</p>
            <p className="muted">{t('code.emptyHint')}</p>
            <Link to="/code/nouveau" className="btn btn--primary">
              <Plus size={18} aria-hidden="true" />
              {t('code.create')}
            </Link>
          </div>
        ) : (
          <ul className="list">
            {items.map((item) => {
              const outdated =
                item.latest_revision_id != null &&
                item.last_seen_revision_id !== item.latest_revision_id
              return (
                <li key={item.id}>
                  <Link className="row" to={`/code/${item.id}`}>
                    <span className="row__main">
                      {item.cover_image ? (
                        <img className="avatar avatar--sm avatar--cover" src={item.cover_image} alt="" />
                      ) : (
                        <span className="avatar avatar--sm" aria-hidden="true">
                          <Code2 size={16} />
                        </span>
                      )}
                      <span className="row__text">
                        <span className="row__title">{item.name}</span>
                        <span className="row__sub">
                          <Users size={14} aria-hidden="true" /> {item.member_count}
                          {item.latest_author
                            ? ` · ${t('code.lastBy', { name: item.latest_author })}`
                            : ''}
                          {item.latest_at ? ` · ${formatRelativeDay(item.latest_at)}` : ''}
                        </span>
                      </span>
                    </span>
                    <span className="row__side">
                      <StatusPill
                        tone={outdated ? 'accent' : 'success'}
                        label={outdated ? t('code.statusOutdated') : t('code.statusUpToDate')}
                      />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
