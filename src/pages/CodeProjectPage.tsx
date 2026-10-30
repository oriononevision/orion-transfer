import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  GitBranch,
  Link2,
  Mail,
  RefreshCw,
  Send,
} from 'lucide-react'
import {
  getCodeProject,
  inviteCodeByEmail,
  markCodeSeen,
  projectShareUrl,
  pushCodeRevision,
  type CodeProjectDetail,
} from '../api/codeProjects'
import CodeIde from '../components/CodeIde'
import Header from '../components/Header'
import StatusPill from '../components/StatusPill'
import {
  assertWorkspaceLimits,
  emptyWorkspace,
  parseWorkspace,
  serializeWorkspace,
  type FileMap,
} from '../lib/codeWorkspace'
import { errorMessage, formatDateTime, t } from '../i18n'

export default function CodeProjectPage() {
  const { id = '' } = useParams()
  const [project, setProject] = useState<CodeProjectDetail | null>(null)
  const [files, setFiles] = useState<FileMap>(emptyWorkspace)
  const [savedRaw, setSavedRaw] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteNote, setInviteNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [sentFlash, setSentFlash] = useState(false)
  const filesRef = useRef(files)
  const savedRef = useRef(savedRaw)
  filesRef.current = files
  savedRef.current = savedRaw

  const applyProject = useCallback((data: CodeProjectDetail, replaceEditor: boolean) => {
    setProject(data)
    const raw = data.latest_revision?.content ?? ''
    if (replaceEditor) {
      setFiles(parseWorkspace(raw))
      setSavedRaw(raw || serializeWorkspace(emptyWorkspace()))
    }
  }, [])

  const load = useCallback(async (opts?: { forceContent?: boolean }) => {
    if (!id) return
    setError(null)
    try {
      const data = await getCodeProject(id)
      const currentRaw = serializeWorkspace(filesRef.current)
      const dirty = currentRaw !== savedRef.current
      const replace = Boolean(opts?.forceContent) || !dirty
      applyProject(data, replace)
    } catch (err) {
      setError(errorMessage(err))
      setProject((prev) => prev)
    }
  }, [id, applyProject])

  useEffect(() => {
    void load({ forceContent: true })
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 20_000)
    return () => window.clearInterval(poll)
  }, [id, load])

  const reloadLatest = async () => {
    if (!id) return
    try {
      const data = await getCodeProject(id)
      applyProject(data, true)
      if (data.latest_revision) {
        await markCodeSeen(id, data.latest_revision.id)
        setProject({
          ...data,
          is_outdated: false,
          last_seen_revision_id: data.latest_revision.id,
        })
      }
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const onSend = async (e: FormEvent) => {
    e.preventDefault()
    if (!id || busy) return
    const limit = assertWorkspaceLimits(files)
    if (limit) {
      setError(errorMessage(new Error(limit)))
      return
    }
    setBusy(true)
    setError(null)
    const raw = serializeWorkspace(files)
    try {
      await pushCodeRevision(id, raw, message.trim() || undefined)
      setSavedRaw(raw)
      setMessage('')
      setSentFlash(true)
      window.setTimeout(() => setSentFlash(false), 2500)
      await load({ forceContent: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!project) return
    const url = projectShareUrl(project.invite_token)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setInviteNote(url)
    }
  }

  const onInvite = async (e: FormEvent) => {
    e.preventDefault()
    if (!id || !inviteEmail.trim()) return
    setBusy(true)
    setInviteNote(null)
    try {
      await inviteCodeByEmail(id, inviteEmail.trim())
      setInviteNote(t('code.inviteSent', { email: inviteEmail.trim() }))
      setInviteEmail('')
    } catch (err) {
      setInviteNote(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const downloadZipHint = () => {
    // Télécharge le fichier actif sous forme d’archive JSON lisible.
    const blob = new Blob([serializeWorkspace(files)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project?.name || 'projet'}.orion-code.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const openIde = (kind: 'vscode' | 'cursor' | 'github') => {
    if (kind === 'github' && project?.github_url) {
      window.open(project.github_url, '_blank', 'noopener,noreferrer')
      return
    }
    downloadZipHint()
    if (kind === 'vscode') window.location.href = 'vscode://'
    else if (kind === 'cursor') window.location.href = 'cursor://'
  }

  if (error && !project) {
    return (
      <div className="page">
        <Header />
        <main className="container stack-16">
          <Link to="/code" className="text-link">
            {t('code.backList')}
          </Link>
          <div className="empty" role="alert">
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={() => void load({ forceContent: true })}>
              {t('list.retry')}
            </button>
          </div>
        </main>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="page">
        <Header />
        <main className="container">
          <p className="muted" role="status">
            {t('auth.loading')}
          </p>
        </main>
      </div>
    )
  }

  const outdated = project.is_outdated

  return (
    <div className="page page--ide">
      <Header />
      <main className="container container--ide stack-20">
        <div className="ide-page-bar">
          <div className="ide-page-bar__meta">
            <Link to="/code" className="text-link small">
              {t('code.backList')}
            </Link>
            <div className="ide-page-bar__title">
              {project.cover_image ? <img className="project-cover" src={project.cover_image} alt="" /> : null}
              <div>
                <h1 className="title title--sm">{project.name}</h1>
                {project.latest_revision ? (
                  <p className="muted small" style={{ margin: 0 }}>
                    {t('code.revisionMeta', {
                      author: project.latest_revision.author || '—',
                      date: formatDateTime(project.latest_revision.created_at),
                    })}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="ide-page-bar__actions">
            <StatusPill
              tone={outdated ? 'accent' : 'success'}
              label={outdated ? t('code.statusOutdated') : t('code.statusUpToDate')}
            />
            {outdated ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void reloadLatest()}>
                <RefreshCw size={14} aria-hidden="true" />
                {t('code.reload')}
              </button>
            ) : null}
          </div>
        </div>

        <CodeIde files={files} onChange={setFiles} disabled={busy} projectName={project.name} />

        <form className="ide-send-bar" onSubmit={onSend}>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            placeholder={t('code.messagePlaceholder')}
            aria-label={t('code.message')}
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            <Send size={18} aria-hidden="true" />
            {busy ? t('code.sending') : t('code.send')}
          </button>
          {sentFlash ? (
            <span className="muted small" role="status">
              <Check size={14} aria-hidden="true" /> {t('code.sent')}
            </span>
          ) : null}
          {error ? (
            <p className="error" role="alert" style={{ margin: 0, flexBasis: '100%' }}>
              {error}
            </p>
          ) : null}
        </form>

        <section className="stack-12" aria-labelledby="ide-title">
          <h2 id="ide-title" className="section-title">
            {t('code.ideTitle')}
          </h2>
          <p className="muted small">{t('code.ideHint')}</p>
          <div className="row-wrap">
            {project.ide_links?.vscode !== false ? (
              <button type="button" className="btn btn--ghost" onClick={() => openIde('vscode')}>
                <ExternalLink size={16} aria-hidden="true" />
                {t('code.openVscode')}
              </button>
            ) : null}
            {project.ide_links?.cursor !== false ? (
              <button type="button" className="btn btn--ghost" onClick={() => openIde('cursor')}>
                <ExternalLink size={16} aria-hidden="true" />
                {t('code.openCursor')}
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost" onClick={downloadZipHint}>
              <Download size={16} aria-hidden="true" />
              {t('code.download')}
            </button>
            {project.ide_links?.github && project.github_url ? (
              <button type="button" className="btn btn--ghost" onClick={() => openIde('github')}>
                <GitBranch size={16} aria-hidden="true" />
                {t('code.openGithub')}
              </button>
            ) : null}
          </div>
        </section>

        <section className="stack-12" aria-labelledby="share-title">
          <h2 id="share-title" className="section-title">
            {t('code.shareTitle')}
          </h2>
          <p className="muted small">{t('code.shareHint')}</p>
          <div className="row-wrap">
            <button type="button" className="btn btn--ghost" onClick={copyLink}>
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copied ? t('code.linkCopied') : t('code.copyLink')}
            </button>
            <span className="muted small mono truncate">
              <Link2 size={14} aria-hidden="true" /> {projectShareUrl(project.invite_token)}
            </span>
          </div>
          <form className="row-wrap" onSubmit={onInvite}>
            <label className="field field--inline">
              <span className="sr-only">{t('code.inviteEmail')}</span>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t('code.inviteEmail')}
                required
              />
            </label>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              <Mail size={16} aria-hidden="true" />
              {t('code.inviteSend')}
            </button>
          </form>
          {inviteNote ? (
            <p className="muted small" role="status">
              {inviteNote}
            </p>
          ) : null}
          <ul className="member-list">
            {project.members.map((m) => (
              <li key={m.user_id}>
                <span>{m.email}</span>
                <span className="muted small">{m.role === 'owner' ? t('code.roleOwner') : t('code.roleMember')}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}
