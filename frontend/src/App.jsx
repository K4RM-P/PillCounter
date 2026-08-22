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

  return (
    <>
      <nav className="navbar">
        <Link to="/" className="brand">PillCount</Link>
        <Link to="/" className={`navlink${location.pathname === '/' ? ' active' : ''}`}>Count Pills</Link>
        <Link to="/history" className={`navlink${location.pathname.startsWith('/history') ? ' active' : ''}`}>History</Link>
        {pending > 0 && <span className="badge badge-warn">{pending} pending upload{pending === 1 ? '' : 's'}</span>}
        <button className="btn btn-icon" onClick={handleToggleTheme} title="Toggle dark mode" aria-label="Toggle dark mode">
          {dark ? '☀️' : '🌙'}
        </button>
        {isAuthenticated() && (
          <button className="btn" onClick={handleLogout}>
            Log out
          </button>
        )}
      </nav>

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

      <footer className="page no-print" style={{ paddingTop: 0, borderTop: '1px solid var(--border)' }}>
        <Disclaimer />
      </footer>
    </>
  )
}

export default App
