import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { t } from './i18n'
import AccountPage from './pages/AccountPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import LoginPage from './pages/LoginPage'
import TransferDetailPage from './pages/TransferDetailPage'
import TransfersPage from './pages/TransfersPage'

function Loading() {
  return (
    <div className="auth">
      <p className="muted" role="status">
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
  if (loading) return <Loading />
  if (session) return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<PublicOnly />}>
            <Route path="connexion" element={<LoginPage />} />
          </Route>
          <Route path="auth/callback" element={<AuthCallbackPage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<TransfersPage />} />
            <Route path="t/:id" element={<TransferDetailPage />} />
            <Route path="compte" element={<AccountPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
