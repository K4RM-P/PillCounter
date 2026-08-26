import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api'
import { setToken } from '../auth'
import Disclaimer from '../components/Disclaimer'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { token } = await login(username, password)
      setToken(token)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Login failed')
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
            className="input"
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
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

function PillLogoIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" transform="rotate(45)">
      <rect x="2" y="8" width="20" height="8" rx="4" fill="#fff" />
      <path d="M12 8h6a4 4 0 0 1 0 8h-6z" fill="#8b8b96" />
      <line x1="12" y1="8" x2="12" y2="16" stroke="#0b0b0d" strokeWidth="0.75" />
    </svg>
  )
}
