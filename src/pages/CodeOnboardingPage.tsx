import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Code2,
  ExternalLink,
  ImagePlus,
  Mail,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { createCodeProject, inviteCodeByEmail } from '../api/codeProjects'
import { OrionMark } from '../components/Icons'
import { fileToCoverDataUrl } from '../lib/coverImage'
import { errorMessage, t } from '../i18n'

type Step = 0 | 1 | 2 | 3 | 4

const STEPS = [
  t('onboard.stepWelcome'),
  t('onboard.stepDefine'),
  t('onboard.stepPhoto'),
  t('onboard.stepMembers'),
  t('onboard.stepIde'),
]

const ease = [0.22, 1, 0.36, 1] as const

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
    if (step === 1) return name.trim().length > 0
    if (step === 4 && linkGithub) {
      return githubUrl.trim().length === 0 || /^https?:\/\//i.test(githubUrl.trim())
    }
    return true
  }, [step, name, linkGithub, githubUrl])

  const progress = ((step + 1) / STEPS.length) * 100

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
        ideLinks: { vscode: linkVscode, cursor: linkCursor, github: linkGithub },
        content: JSON.stringify({
          v: 1,
          files: {
            'README.md': `# ${name.trim()}\n\n${description.trim() ? `${description.trim()}\n\n` : ''}Ouvrez un dossier ou créez des fichiers pour collaborer.\n`,
          },
        }),
      })
      await Promise.allSettled(members.map((email) => inviteCodeByEmail(created.id, email)))
      navigate(`/code/${created.id}`, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const goNext = () => {
    if (!canNext || busy) return
    if (step < 4) setStep((s) => (s + 1) as Step)
    else void finish()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    goNext()
  }

  const actions = (
    <div className={`code-onboard__actions${step === 0 ? ' code-onboard__actions--center' : ''}`}>
      {step > 0 ? (
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy}
          onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {t('onboard.back')}
        </button>
      ) : (
        <Link to="/code" className="btn btn--ghost">
          {t('code.backList')}
        </Link>
      )}
      <button type="submit" className="btn btn--primary btn--glow" disabled={!canNext || busy} form="onboard-form">
        {busy ? (
          t('auth.working')
        ) : step === 4 ? (
          <>
            {t('onboard.openIde')}
            <ArrowRight size={16} aria-hidden="true" />
          </>
        ) : step === 0 ? (
          <>
            {t('onboard.start')}
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
  )

  let body: ReactNode = null
  if (step === 0) {
    body = (
      <section className="code-onboard__welcome">
        <p className="code-onboard__kicker">
          <Sparkles size={14} aria-hidden="true" /> {t('onboard.welcomeKicker')}
        </p>
        <h1>
          {t('onboard.welcomeTitle')}
          <br />
          <em>{t('onboard.welcomeTitleEm')}</em>
        </h1>
        <p className="code-onboard__lead">{t('onboard.welcomeLead')}</p>
        <ul className="code-onboard__pillars">
          <li>
            <Code2 size={16} /> {t('onboard.pillarProject')}
          </li>
          <li>
            <Users size={16} /> {t('onboard.pillarTeam')}
          </li>
          <li>
            <ExternalLink size={16} /> {t('onboard.pillarIde')}
          </li>
        </ul>
        {actions}
      </section>
    )
  } else if (step === 1) {
    body = (
      <section className="stack-16">
        <p className="code-onboard__kicker">{t('onboard.defineKicker')}</p>
        <h1>{t('onboard.defineTitle')}</h1>
        <p className="code-onboard__lead">{t('onboard.defineHint')}</p>
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
            rows={4}
            placeholder={t('onboard.descriptionPlaceholder')}
          />
        </label>
      </section>
    )
  } else if (step === 2) {
    body = (
      <section className="stack-16">
        <p className="code-onboard__kicker">{t('onboard.photoKicker')}</p>
        <h1>{t('onboard.photoTitle')}</h1>
        <p className="code-onboard__lead">{t('onboard.photoHint')}</p>
        <button
          type="button"
          className={`code-onboard__cover${cover ? ' has-image' : ''}`}
          onClick={() => photoInput.current?.click()}
        >
          {cover ? (
            <img src={cover} alt="" />
          ) : (
            <span className="code-onboard__cover-empty">
              <ImagePlus size={32} aria-hidden="true" />
              <strong>{t('onboard.photoEmpty')}</strong>
              <span className="muted small">{t('onboard.photoDrop')}</span>
            </span>
          )}
        </button>
        <div className="row-wrap">
          <button type="button" className="btn btn--primary" onClick={() => photoInput.current?.click()}>
            <ImagePlus size={16} aria-hidden="true" />
            {cover ? t('onboard.photoChange') : t('onboard.photoPick')}
          </button>
          {cover ? (
            <button type="button" className="btn btn--ghost" onClick={() => setCover(null)}>
              {t('onboard.photoRemove')}
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={goNext}>
              {t('onboard.photoSkip')}
            </button>
          )}
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
      </section>
    )
  } else if (step === 3) {
    body = (
      <section className="stack-16">
        <p className="code-onboard__kicker">{t('onboard.membersKicker')}</p>
        <h1>{t('onboard.membersTitle')}</h1>
        <p className="code-onboard__lead">{t('onboard.membersHint')}</p>
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
          <ul className="code-onboard__chips">
            {members.map((email) => (
              <li key={email}>
                <span>{email}</span>
                <button
                  type="button"
                  aria-label={t('send.removeRecipient', { email })}
                  onClick={() => setMembers(members.filter((m) => m !== email))}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  } else {
    body = (
      <section className="stack-16">
        <p className="code-onboard__kicker">{t('onboard.ideKicker')}</p>
        <h1>{t('onboard.ideTitle')}</h1>
        <p className="code-onboard__lead">{t('onboard.ideHint')}</p>
        <div className="code-onboard__ide-grid">
          <button
            type="button"
            className={`code-onboard__card${linkVscode ? ' is-on' : ''}`}
            onClick={() => setLinkVscode((v) => !v)}
          >
            <Code2 size={22} aria-hidden="true" />
            <strong>VS Code</strong>
            <span>{t('onboard.ideVscode')}</span>
          </button>
          <button
            type="button"
            className={`code-onboard__card${linkCursor ? ' is-on' : ''}`}
            onClick={() => setLinkCursor((v) => !v)}
          >
            <ExternalLink size={22} aria-hidden="true" />
            <strong>Cursor</strong>
            <span>{t('onboard.ideCursor')}</span>
          </button>
          <button
            type="button"
            className={`code-onboard__card${linkGithub ? ' is-on' : ''}`}
            onClick={() => setLinkGithub((v) => !v)}
          >
            <Users size={22} aria-hidden="true" />
            <strong>GitHub</strong>
            <span>{t('onboard.ideGithub')}</span>
          </button>
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
      </section>
    )
  }

  return (
    <div className="code-onboard">
      <div className="code-onboard__bg" aria-hidden="true">
        <img src="/images/hero-cosmic-bg.jpg" alt="" />
        <div className="code-onboard__veil" />
      </div>

      <header className="code-onboard__top">
        <div className="code-onboard__brand">
          <OrionMark size={22} />
          <span className="code-onboard__brand-word">ORION</span>
          <span className="code-onboard__brand-sub">{t('onboard.brandSub')}</span>
        </div>
        <div className="code-onboard__progress" aria-label={t('onboard.progressLabel', { step: step + 1, total: STEPS.length })}>
          <div className="code-onboard__progress-track">
            <motion.i
              className="code-onboard__progress-fill"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.45, ease }}
            />
          </div>
          <ol className="code-onboard__steps">
            {STEPS.map((label, i) => (
              <li key={label} className={i === step ? 'is-active' : i < step ? 'is-done' : ''}>
                {label}
              </li>
            ))}
          </ol>
        </div>
      </header>

      <main className={`code-onboard__main${step === 0 ? ' code-onboard__main--hero' : ''}`}>
        <form id="onboard-form" className="code-onboard__panel" onSubmit={onSubmit}>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4, ease }}
            >
              {body}
              {error ? (
                <p className="error" role="alert" style={{ marginTop: 16 }}>
                  {error}
                </p>
              ) : null}
              {step > 0 ? <div style={{ marginTop: 28 }}>{actions}</div> : null}
            </motion.div>
          </AnimatePresence>
        </form>
      </main>
    </div>
  )
}
