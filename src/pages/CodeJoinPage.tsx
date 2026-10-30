import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { joinCodeByToken } from '../api/codeProjects'
import Header from '../components/Header'
import { errorMessage, t } from '../i18n'

export default function CodeJoinPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const joined = await joinCodeByToken(token)
        if (!cancelled) navigate(`/code/${joined.project_id}`, { replace: true })
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, navigate])

  return (
    <div className="page">
      <Header />
      <main className="container stack-16">
        {error ? (
          <div className="empty" role="alert">
            <p>{error}</p>
            <Link to="/code" className="btn btn--ghost">
              {t('code.backList')}
            </Link>
          </div>
        ) : (
          <p className="muted" role="status">
            {t('code.joining')}
          </p>
        )}
      </main>
    </div>
  )
}
