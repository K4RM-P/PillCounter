import { useEffect, useState } from 'react'
import { getDeferredPrompt, isIos, isSafari, subscribeInstallPrompt } from '../pwa'
import { vibrate } from '../haptics'

// Shown instead of the real app whenever PillCount is opened in a normal
// browser tab (e.g. from a Google search result) rather than launched from
// an installed home-screen icon. Counting/history/etc. never render here —
// only this screen and a path to installing.
export default function InstallGatePage() {
  const [prompt, setPrompt] = useState(getDeferredPrompt())
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => subscribeInstallPrompt(setPrompt), [])

  async function handleInstall() {
    vibrate(8)
    if (prompt) {
      prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') setPrompt(null)
      return
    }
    setShowHelp(true)
  }

  const iosHelp = isIos() && isSafari()

  return (
    <div className="page" style={{ justifyContent: 'center', alignItems: 'center', gap: 32 }}>
      <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <div className="login-logo">
          <img src="/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 10 }} />
        </div>
        <div>
          <h1 style={{ fontSize: 26, margin: 0, textAlign: 'center' }}>PillCount</h1>
          <p className="hint" style={{ textAlign: 'center', marginTop: 4 }}>
            Install PillCount on your home screen to start counting.
          </p>
        </div>

        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleInstall}>
          Download App
        </button>

        {showHelp && (
          <p className="hint" style={{ textAlign: 'center' }}>
            {iosHelp
              ? 'Tap the Share icon, then "Add to Home Screen."'
              : 'Open your browser menu and tap "Add to Home screen" or "Install app."'}
          </p>
        )}
      </div>
    </div>
  )
}
