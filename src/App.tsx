import { BrowserRouter, HashRouter, Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { IS_DEMO } from './api/transfers'
import { safeNextPath } from './lib/auth'
import { isDesktopApp } from './lib/desktop'
import { isWelcomeComplete } from './lib/welcomeStore'
import { AuthProvider, useAuth } from './context/AuthContext'
import { t } from './i18n'
import AccountPage from './pages/AccountPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import DesktopAuthPage from './pages/DesktopAuthPage'
import CodeJoinPage from './pages/CodeJoinPage'
import CodeOnboardingPage from './pages/CodeOnboardingPage'
import CodeProjectPage from './pages/CodeProjectPage'
import CodeProjectsPage from './pages/CodeProjectsPage'
import LoginPage from './pages/LoginPage'
import TransferDetailPage from './pages/TransferDetailPage'
import TransfersPage from './pages/TransfersPage'
import WelcomePage from './pages/WelcomePage'

function Loading() {
  return (
    <div className="auth" style={{ placeItems: 'center', display: 'grid' }}>
      <p className="auth__switch" role="status">
        {t('auth.loading')}
      </p>
    </div>
  )
}

/** Présentation du logiciel avant connexion. */
function WelcomeGate() {
  const { session, loading } = useAuth()
  if (loading) return <Loading />
  if (session) return <Navigate to="/" replace />
  if (isWelcomeComplete()) return <Navigate to="/connexion" replace />
  return <Outlet />
}

/** Pages auth : sans welcome terminé → présentation ; déjà connecté → app. */
function PublicOnly() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  if (loading) return <Loading />
  if (session) return <Navigate to={safeNextPath(params.get('next'))} replace />
  if (!isWelcomeComplete()) return <Navigate to="/bienvenue" replace />
  return <Outlet />
}

function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search)
    if (!isWelcomeComplete()) return <Navigate to="/bienvenue" replace />
    return <Navigate to={`/connexion?next=${next}`} replace />
  }
  return <Outlet />
}

/** Code partagé : réservé au logiciel bureau. */
function RequireDesktop() {
  if (!isDesktopApp()) return <Navigate to="/" replace />
  return <Outlet />
}

const Router = IS_DEMO ? HashRouter : BrowserRouter

function DemoBanner() {
  return (
    <p className="demo-banner" role="note">
      Démonstration — données fictives, rien n’est réellement envoyé.
    </p>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        {IS_DEMO ? <DemoBanner /> : null}
        <Routes>
          <Route element={<WelcomeGate />}>
            <Route path="bienvenue" element={<WelcomePage />} />
          </Route>
          <Route element={<PublicOnly />}>
            <Route path="connexion" element={<LoginPage />} />
            <Route path="inscription" element={<LoginPage />} />
          </Route>
          <Route path="auth/callback" element={<AuthCallbackPage />} />
          <Route path="auth/desktop" element={<DesktopAuthPage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<TransfersPage />} />
            <Route path="t/:id" element={<TransferDetailPage />} />
            <Route element={<RequireDesktop />}>
              <Route path="code" element={<CodeProjectsPage />} />
              <Route path="code/nouveau" element={<CodeOnboardingPage />} />
              <Route path="code/rejoindre/:token" element={<CodeJoinPage />} />
              <Route path="code/:id" element={<CodeProjectPage />} />
            </Route>
            <Route path="compte" element={<AccountPage />} />
          </Route>
          <Route path="*" element={<Navigate to={isWelcomeComplete() ? '/' : '/bienvenue'} replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}
