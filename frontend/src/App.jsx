import { useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import CapturePage from './pages/CapturePage'
import ResultPage from './pages/ResultPage'
import HistoryPage from './pages/HistoryPage'
import HistoryDetailPage from './pages/HistoryDetailPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import RequireAuth from './components/RequireAuth'
import ToastHost from './components/ToastHost'
import NetworkBanner from './components/NetworkBanner'
import InstallPrompt from './components/InstallPrompt'
import { isAuthenticated } from './auth'
import { applyTheme, getTheme, toggleTheme } from './theme'
import { flushQueue, queueLength } from './offlineQueue'
import { saveCount, uploadForCount, warmBackend } from './api'
import { isUploading, subscribeUploading } from './uploadState'
import { showToast } from './toast'
import { vibrate } from './haptics'

function App() {
  const location = useLocation()
  const [pending, setPending] = useState(queueLength())
  const [uploading, setUploadingState] = useState(isUploading())
  const [dark, setDark] = useState(() => {
    const t = getTheme()
    return t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  })

  useEffect(() => {
    applyTheme(getTheme())
  }, [])

  useEffect(() => warmBackend(), [])

  useEffect(() => subscribeUploading(setUploadingState), [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  async function tryFlush({ silent } = {}) {
    const flushed = await flushQueue(async (blob, label) => {
      const result = await uploadForCount(blob)
      await saveCount({ imageId: result.image_id, label, detections: result.detections })
    })
    if (flushed > 0) {
      setPending(queueLength())
      showToast(`Uploaded ${flushed} queued photo${flushed === 1 ? '' : 's'}`)
    } else if (!silent) {
      showToast('Still offline — will retry automatically', { variant: 'warn' })
    }
  }

  useEffect(() => {
    const handler = () => tryFlush({ silent: true })
    window.addEventListener('online', handler)
    handler()
    return () => window.removeEventListener('online', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleRetryPending() {
    vibrate(8)
    tryFlush()
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
            {pending > 0 && (
              <button
                type="button"
                className="badge badge-warn pending-badge"
                onClick={handleRetryPending}
                title="Tap to retry uploading now"
              >
                {pending} pending
              </button>
            )}
            <button className="btn btn-icon" onClick={handleToggleTheme} title="Toggle dark mode" aria-label="Toggle dark mode">
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            <Link className="btn btn-icon" to="/settings" title="Settings" aria-label="Settings">
              <SettingsIcon />
            </Link>
          </div>
        </div>
      )}

      {showChrome && <NetworkBanner />}
      {showChrome && <InstallPrompt />}

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
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <SettingsPage />
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
          <Link
            to="/history"
            className={`navlink${location.pathname.startsWith('/history') ? ' active' : ''}`}
            onClick={(e) => {
              if (uploading) {
                e.preventDefault()
                showToast("Wait for the current photo to finish counting first", { variant: 'warn' })
              }
            }}
            style={uploading ? { opacity: 0.4 } : undefined}
            aria-disabled={uploading}
            title={uploading ? 'Wait for the current count to finish' : undefined}
          >
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

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
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
