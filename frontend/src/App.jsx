import { useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import CapturePage from './pages/CapturePage'
import ResultPage from './pages/ResultPage'
import HistoryPage from './pages/HistoryPage'
import HistoryDetailPage from './pages/HistoryDetailPage'
import LoginPage from './pages/LoginPage'
import RequireAuth from './components/RequireAuth'
import Disclaimer from './components/Disclaimer'
import { clearToken, isAuthenticated } from './auth'
import { applyTheme, getTheme, toggleTheme } from './theme'
import { flushQueue, queueLength } from './offlineQueue'
import { saveCount, uploadForCount } from './api'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [pending, setPending] = useState(queueLength())
  const [dark, setDark] = useState(() => {
    const t = getTheme()
    return t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  })

  useEffect(() => {
    applyTheme(getTheme())
  }, [])

  useEffect(() => {
    async function tryFlush() {
      const flushed = await flushQueue(async (blob, label) => {
        const result = await uploadForCount(blob)
        await saveCount({ imageId: result.image_id, label, detections: result.detections })
      })
      if (flushed > 0) setPending(queueLength())
    }
    window.addEventListener('online', tryFlush)
    tryFlush()
    return () => window.removeEventListener('online', tryFlush)
  }, [])

  function handleLogout() {
    clearToken()
    navigate('/login')
  }

  function handleToggleTheme() {
    setDark(toggleTheme() === 'dark')
  }

  const showChrome = isAuthenticated() && location.pathname !== '/login'

  return (
    <>
      {showChrome && (
        <div className="app-header no-print">
          <div>
            <div className="greeting-eyebrow">Welcome to</div>
            <div className="greeting-title">PillCount</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {pending > 0 && <span className="badge badge-warn">{pending} pending</span>}
            <button className="btn btn-icon" onClick={handleToggleTheme} title="Toggle dark mode" aria-label="Toggle dark mode">
              {dark ? '☀️' : '🌙'}
            </button>
            <button className="avatar-btn" onClick={handleLogout} title="Log out" aria-label="Log out">
              ⏻
            </button>
          </div>
        </div>
      )}

      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <CapturePage />
            </RequireAuth>
          }
        />
        <Route
          path="/result"
          element={
            <RequireAuth>
              <ResultPage />
            </RequireAuth>
          }
        />
        <Route
          path="/history"
          element={
            <RequireAuth>
              <HistoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/history/:id"
          element={
            <RequireAuth>
              <HistoryDetailPage />
            </RequireAuth>
          }
        />
      </Routes>

      {showChrome && (
        <nav className="bottom-nav no-print">
          <Link to="/" className={`navlink${location.pathname === '/' ? ' active' : ''}`}>
            <span className="icon">📷</span>
            Count
          </Link>
          <Link to="/history" className={`navlink${location.pathname.startsWith('/history') ? ' active' : ''}`} style={{ position: 'relative' }}>
            <span className="icon">🗂️</span>
            History
            {pending > 0 && <span className="badge-dot" />}
          </Link>
        </nav>
      )}

      <footer className="page no-print" style={{ paddingTop: 0, borderTop: '1px solid var(--border)' }}>
        <Disclaimer />
      </footer>
    </>
  )
}

export default App
