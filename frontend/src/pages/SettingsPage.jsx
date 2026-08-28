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
    clearToken()
    navigate('/login')
  }

  return (
    <div className="page">
      <h2>Settings</h2>

      <div className="section-card stack">
        <div className="section-label">Detection Model</div>
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
        <div className="section-label">Account</div>
        <button type="button" className="btn" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </div>
  )
}
