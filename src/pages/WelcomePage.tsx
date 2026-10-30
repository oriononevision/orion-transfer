import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Code2, Folder, Lock, Share2, Sparkles, Upload } from 'lucide-react'
import { OrionMark } from '../components/Icons'
import { isDesktopApp } from '../lib/desktop'
import { completeWelcome } from '../lib/welcomeStore'
import { t } from '../i18n'

const ease = [0.22, 1, 0.36, 1] as const
const STEPS = [
  t('welcome.stepIntro'),
  t('welcome.stepShare'),
  t('welcome.stepSecure'),
  t('welcome.stepReady'),
] as const

export default function WelcomePage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const desktop = isDesktopApp()
  const progress = ((step + 1) / STEPS.length) * 100

  const finish = (path: '/connexion' | '/inscription') => {
    completeWelcome()
    navigate(path)
  }

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1)
    else finish('/connexion')
  }

  return (
    <div className="code-onboard welcome">
      <div className="code-onboard__bg" aria-hidden="true">
        <img src="/images/hero-cosmic-bg.jpg" alt="" />
        <div className="code-onboard__veil" />
      </div>

      <header className="code-onboard__top">
        <div className="code-onboard__brand">
          <OrionMark size={22} />
          <span className="code-onboard__brand-word">ORION</span>
          <span className="code-onboard__brand-sub">TRANSFER</span>
        </div>
        <div className="code-onboard__progress" aria-label={t('welcome.progress', { step: step + 1, total: STEPS.length })}>
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
        <div className="code-onboard__panel">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4, ease }}
            >
              {step === 0 ? (
                <section className="code-onboard__welcome">
                  <p className="code-onboard__kicker">
                    <Sparkles size={14} aria-hidden="true" /> {t('welcome.kicker')}
                  </p>
                  <h1>
                    {t('welcome.title')}
                    <br />
                    <em>{desktop ? t('welcome.titleEmDesktop') : t('welcome.titleEmWeb')}</em>
                  </h1>
                  <p className="code-onboard__lead">{t('welcome.lead')}</p>
                  <ul className="code-onboard__pillars">
                    <li>
                      <Upload size={16} /> {t('welcome.pillarFiles')}
                    </li>
                    <li>
                      <Folder size={16} /> {t('welcome.pillarFolders')}
                    </li>
                    <li>
                      <Code2 size={16} /> {t('welcome.pillarCode')}
                    </li>
                  </ul>
                  <div className="code-onboard__actions code-onboard__actions--center">
                    <button type="button" className="btn btn--primary btn--glow" onClick={next}>
                      {t('welcome.start')}
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => finish('/connexion')}>
                      {t('welcome.skip')}
                    </button>
                  </div>
                </section>
              ) : null}

              {step === 1 ? (
                <section>
                  <p className="code-onboard__kicker">
                    <Share2 size={14} /> {t('welcome.shareKicker')}
                  </p>
                  <h1>{t('welcome.shareTitle')}</h1>
                  <p className="code-onboard__lead">{t('welcome.shareLead')}</p>
                  <div className="code-onboard__ide-grid welcome-features">
                    <div className="code-onboard__card is-on">
                      <Upload size={22} />
                      <strong>{t('welcome.featFiles')}</strong>
                      <span>{t('welcome.featFilesHint')}</span>
                    </div>
                    <div className="code-onboard__card is-on">
                      <Folder size={22} />
                      <strong>{t('welcome.featFolders')}</strong>
                      <span>{t('welcome.featFoldersHint')}</span>
                    </div>
                    <div className={`code-onboard__card${desktop ? ' is-on' : ''}`}>
                      <Code2 size={22} />
                      <strong>{t('welcome.featCode')}</strong>
                      <span>{desktop ? t('welcome.featCodeDesktop') : t('welcome.featCodeWeb')}</span>
                    </div>
                  </div>
                </section>
              ) : null}

              {step === 2 ? (
                <section>
                  <p className="code-onboard__kicker">
                    <Lock size={14} /> {t('welcome.secureKicker')}
                  </p>
                  <h1>{t('welcome.secureTitle')}</h1>
                  <p className="code-onboard__lead">{t('welcome.secureLead')}</p>
                  <ul className="welcome-list">
                    <li>{t('welcome.secureItem1')}</li>
                    <li>{t('welcome.secureItem2')}</li>
                    <li>{t('welcome.secureItem3')}</li>
                  </ul>
                </section>
              ) : null}

              {step === 3 ? (
                <section className="code-onboard__welcome">
                  <p className="code-onboard__kicker">{t('welcome.readyKicker')}</p>
                  <h1>
                    {t('welcome.readyTitle')}
                    <br />
                    <em>{t('welcome.readyTitleEm')}</em>
                  </h1>
                  <p className="code-onboard__lead">{t('welcome.readyLead')}</p>
                  <div className="code-onboard__actions code-onboard__actions--center">
                    <button type="button" className="btn btn--primary btn--glow" onClick={() => finish('/connexion')}>
                      {t('auth.tabLogin')}
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => finish('/inscription')}>
                      {t('auth.tabSignup')}
                    </button>
                  </div>
                </section>
              ) : null}

              {step > 0 && step < 3 ? (
                <div className="code-onboard__actions" style={{ marginTop: 28 }}>
                  <button type="button" className="btn btn--ghost" onClick={() => setStep((s) => s - 1)}>
                    {t('onboard.back')}
                  </button>
                  <button type="button" className="btn btn--primary" onClick={next}>
                    {t('onboard.next')}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
