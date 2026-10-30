import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  ExternalLink,
  ImagePlus,
  Mail,
  Users,
  X,
} from 'lucide-react'
import { createCodeProject, inviteCodeByEmail } from '../api/codeProjects'
import Header from '../components/Header'
import { fileToCoverDataUrl } from '../lib/coverImage'
import { errorMessage, t } from '../i18n'

type Step = 0 | 1 | 2 | 3

const STEPS = [
  { id: 0 as const, titleKey: 'onboard.stepDefine' as const },
  { id: 1 as const, titleKey: 'onboard.stepPhoto' as const },
  { id: 2 as const, titleKey: 'onboard.stepMembers' as const },
  { id: 3 as const, titleKey: 'onboard.stepIde' as const },
]

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function CodeOnboardingPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(0)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cover, setCover] = useState<string | null>(null)
  const [members, setMembers] = useState<string[]>([])
  const [memberInput, setMemberInput] = useState('')
  const [linkVscode, setLinkVscode] = useState(true)
  const [linkCursor, setLinkCursor] = useState(true)
  const [linkGithub, setLinkGithub] = useState(false)
  const [githubUrl, setGithubUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  const canNext = useMemo(() => {
    if (step === 0) return name.trim().length > 0
    if (step === 3 && linkGithub) return githubUrl.trim().length === 0 || /^https?:\/\//i.test(githubUrl.trim())
    return true
  }, [step, name, linkGithub, githubUrl])

  const addMember = () => {
    const email = memberInput.trim().toLowerCase()
    if (!email) return
    if (!isEmail(email)) {
      setError(t('send.recipientInvalid', { value: email }))
      return
    }
    setError(null)
    if (!members.includes(email)) setMembers([...members, email])
    setMemberInput('')
  }

  const onPhoto = async (file: File | null) => {
    if (!file) return
    setError(null)
    try {
      setCover(await fileToCoverDataUrl(file))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const finish = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await createCodeProject({
        name: name.trim(),
        description: description.trim() || undefined,
        githubUrl: linkGithub && githubUrl.trim() ? githubUrl.trim() : undefined,
        coverImage: cover ?? undefined,
        ideLinks: {
          vscode: linkVscode,
          cursor: linkCursor,
          github: linkGithub,
        },
        content: JSON.stringify({
          v: 1,
          files: {
            'README.md': `# ${name.trim()}\n\n${description.trim() ? `${description.trim()}\n\n` : ''}Ouvrez un dossier ou créez des fichiers pour collaborer.\n`,
          },
        }),
      })

      // Invitations en arrière-plan (ne bloque pas l’entrée dans l’IDE).
      await Promise.allSettled(members.map((email) => inviteCodeByEmail(created.id, email)))

      navigate(`/code/${created.id}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const onSubmitStep = (e: FormEvent) => {
    e.preventDefault()
    if (!canNext || busy) return
    if (step < 3) setStep((s) => (s + 1) as Step)
    else void finish()
  }

  return (
    <div className="page">
      <Header />
      <main className="container container--narrow stack-24">
        <div className="stack-6">
          <p className="muted small">
            <Link to="/code" className="text-link">
              {t('code.backList')}
            </Link>
          </p>
          <h1 className="title title--sm">{t('onboard.title')}</h1>
          <p className="muted lead">{t('onboard.subtitle')}</p>
        </div>

        <ol className="onboard-steps" aria-label={t('onboard.progress')}>
          {STEPS.map((s) => (
            <li key={s.id} className={step === s.id ? 'is-current' : step > s.id ? 'is-done' : ''}>
              <span className="onboard-steps__dot" aria-hidden="true">
                {step > s.id ? <Check size={12} /> : s.id + 1}
              </span>
              <span>{t(s.titleKey)}</span>
            </li>
          ))}
        </ol>

        <form className="surface stack-20" onSubmit={onSubmitStep}>
          {step === 0 ? (
            <div className="stack-16">
              <h2 className="section-title">{t('onboard.defineTitle')}</h2>
              <p className="muted small">{t('onboard.defineHint')}</p>
              <label className="field">
                <span className="field__label">{t('code.name')}</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  required
                  autoFocus
                  placeholder={t('code.namePlaceholder')}
                />
              </label>
              <label className="field">
                <span className="field__label">
                  {t('code.description')} <span className="muted">{t('send.optional')}</span>
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder={t('onboard.descriptionPlaceholder')}
                />
              </label>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="stack-16">
              <h2 className="section-title">{t('onboard.photoTitle')}</h2>
              <p className="muted small">{t('onboard.photoHint')}</p>
              <div className={`onboard-cover${cover ? ' has-image' : ''}`}>
                {cover ? (
                  <img src={cover} alt="" />
                ) : (
                  <div className="onboard-cover__empty">
                    <ImagePlus size={28} aria-hidden="true" />
                    <span>{t('onboard.photoEmpty')}</span>
                  </div>
                )}
              </div>
              <div className="row-wrap">
                <button type="button" className="btn btn--primary" onClick={() => photoInput.current?.click()}>
                  <ImagePlus size={16} aria-hidden="true" />
                  {cover ? t('onboard.photoChange') : t('onboard.photoPick')}
                </button>
                {cover ? (
                  <button type="button" className="btn btn--ghost" onClick={() => setCover(null)}>
                    {t('onboard.photoRemove')}
                  </button>
                ) : null}
              </div>
              <input
                ref={photoInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  void onPhoto(e.target.files?.[0] ?? null)
                  e.target.value = ''
                }}
              />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="stack-16">
              <h2 className="section-title">{t('onboard.membersTitle')}</h2>
              <p className="muted small">{t('onboard.membersHint')}</p>
              <div className="row-wrap">
                <label className="field field--inline">
                  <span className="sr-only">{t('code.inviteEmail')}</span>
                  <input
                    type="email"
                    value={memberInput}
                    onChange={(e) => setMemberInput(e.target.value)}
                    placeholder={t('code.inviteEmail')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addMember()
                      }
                    }}
                  />
                </label>
                <button type="button" className="btn btn--ghost" onClick={addMember}>
                  <Mail size={16} aria-hidden="true" />
                  {t('onboard.memberAdd')}
                </button>
              </div>
              {members.length === 0 ? (
                <p className="muted small">{t('onboard.membersEmpty')}</p>
              ) : (
                <ul className="member-list">
                  {members.map((email) => (
                    <li key={email}>
                      <span>{email}</span>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={t('send.removeRecipient', { email })}
                        onClick={() => setMembers(members.filter((m) => m !== email))}
                      >
                        <X size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="stack-16">
              <h2 className="section-title">{t('onboard.ideTitle')}</h2>
              <p className="muted small">{t('onboard.ideHint')}</p>
              <div className="onboard-ide-grid">
                <label className={`onboard-ide-card${linkVscode ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={linkVscode} onChange={(e) => setLinkVscode(e.target.checked)} />
                  <Code2 size={20} aria-hidden="true" />
                  <span>
                    <strong>VS Code</strong>
                    <span className="muted small">{t('onboard.ideVscode')}</span>
                  </span>
                </label>
                <label className={`onboard-ide-card${linkCursor ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={linkCursor} onChange={(e) => setLinkCursor(e.target.checked)} />
                  <ExternalLink size={20} aria-hidden="true" />
                  <span>
                    <strong>Cursor</strong>
                    <span className="muted small">{t('onboard.ideCursor')}</span>
                  </span>
                </label>
                <label className={`onboard-ide-card${linkGithub ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={linkGithub} onChange={(e) => setLinkGithub(e.target.checked)} />
                  <Users size={20} aria-hidden="true" />
                  <span>
                    <strong>GitHub</strong>
                    <span className="muted small">{t('onboard.ideGithub')}</span>
                  </span>
                </label>
              </div>
              {linkGithub ? (
                <label className="field">
                  <span className="field__label">{t('code.github')}</span>
                  <input
                    type="url"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/org/repo"
                    maxLength={500}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="row-wrap between">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy || step === 0}
              onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              {t('onboard.back')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={!canNext || busy}>
              {busy ? (
                t('auth.working')
              ) : step === 3 ? (
                <>
                  {t('onboard.openIde')}
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              ) : (
                <>
                  {t('onboard.next')}
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
