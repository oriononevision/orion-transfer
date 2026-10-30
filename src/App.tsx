import { BrowserRouter, HashRouter, Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { IS_DEMO } from './api/transfers'
import { safeNextPath } from './lib/auth'
import { AuthProvider, useAuth } from './context/AuthContext'
import { t } from './i18n'
import AccountPage from './pages/AccountPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import CodeJoinPage from './pages/CodeJoinPage'
import CodeOnboardingPage from './pages/CodeOnboardingPage'
import CodeProjectPage from './pages/CodeProjectPage'
import CodeProjectsPage from './pages/CodeProjectsPage'
import LoginPage from './pages/LoginPage'
import TransferDetailPage from './pages/TransferDetailPage'
import TransfersPage from './pages/TransfersPage'

function Loading() {
  return (
    <div className="auth" style={{ placeItems: 'center', display: 'grid' }}>
      <p className="auth__switch" role="status">
        {t('auth.loading')}
      </p>
    </div>
  )
}

/** Pages privées : sans session, renvoie vers la connexion puis revient ici. */
function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/connexion?next=${next}`} replace />
  }
  return <Outlet />
}

function PublicOnly() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  if (loading) return <Loading />
  // Déjà connecté (par ex. depuis un e-mail d'invitation) : aller à la page demandée.
  if (session) return <Navigate to={safeNextPath(params.get('next'))} replace />
  return <Outlet />
}

// La démo est servie comme simple page statique : navigation par « # ».
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
          <Route element={<PublicOnly />}>
            <Route path="connexion" element={<LoginPage />} />
            <Route path="inscription" element={<LoginPage />} />
          </Route>
          <Route path="auth/callback" element={<AuthCallbackPage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<TransfersPage />} />
            <Route path="t/:id" element={<TransferDetailPage />} />
            <Route path="code" element={<CodeProjectsPage />} />
            <Route path="code/nouveau" element={<CodeOnboardingPage />} />
            <Route path="code/rejoindre/:token" element={<CodeJoinPage />} />
            <Route path="code/:id" element={<CodeProjectPage />} />
            <Route path="compte" element={<AccountPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}
