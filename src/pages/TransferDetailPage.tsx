import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Clock, Download, Lock, Trash2 } from 'lucide-react'
import {
  deleteTransfer,
  downloadFile,
  fetchTransfer,
  fetchInbox,
  revokeRecipient,
  type EventRow,
  type TransferDetail,
} from '../api/transfers'
import Header from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { errorMessage, formatDateTime, formatLongDate, t } from '../i18n'
import { initials } from '../lib/auth'
import { extensionOf, formatBytes } from '../lib/fileRules'

function eventLabel(e: EventRow): string {
  const d = e.detail as Record<string, string>
  switch (e.kind) {
    case 'downloaded':
      return t('event.downloaded', { file: d.file ?? '' })
    case 'revoked':
      return t('event.revoked', { email: d.email ?? '' })
    default:
      return t(`event.${e.kind}`)
  }
}

export default function TransferDetailPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const userId = user?.id
  const navigate = useNavigate()
  const [detail, setDetail] = useState<TransferDetail | null | undefined>(undefined)
  const [sender, setSender] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** Action en attente de confirmation : id d'un destinataire, ou « delete ». */
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await fetchTransfer(id)
      setDetail(d)
      if (d && d.transfer.sender_id !== userId) {
        const item = (await fetchInbox()).find((i) => i.id === id)
        setSender(item?.sender_name || item?.sender_email || '')
      }
    } catch (err) {
      setError(errorMessage(err))
      setDetail(null)
    }
  }, [id, userId])

  useEffect(() => {
    void load()
  }, [load])

  if (detail === undefined) {
    return (
      <div className="page">
        <Header />
        <main className="container" aria-busy="true">
          <p className="muted">{t('auth.loading')}</p>
        </main>
      </div>
    )
  }

  if (detail === null) {
    return (
      <div className="page">
        <Header />
        <main className="container stack-16">
          <BackLink />
          <div className="empty">
            <span className="empty__icon" aria-hidden="true">
              <Ban size={24} />
            </span>
            <p className="empty__title">{t('detail.unavailable')}</p>
            <p className="muted">{error ?? t('detail.unavailableHint')}</p>
          </div>
        </main>
      </div>
    )
  }

  const { transfer, files, recipients, events } = detail
  const isSender = transfer.sender_id === user?.id
  const expired = transfer.status === 'expired' || new Date(transfer.expires_at) <= new Date()
  const activeRecipients = recipients.filter((r) => !r.revoked_at)

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <Header />
      <main className="container stack-28">
        <BackLink />

        <div className="stack-8">
          <h1 className="title title--md">
            {isSender
              ? t('detail.sentTitle', { files: transfer.file_count, people: activeRecipients.length })
              : t('detail.receivedTitle', { files: transfer.file_count, sender: sender || '…' })}
          </h1>
          <p className="muted">
            {t('detail.meta', {
              date: formatDateTime(transfer.created_at),
              size: formatBytes(transfer.total_bytes),
              expiry: formatLongDate(transfer.expires_at),
            })}
          </p>
        </div>

        {transfer.message ? <blockquote className="quote">{transfer.message}</blockquote> : null}
        {expired ? (
          <p className="banner banner--muted" role="status">
            <Clock size={18} aria-hidden="true" /> {t('detail.expired', { date: formatLongDate(transfer.expires_at) })}
          </p>
        ) : null}
        {error ? (
          <p className="danger-text" role="alert">
            {error}
          </p>
        ) : null}

        <div className="split">
          <section className="split__main stack-12" aria-labelledby="files-title">
            <h2 id="files-title" className="h2">
              {t('detail.files')}
            </h2>
            <ul className="list">
              {files.map((f) => (
                <li className="row row--static" key={f.id}>
                  <span className="row__main">
                    <span className="ext" aria-hidden="true">
                      {(extensionOf(f.display_name) || '—').slice(0, 4).toUpperCase()}
                    </span>
                    <span className="row__text">
                      <span className="row__title">{f.relative_path || f.display_name}</span>
                      <span className="row__sub">
                        {formatBytes(f.size_bytes)}
                        {f.status === 'rejected' ? ' — refusé' : ''}
                      </span>
                    </span>
                  </span>
                  {!expired && f.status === 'uploaded' ? (
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={busy === f.id}
                      onClick={() => run(f.id, () => downloadFile(f.id))}
                      aria-label={t('detail.download', { name: f.display_name })}
                    >
                      <Download size={18} aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            {isSender && events.length > 0 ? (
              <>
                <h2 className="h2 mt-16">{t('detail.activity')}</h2>
                <ol className="timeline">
                  {events.map((e) => (
                    <li key={e.id}>
                      <span className="muted">{formatDateTime(e.created_at)}</span>
                      <span>{eventLabel(e)}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </section>

          <aside className="split__side stack-20">
            {isSender ? (
              <section className="card stack-12" aria-labelledby="people-title">
                <h2 id="people-title" className="h2">
                  {t('detail.people')}
                </h2>
                {recipients.map((r) => (
                  <div className="person" key={r.id}>
                    <span className="avatar avatar--sm" aria-hidden="true">{initials(r.email)}</span>
                    <span className="row__text">
                      <span className="row__title">{r.email}</span>
                      <span className={r.first_downloaded_at ? 'success-text small' : 'muted small'}>
                        {r.revoked_at
                          ? t('detail.revoked')
                          : r.first_downloaded_at
                            ? t('detail.downloadedOn', { date: formatDateTime(r.first_downloaded_at) })
                            : t('detail.notDownloaded')}
                      </span>
                    </span>
                    {!r.revoked_at && !expired && confirming !== r.id ? (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(r.id)}>
                        {t('detail.revoke')}
                      </button>
                    ) : null}
                  </div>
                ))}
                {recipients.some((r) => r.id === confirming) ? (
                  <div className="confirm" role="alertdialog" aria-label={t('detail.revoke')}>
                    <p>{t('detail.revokeConfirm', { email: recipients.find((r) => r.id === confirming)!.email })}</p>
                    <div className="row-wrap">
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={busy === confirming}
                        onClick={() => {
                          const rid = confirming!
                          void run(rid, async () => {
                            await revokeRecipient(rid)
                            setConfirming(null)
                            await load()
                          })
                        }}
                      >
                        {t('detail.revoke')}
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(null)}>
                        {t('send.cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
                <p className="muted small">{t('detail.revokeNote')}</p>
              </section>
            ) : null}

            <section className="card stack-10" aria-labelledby="access-title">
              <h2 id="access-title" className="h2">
                {t('detail.access')}
              </h2>
              <p className="icon-line">
                <Lock size={16} aria-hidden="true" /> {t('detail.accessPeople')}
              </p>
              <p className="icon-line">
                <Clock size={16} aria-hidden="true" /> {t('detail.accessExpiry', { date: formatLongDate(transfer.expires_at) })}
              </p>
              <p className="icon-line">
                <Ban size={16} aria-hidden="true" /> {t('detail.accessNoLink')}
              </p>
            </section>

            {isSender ? (
              <section className="card card--danger stack-10" aria-labelledby="delete-title">
                <h2 id="delete-title" className="h2">
                  {t('detail.delete')}
                </h2>
                <p className="muted">{t('detail.deleteNote')}</p>
                {confirming === 'delete' ? (
                  <div className="confirm" role="alertdialog" aria-label={t('detail.delete')}>
                    <p>{t('detail.deleteConfirm')}</p>
                    <div className="row-wrap">
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={busy === 'delete'}
                        onClick={() =>
                          void run('delete', async () => {
                            await deleteTransfer(transfer.id)
                            navigate('/', { replace: true })
                          })
                        }
                      >
                        <Trash2 size={16} aria-hidden="true" /> {t('detail.delete')}
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(null)}>
                        {t('send.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn--danger" onClick={() => setConfirming('delete')}>
                    <Trash2 size={16} aria-hidden="true" /> {t('detail.deleteButton')}
                  </button>
                )}
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/" className="back">
      <ArrowLeft size={18} aria-hidden="true" /> {t('detail.back')}
    </Link>
  )
}
