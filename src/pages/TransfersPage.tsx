import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Folder, Inbox, Upload, X } from 'lucide-react'
import { fetchInbox, fetchOutbox, fetchUsage, subscribeToChanges, type InboxItem, type OutboxItem } from '../api/transfers'
import Header from '../components/Header'
import SendPanel from '../components/SendPanel'
import StatusPill from '../components/StatusPill'
import { formatRelativeDay, t } from '../i18n'
import { initials } from '../lib/auth'
import { formatBytes, LIMITS } from '../lib/fileRules'
import { fromDataTransfer, fromInput, type Collected } from '../lib/readDrop'
import { inboxStatus, outboxStatus } from '../lib/status'

type Tab = 'inbox' | 'outbox'

export default function TransfersPage() {
  const [tab, setTab] = useState<Tab>('inbox')
  const [inbox, setInbox] = useState<InboxItem[] | null>(null)
  const [outbox, setOutbox] = useState<OutboxItem[] | null>(null)
  const [usage, setUsage] = useState<number | undefined>()
  const [loadError, setLoadError] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState<Collected | null>(null)
  const [arrival, setArrival] = useState<InboxItem | null>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const seenIds = useRef<Set<string> | null>(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const [i, o, u] = await Promise.all([fetchInbox(), fetchOutbox(), fetchUsage()])
      // Nouveau transfert reçu depuis le dernier chargement : on le signale.
      if (seenIds.current) {
        const fresh = i.find((item) => !seenIds.current!.has(item.id) && item.status === 'ready')
        if (fresh) setArrival(fresh)
      }
      seenIds.current = new Set(i.map((item) => item.id))
      setInbox(i)
      setOutbox(o)
      setUsage(u.active_bytes)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Réception en direct, avec deux filets de sécurité : rechargement quand
  // l'onglet redevient actif, et toutes les 30 secondes s'il est visible.
  useEffect(() => {
    let timer: number | undefined
    const refresh = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void load(), 400)
    }
    const unsubscribe = subscribeToChanges(refresh)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30_000)
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // Le nombre de nouveaux transferts apparaît aussi dans le titre de l'onglet.
  const unseen = inbox?.filter((i) => i.status === 'ready' && !i.first_downloaded_at).length ?? 0
  useEffect(() => {
    document.title = unseen > 0 ? `(${unseen}) ${t('app.name')}` : t('app.name')
  }, [unseen])

  // React ne connaît pas l'attribut de sélection de dossier.
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [])

  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (pending) return
    setPending(await fromDataTransfer(event.dataTransfer))
  }

  const newCount = unseen
  const rows = tab === 'inbox' ? inbox : outbox

  return (
    <div
      className="page"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <Header usedBytes={usage} />

      <main className="container stack-32">
        <div className="stack-6">
          <h1 className="title">{t('home.title')}</h1>
          <p className="muted lead">{t('home.subtitle')}</p>
        </div>

        <section className={`dropzone${dragging ? ' is-dragging' : ''}`} aria-labelledby="drop-title">
          <div className="dropzone__icon" aria-hidden="true">
            <Upload size={26} />
          </div>
          <div className="stack-4">
            <p id="drop-title" className="dropzone__title">
              {dragging ? t('drop.active') : t('drop.title')}
            </p>
            <p className="muted">{t('drop.subtitle')}</p>
          </div>
          <div className="row-wrap center">
            <button type="button" className="btn btn--primary" onClick={() => filesInput.current?.click()}>
              {t('drop.pickFiles')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => folderInput.current?.click()}>
              <Folder size={18} aria-hidden="true" />
              {t('drop.pickFolder')}
            </button>
          </div>
          <p className="muted small">
            {t('drop.limits', {
              file: formatBytes(LIMITS.maxFileBytes),
              count: LIMITS.maxFiles,
              total: formatBytes(LIMITS.maxTransferBytes),
              days: LIMITS.defaultExpiryDays,
            })}
          </p>
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              setPending(fromInput(e.target.files))
              e.target.value = ''
            }}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            onChange={(e) => {
              setPending(fromInput(e.target.files))
              e.target.value = ''
            }}
          />
        </section>

        <section className="stack-16" aria-label="Historique">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')}>
              {t('tabs.inbox')}
              {newCount > 0 ? <span className="badge">{t('tabs.new', { count: newCount })}</span> : null}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'outbox'} onClick={() => setTab('outbox')}>
              {t('tabs.outbox')}
            </button>
          </div>

          {loadError ? (
            <div className="empty" role="alert">
              <p>{t('list.error')}</p>
              <button type="button" className="btn btn--ghost" onClick={load}>
                {t('list.retry')}
              </button>
            </div>
          ) : rows == null ? (
            <div className="list" aria-busy="true" aria-label={t('list.loading')}>
              {[0, 1, 2].map((i) => (
                <div className="row skeleton" key={i} aria-hidden="true">
                  <span className="skeleton__avatar" />
                  <span className="skeleton__lines">
                    <span />
                    <span />
                  </span>
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <span className="empty__icon" aria-hidden="true">
                <Inbox size={24} />
              </span>
              <p className="empty__title">{tab === 'inbox' ? t('list.emptyInbox') : t('list.emptyOutbox')}</p>
              <p className="muted">{tab === 'inbox' ? t('list.emptyInboxHint') : t('list.emptyOutboxHint')}</p>
            </div>
          ) : (
            <ul className="list">
              {tab === 'inbox'
                ? (rows as InboxItem[]).map((item) => {
                    const who = item.sender_name || item.sender_email
                    const s = inboxStatus(item)
                    return (
                      <li key={item.id}>
                        <Link className="row" to={`/t/${item.id}`}>
                          <span className="row__main">
                            <span className="avatar avatar--sm" aria-hidden="true">{initials(who)}</span>
                            <span className="row__text">
                              <span className="row__title">{who}</span>
                              <span className="row__sub">
                                {t('list.files', { count: item.file_count, size: formatBytes(item.total_bytes) })}
                                {item.message ? ` — ${item.message}` : ''}
                              </span>
                            </span>
                          </span>
                          <span className="row__side">
                            <span className="muted small nowrap">{formatRelativeDay(item.created_at)}</span>
                            <StatusPill tone={s.tone} label={s.label} />
                          </span>
                        </Link>
                      </li>
                    )
                  })
                : (rows as OutboxItem[]).map((item) => {
                    const who = item.recipient_emails.join(', ')
                    const s = outboxStatus(item)
                    return (
                      <li key={item.id}>
                        <Link className="row" to={`/t/${item.id}`}>
                          <span className="row__main">
                            <span className="avatar avatar--sm" aria-hidden="true">
                              {item.recipient_emails.length > 1 ? item.recipient_emails.length : initials(who)}
                            </span>
                            <span className="row__text">
                              <span className="row__title">{who}</span>
                              <span className="row__sub">
                                {t('list.files', { count: item.file_count, size: formatBytes(item.total_bytes) })}
                                {item.message ? ` — ${item.message}` : ''}
                              </span>
                            </span>
                          </span>
                          <span className="row__side">
                            <span className="muted small nowrap">{formatRelativeDay(item.created_at)}</span>
                            <StatusPill tone={s.tone} label={s.label} />
                          </span>
                        </Link>
                      </li>
                    )
                  })}
            </ul>
          )}
          <p className="muted small">{t('list.expiredNote')}</p>
        </section>
      </main>

      {arrival ? (
        <div className="toast" role="status" aria-live="polite">
          <Inbox size={20} className="toast__icon" aria-hidden="true" />
          <span className="toast__text">
            {t('live.received', { sender: arrival.sender_name || arrival.sender_email, count: arrival.file_count })}
          </span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              setArrival(null)
              navigate(`/t/${arrival.id}`)
            }}
          >
            {t('live.open')}
          </button>
          <button type="button" className="icon-btn" onClick={() => setArrival(null)} aria-label={t('live.dismiss')}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {pending ? (
        <SendPanel
          initial={pending}
          onClose={() => setPending(null)}
          onSent={() => {
            setTab('outbox')
            void load()
          }}
        />
      ) : null}
    </div>
  )
}
