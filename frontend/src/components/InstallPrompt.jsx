import { useEffect, useState } from 'react'
import { vibrate } from '../haptics'

const DISMISS_KEY = 'pillcount_install_prompt_dismissed'

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

function isSafari() {
  const ua = window.navigator.userAgent
  return /safari/i.test(ua) && !/crios|fxios|edgios|chrome|android/i.test(ua)
}

// Installing to the home screen is the only way to get persistent camera
// permission on iOS (see CameraCapture) — Safari re-prompts every launch of
// a standalone PWA, but a plain Safari tab remembers the grant like any
// other site. iOS exposes no API to trigger the install itself, so this can
// only show instructions; Android/desktop Chrome gets a real one-tap button
// via the native beforeinstallprompt event.
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showIosSteps, setShowIosSteps] = useState(false)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  useEffect(() => {
    function handler(e) {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (dismissed || isStandalone()) return null
  const canShowIosBanner = isIos() && isSafari()
  if (!deferredPrompt && !canShowIosBanner) return null

  function dismiss() {
    vibrate(8)
    setDismissed(true)
    localStorage.setItem(DISMISS_KEY, '1')
  }

  async function handleInstallClick() {
    vibrate(8)
    if (deferredPrompt) {
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
      setDeferredPrompt(null)
      dismiss()
      return
    }
    setShowIosSteps(true)
  }

  return (
    <div className="badge badge-warn badge-warn-icon no-print" style={{ alignSelf: 'stretch', justifyContent: 'space-between' }}>
      {showIosSteps ? (
        <span>
          Tap the Share icon <ShareIcon /> below, then "Add to Home Screen" — this also fixes the camera asking
          for permission every time.
        </span>
      ) : (
        <span>Add PillCount to your home screen for a full-screen app and one-time camera permission.</span>
      )}
      <div className="row" style={{ gap: 6 }}>
        {!showIosSteps && (
          <button type="button" className="btn btn-icon" onClick={handleInstallClick}>
            Add to Home Screen
          </button>
        )}
        <button type="button" className="btn btn-icon" onClick={dismiss} aria-label="Dismiss">
          Dismiss
        </button>
      </div>
    </div>
  )
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
      <path d="M12 2v13" />
      <path d="M8 6l4-4 4 4" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    </svg>
  )
}
