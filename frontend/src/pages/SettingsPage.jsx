import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearToken } from '../auth'
import { vibrate } from '../haptics'

const MODEL_VERSION_KEY = 'pillcount_model_version'

const MODELS = [
  { key: 'v2', label: 'Model v2' },
  { key: 'v3', label: 'Model v3' },
  { key: 'ensemble', label: 'Ensemble' },
]

export default function SettingsPage() {
  const [modelVersion, setModelVersion] = useState(
    () => localStorage.getItem(MODEL_VERSION_KEY) || 'v2',
  )
  const navigate = useNavigate()

  function selectModelVersion(version) {
    vibrate(8)
    setModelVersion(version)
    localStorage.setItem(MODEL_VERSION_KEY, version)
  }

  function handleLogout() {
    if (!window.confirm('Log out of PillCount?')) return
    clearToken()
    navigate('/login')
  }

  return (
    <div className="page">
      <h2>Settings</h2>

      <div className="section-card stack">
        <div className="settings-row">
          <span className="settings-row-icon">
            <ModelIcon />
          </span>
          <span className="settings-row-label">Detection Model</span>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Model version" style={{ alignSelf: 'stretch' }}>
          {MODELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={modelVersion === key}
              className={modelVersion === key ? 'active' : ''}
              onClick={() => selectModelVersion(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {modelVersion === 'ensemble' && (
          <p className="hint">
            Runs both models and combines what either found — slower, but a pill only one model catches still gets
            counted, flagged for a quick look instead of silently missed.
          </p>
        )}
      </div>

      <div className="section-card stack">
        <div className="settings-row">
          <span className="settings-row-icon">
            <AccountIcon />
          </span>
          <span className="settings-row-label">Account</span>
        </div>
        <button type="button" className="btn" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </div>
  )
}

function ModelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function AccountIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
