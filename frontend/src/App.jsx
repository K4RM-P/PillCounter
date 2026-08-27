import { useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import CapturePage from './pages/CapturePage'
import ResultPage from './pages/ResultPage'
import HistoryPage from './pages/HistoryPage'
import HistoryDetailPage from './pages/HistoryDetailPage'
import LoginPage from './pages/LoginPage'
import RequireAuth from './components/RequireAuth'
import ToastHost from './components/ToastHost'
import NetworkBanner from './components/NetworkBanner'
import { clearToken, isAuthenticated } from './auth'
import { applyTheme, getTheme, toggleTheme } from './theme'
import { flushQueue, queueLength } from './offlineQueue'
import { saveCount, uploadForCount, warmBackend } from './api'

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

  useEffect(() => warmBackend(), [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

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
          <div className="greeting-title">PillCount</div>
          <div className="row" style={{ gap: 6 }}>
            {pending > 0 && <span className="badge badge-warn">{pending} pending</span>}
            <button className="btn btn-icon" onClick={handleToggleTheme} title="Toggle dark mode" aria-label="Toggle dark mode">
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            <button className="btn btn-icon" onClick={handleLogout} title="Log out" aria-label="Log out">
              <LogoutIcon />
            </button>
          </div>
        </div>
      )}

      {showChrome && <NetworkBanner />}

      <div className="route-fade" key={location.pathname}>
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
      </div>

      <ToastHost />

      {showChrome && (
        <nav className="bottom-nav no-print">
          <Link to="/" className={`navlink${location.pathname === '/' ? ' active' : ''}`}>
            <CameraIcon />
            <span>Count</span>
          </Link>
          <Link to="/history" className={`navlink${location.pathname.startsWith('/history') ? ' active' : ''}`}>
            <span className="navlink-icon-wrap">
              <HistoryIcon />
              {pending > 0 && <span className="badge-dot" />}
            </span>
            <span>History</span>
          </Link>
        </nav>
      )}
    </>
  )
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.4 14.7A8.5 8.5 0 1 1 9.3 3.6a7 7 0 0 0 11.1 11.1Z" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg className="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg className="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" />
      <path d="M3.05 13a9 9 0 1 0 .5-4.5L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  )
}

export default App
