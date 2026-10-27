import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Ban, File as FileIcon, Folder, KeyRound, RotateCcw, X, Check, WifiOff } from 'lucide-react'
import {
  completeTransfer,
  createTransfer,
  searchOrionMembers,
  uploadFileParts,
  uploadToSignedUrl,
  type OrionMember,
  type UploadChunk,
} from '../api/transfers'
import { errorMessage, formatLongDate, t } from '../i18n'
import { checkSelection, formatBytes, LIMITS, normalizeEmail, type FileIssue } from '../lib/fileRules'
import { fromInput, inspectFile, type Collected, type PickedFile } from '../lib/readDrop'

type RecipientMode = 'email' | 'orion'

type Item = PickedFile & {
  key: string
  warning: 'secret' | null
  keep: boolean
  progress: number
  state: 'idle' | 'uploading' | 'done' | 'error'
}

type Rejection = FileIssue | { kind: 'executable'; name: string }

type Phase = 'edit' | 'sending' | 'done'

const UPLOAD_CONCURRENCY = 3

let keySeq = 0

async function prepare(collected: Collected): Promise<{ items: Item[]; rejected: Rejection[] }> {
  const check = checkSelection(collected.files.map(({ file, path }) => ({ name: file.name, size: file.size, path })))
  const acceptedNames = new Set(check.accepted.map((f) => `${f.path ?? ''}\u0000${f.name}`))
  const items: Item[] = []
  const rejected: Rejection[] = [...check.rejected]

  for (const picked of collected.files) {
    if (!acceptedNames.has(`${picked.path}\u0000${picked.file.name}`)) continue
    const warning = await inspectFile(picked.file)
    if (warning === 'executable') {
      rejected.push({ kind: 'executable', name: picked.file.name })
      continue
    }
    items.push({ ...picked, key: `f${keySeq++}`, warning, keep: false, progress: 0, state: 'idle' })
  }
  return { items, rejected }
}

function topFolder(path: string): string | null {
  return path ? path.split('/')[0] : null
}

export default function SendPanel({
  initial,
  onClose,
  onSent,
}: {
  initial: Collected
  onClose: () => void
  onSent: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [rejected, setRejected] = useState<Rejection[]>([])
  const [excluded, setExcluded] = useState(0)
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('email')
  const [recipients, setRecipients] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [orionQuery, setOrionQuery] = useState('')
  const [orionHits, setOrionHits] = useState<OrionMember[]>([])
  const [orionLoading, setOrionLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [days, setDays] = useState<number>(LIMITS.defaultExpiryDays)
  const [phase, setPhase] = useState<Phase>('edit')
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(!navigator.onLine)
  const uploadsRef = useRef<Map<string, { url?: string; chunks?: UploadChunk[] }>>(new Map())
  const transferIdRef = useRef<string | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const addCollected = async (collected: Collected) => {
    const prepared = await prepare(collected)
    setItems((prev) => [...prev, ...prepared.items])
    setRejected((prev) => [...prev, ...prepared.rejected])
    setExcluded((prev) => prev + collected.excluded)
  }

  useEffect(() => {
    void addCollected(initial)
    // Ne s'exécute qu'à l'ouverture du panneau.
  }, [])

  const locked = phase !== 'edit'

  // Recherche membres Orion (debounce).
  useEffect(() => {
    if (recipientMode !== 'orion' || locked) return
    let cancelled = false
    setOrionLoading(true)
    const timer = window.setTimeout(() => {
      void searchOrionMembers(orionQuery, 12)
        .then((rows) => {
          if (!cancelled) setOrionHits(rows.filter((m) => !recipients.includes(m.email.toLowerCase())))
        })
        .catch(() => {
          if (!cancelled) setOrionHits([])
        })
        .finally(() => {
          if (!cancelled) setOrionLoading(false)
        })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [recipientMode, orionQuery, recipients, locked])

  const totalBytes = items.reduce((sum, i) => sum + i.file.size, 0)
  const tooMany = items.length > LIMITS.maxFiles
  const tooLarge = totalBytes > LIMITS.maxTransferBytes
  const pendingSecrets = items.some((i) => i.warning === 'secret' && !i.keep)
  const allRecipients = useMemo(() => {
    if (recipientMode === 'orion') return recipients
    const fromDraft = normalizeEmail(draft)
    return fromDraft && !recipients.includes(fromDraft) ? [...recipients, fromDraft] : recipients
  }, [draft, recipients, recipientMode])
  const canSend =
    phase === 'edit' && items.length > 0 && !tooMany && !tooLarge && !pendingSecrets && allRecipients.length > 0 && !offline

  const expiryDate = formatLongDate(new Date(Date.now() + days * 86_400_000).toISOString())

  // Regroupe les fichiers d'un même dossier sur une ligne ; les fichiers
  // signalés (secrets) restent visibles individuellement.
  const rows = useMemo(() => {
    const folders = new Map<string, Item[]>()
    const singles: Item[] = []
    for (const item of items) {
      const folder = topFolder(item.path)
      if (folder && !(item.warning === 'secret')) {
        folders.set(folder, [...(folders.get(folder) ?? []), item])
      } else singles.push(item)
    }
    return { folders: [...folders.entries()], singles }
  }, [items])

  const addRecipientEmail = (raw: string) => {
    const email = normalizeEmail(raw)
    if (!email) return false
    if (!recipients.includes(email) && recipients.length < LIMITS.maxRecipients) {
      setRecipients([...recipients, email])
    }
    return true
  }

  const commitDraft = () => {
    if (recipientMode !== 'email') return true
    const value = draft.trim()
    if (!value) return true
    const email = normalizeEmail(value)
    if (!email) {
      setDraftError(t('send.recipientInvalid', { value }))
      return false
    }
    addRecipientEmail(email)
    setDraft('')
    setDraftError(null)
    return true
  }

  const pickOrionMember = (member: OrionMember) => {
    addRecipientEmail(member.email)
    setOrionQuery('')
  }

  const switchRecipientMode = (mode: RecipientMode) => {
    if (locked || mode === recipientMode) return
    setRecipientMode(mode)
    setDraft('')
    setDraftError(null)
    setOrionQuery('')
  }

  const onDraftKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';' || event.key === ' ') {
      event.preventDefault()
      commitDraft()
    } else if (event.key === 'Backspace' && !draft && recipients.length) {
      setRecipients(recipients.slice(0, -1))
    }
  }

  const removeKeys = (keys: string[]) => setItems((prev) => prev.filter((i) => !keys.includes(i.key)))
  const update = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const uploadOne = async (item: Item) => {
    const plan = uploadsRef.current.get(item.key)
    if (!plan) throw new Error('unknown')
    update(item.key, { state: 'uploading', progress: 0 })
    try {
      if (plan.chunks?.length) {
        await uploadFileParts(
          item.file,
          plan.chunks.map((c) => ({ url: c.url, start: c.start, end: c.end })),
          (p) => update(item.key, { progress: p }),
        )
      } else if (plan.url) {
        await uploadToSignedUrl(plan.url, item.file, (p) => update(item.key, { progress: p }))
      } else {
        throw new Error('upload_failed')
      }
      update(item.key, { state: 'done', progress: 1 })
      return true
    } catch (err) {
      const code = err instanceof Error ? err.message : 'upload_failed'
      setError(
        code === 'upload_too_large' || code === 'upload_failed' || code === 'network'
          ? code
          : 'upload_failed',
      )
      update(item.key, { state: 'error' })
      return false
    }
  }

  const runUploads = async (queue: Item[]) => {
    let ok = true
    const pending = [...queue]
    const worker = async () => {
      for (let next = pending.shift(); next; next = pending.shift()) {
        if (!(await uploadOne(next))) ok = false
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, worker))
    return ok
  }

  const finish = async () => {
    if (!transferIdRef.current) return
    await completeTransfer(transferIdRef.current)
    setPhase('done')
    onSent()
  }

  const send = async () => {
    if (!commitDraft()) return
    setError(null)
    setPhase('sending')
    try {
      const created = await createTransfer({
        recipients: allRecipients,
        expiryDays: days,
        message: message.trim() || undefined,
        files: items.map((i) => ({ name: i.file.name, size: i.file.size, type: i.file.type || undefined, path: i.path || undefined })),
      })
      transferIdRef.current = created.transfer_id
      // Le serveur renvoie les fichiers dans l'ordre envoyé.
      created.uploads.forEach((u, index) => {
        const item = items[index]
        if (item) {
          uploadsRef.current.set(item.key, {
            url: u.url,
            chunks: u.chunks,
          })
        }
      })
      if (await runUploads(items)) await finish()
    } catch (err) {
      setError(errorMessage(err))
      if (!transferIdRef.current) setPhase('edit')
    }
  }

  const retryFailed = async () => {
    setError(null)
    try {
      if (await runUploads(items.filter((i) => i.state === 'error'))) await finish()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const failed = items.filter((i) => i.state === 'error')

  return (
    <dialog
      ref={dialogRef}
      className="panel"
      aria-labelledby="send-title"
      onCancel={(event) => {
        if (phase === 'sending') event.preventDefault()
        else onClose()
      }}
    >
      <div className="panel__head">
        <h1 id="send-title">{t('send.title')}</h1>
        <button type="button" className="icon-btn" onClick={onClose} disabled={phase === 'sending'} aria-label={t('send.close')}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      {phase === 'done' ? (
        <div className="panel__done" role="status">
          <div className="done-mark" aria-hidden="true">
            <Check size={26} />
          </div>
          <p className="done-title">{t('send.done')}</p>
          <p className="muted">{t('send.doneHint')}</p>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t('send.close')}
          </button>
        </div>
      ) : (
        <>
          <div className="panel__body">
            <section className="field">
              <div className="field__row">
                <h2 className="field__label">{t('send.files')}</h2>
                <span className="muted small">
                  {t('send.summary', { count: items.length, size: formatBytes(totalBytes), max: formatBytes(LIMITS.maxTransferBytes) })}
                </span>
              </div>

              {rows.folders.map(([folder, group]) => (
                <div className="file-row" key={folder}>
                  <Folder size={20} className="file-row__icon file-row__icon--accent" aria-hidden="true" />
                  <div className="file-row__text">
                    <span className="file-row__name">{folder}/</span>
                    <span className="muted small">
                      {t('list.files', { count: group.length, size: formatBytes(group.reduce((s, i) => s + i.file.size, 0)) })}
                    </span>
                  </div>
                  <UploadState items={group} />
                  {!locked ? (
                    <button type="button" className="icon-btn" onClick={() => removeKeys(group.map((i) => i.key))} aria-label={t('send.remove', { name: folder })}>
                      <X size={18} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}

              {rows.singles.map((item) =>
                item.warning === 'secret' && !item.keep && !locked ? (
                  <div className="file-row file-row--warning" key={item.key}>
                    <div className="file-row__line">
                      <KeyRound size={20} className="file-row__icon file-row__icon--accent" aria-hidden="true" />
                      <div className="file-row__text">
                        <span className="file-row__name">{item.path || item.file.name}</span>
                        <span className="warning-text small">{t('send.secret')}</span>
                      </div>
                    </div>
                    <div className="file-row__actions">
                      <button type="button" className="btn btn--light btn--sm" onClick={() => removeKeys([item.key])}>
                        {t('send.secretRemove')}
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => update(item.key, { keep: true })}>
                        {t('send.secretKeep')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="file-row" key={item.key}>
                    <FileIcon size={20} className="file-row__icon" aria-hidden="true" />
                    <div className="file-row__text">
                      <span className="file-row__name">{item.path || item.file.name}</span>
                      <span className="muted small">{formatBytes(item.file.size)}</span>
                    </div>
                    <UploadState items={[item]} />
                    {!locked ? (
                      <button type="button" className="icon-btn" onClick={() => removeKeys([item.key])} aria-label={t('send.remove', { name: item.file.name })}>
                        <X size={18} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ),
              )}

              {rejected.map((r, index) => (
                <div className="file-row file-row--error" role="alert" key={`r${index}`}>
                  <Ban size={20} className="file-row__icon file-row__icon--danger" aria-hidden="true" />
                  <div className="file-row__text">
                    <span className="file-row__name file-row__name--struck">{r.name}</span>
                    <span className="danger-text small">
                      {r.kind === 'executable'
                        ? t('send.executable')
                        : r.kind === 'too-large'
                          ? t('send.rejected.too-large', { size: formatBytes(r.size), max: formatBytes(LIMITS.maxFileBytes) })
                          : t(`send.rejected.${r.kind}`)}
                    </span>
                  </div>
                </div>
              ))}

              {excluded > 0 ? <p className="muted small">{t('send.excluded', { count: excluded })}</p> : null}
              {tooMany ? <p className="danger-text small" role="alert">{t('send.tooMany', { max: LIMITS.maxFiles })}</p> : null}
              {tooLarge ? <p className="danger-text small" role="alert">{t('send.tooLarge', { max: formatBytes(LIMITS.maxTransferBytes) })}</p> : null}

              {!locked ? (
                <>
                  <button type="button" className="link-btn" onClick={() => addInputRef.current?.click()}>
                    {t('send.addMore')}
                  </button>
                  <input
                    ref={addInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      void addCollected(fromInput(e.target.files))
                      e.target.value = ''
                    }}
                  />
                </>
              ) : null}
            </section>

            <section className="field">
              <div className="field__row">
                <span className="field__label" id="recipients-label">
                  {t('send.recipients')}
                </span>
                <div className="segmented segmented--sm" role="group" aria-labelledby="recipients-label">
                  <button
                    type="button"
                    aria-pressed={recipientMode === 'email'}
                    disabled={locked}
                    className={recipientMode === 'email' ? 'is-active' : ''}
                    onClick={() => switchRecipientMode('email')}
                  >
                    {t('send.recipientModeEmail')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={recipientMode === 'orion'}
                    disabled={locked}
                    className={recipientMode === 'orion' ? 'is-active' : ''}
                    onClick={() => switchRecipientMode('orion')}
                  >
                    {t('send.recipientModeOrion')}
                  </button>
                </div>
              </div>

              <div className={`chips${draftError ? ' chips--error' : ''}`}>
                {recipients.map((email) => (
                  <span className="chip" key={email}>
                    {email}
                    {!locked ? (
                      <button type="button" onClick={() => setRecipients(recipients.filter((r) => r !== email))} aria-label={t('send.removeRecipient', { email })}>
                        <X size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                ))}
                {recipientMode === 'email' ? (
                  <input
                    id="recipients-input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder={t('send.recipientsPlaceholder')}
                    value={draft}
                    disabled={locked}
                    onChange={(e) => {
                      setDraft(e.target.value)
                      setDraftError(null)
                    }}
                    onKeyDown={onDraftKey}
                    onBlur={commitDraft}
                    aria-describedby="recipients-hint"
                    aria-invalid={draftError ? true : undefined}
                  />
                ) : (
                  <input
                    id="recipients-orion-input"
                    type="search"
                    autoComplete="off"
                    placeholder={t('send.recipientsOrionPlaceholder')}
                    value={orionQuery}
                    disabled={locked || recipients.length >= LIMITS.maxRecipients}
                    onChange={(e) => setOrionQuery(e.target.value)}
                    aria-describedby="recipients-hint"
                  />
                )}
              </div>

              {recipientMode === 'orion' && !locked ? (
                <ul className="member-picker" role="listbox" aria-label={t('send.recipientModeOrion')}>
                  {orionLoading ? (
                    <li className="muted small">{t('send.recipientsOrionLoading')}</li>
                  ) : orionHits.length === 0 ? (
                    <li className="muted small">{t('send.recipientsOrionEmpty')}</li>
                  ) : (
                    orionHits.map((m) => (
                      <li key={m.email}>
                        <button type="button" className="member-picker__btn" onClick={() => pickOrionMember(m)}>
                          <span className="member-picker__name">{m.display_name || m.email.split('@')[0]}</span>
                          <span className="muted small">{m.email}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}

              <p id="recipients-hint" className={draftError ? 'danger-text small' : 'muted small'}>
                {draftError ?? (recipientMode === 'orion' ? t('send.recipientsOrionHint') : t('send.recipientsHint'))}
              </p>
            </section>

            <section className="field">
              <label className="field__label" htmlFor="message-input">
                {t('send.message')} <span className="muted">{t('send.optional')}</span>
              </label>
              <textarea
                id="message-input"
                rows={3}
                maxLength={LIMITS.maxMessageChars}
                value={message}
                disabled={locked}
                onChange={(e) => setMessage(e.target.value)}
              />
            </section>

            <fieldset className="field">
              <legend className="field__label">{t('send.duration')}</legend>
              <div className="segmented">
                {LIMITS.expiryDays.map((d) => (
                  <button
                    type="button"
                    key={d}
                    aria-pressed={days === d}
                    disabled={locked}
                    className={days === d ? 'is-active' : ''}
                    onClick={() => setDays(d)}
                  >
                    {t('send.days', { count: d })}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="recap">
              <span>
                <span className="muted">{t('send.recapAccess')}</span> {allRecipients.join(', ') || '—'}
              </span>
              <span>
                <span className="muted">{t('send.recapExpiry')}</span> {expiryDate}
              </span>
              <span className="muted">{t('send.recapNote')}</span>
            </div>

            {offline ? (
              <p className="banner" role="status">
                <WifiOff size={18} aria-hidden="true" /> {t('send.offline')}
              </p>
            ) : null}
            {error ? (
              <p className="danger-text" role="alert">
                {error}
              </p>
            ) : null}
            {failed.length > 0 && phase === 'sending' ? (
              <div className="file-row file-row--error" role="alert">
                <div className="file-row__text">
                  <span>{failed.map((f) => t('send.fileFailed', { name: f.file.name })).join(' ')}</span>
                </div>
                <button type="button" className="btn btn--ghost btn--sm" onClick={retryFailed} disabled={offline}>
                  <RotateCcw size={14} aria-hidden="true" /> {t('send.retry')}
                </button>
              </div>
            ) : null}
          </div>

          <div className="panel__foot">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={phase === 'sending' && failed.length === 0}>
              {t('send.cancel')}
            </button>
            <button type="button" className="btn btn--primary btn--glow" onClick={send} disabled={!canSend}>
              {phase === 'sending' ? t('send.sending') : t('send.submit', { count: items.length })}
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}

function UploadState({ items }: { items: Item[] }) {
  if (items.every((i) => i.state === 'idle')) return null
  if (items.some((i) => i.state === 'error')) return <span className="danger-text small">Échec</span>
  const total = items.reduce((s, i) => s + i.file.size, 0) || 1
  const done = items.reduce((s, i) => s + i.file.size * i.progress, 0)
  const percent = Math.round((done / total) * 100)
  if (percent >= 100) return <Check size={18} className="success-text" aria-label="Envoyé" />
  return (
    <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Progression">
      <span style={{ width: `${percent}%` }} />
    </span>
  )
}
