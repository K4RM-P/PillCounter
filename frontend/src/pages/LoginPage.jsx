import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api'
import { setToken } from '../auth'
import Disclaimer from '../components/Disclaimer'
import { vibrate } from '../haptics'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const usernameRef = useRef(null)

  async function handleSubmit(e) {
    e.preventDefault()
    vibrate(8)
    setLoading(true)
    setError(null)
    try {
      const { token } = await login(username, password)
      vibrate([10, 40, 10])
      setToken(token)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Login failed')
      usernameRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page" style={{ justifyContent: 'center', alignItems: 'center', gap: 32 }}>
      <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div className="login-logo">
            <PillLogoIcon />
          </div>
          <div>
            <h1 style={{ fontSize: 26, margin: 0, textAlign: 'center' }}>PillCount</h1>
            <p className="hint" style={{ textAlign: 'center', marginTop: 4 }}>Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="stack" style={{ width: '100%' }}>
          <input
            ref={usernameRef}
            className="input"
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            autoFocus
          />
          <div className="password-field">
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading && <span className="spinner-sm" />}
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>

      <div style={{ maxWidth: 320, width: '100%' }}>
        <Disclaimer />
      </div>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.5 21.5 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.5 21.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function PillLogoIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" transform="rotate(45)">
      <rect x="2" y="8" width="20" height="8" rx="4" fill="#fff" />
      <path d="M12 8h6a4 4 0 0 1 0 8h-6z" fill="#8b8b96" />
      <line x1="12" y1="8" x2="12" y2="16" stroke="#0b0b0d" strokeWidth="0.75" />
    </svg>
  )
}
