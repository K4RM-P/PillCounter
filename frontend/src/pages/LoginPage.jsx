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
    <div className="page" style={{ maxWidth: 340, margin: '0 auto', paddingTop: 64 }}>
      <h1 style={{ fontSize: 32, margin: '0 0 8px' }}>PillCount</h1>
      <form onSubmit={handleSubmit} className="stack">
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

      <div style={{ marginTop: '2rem' }}>
        <Disclaimer />
      </div>
    </div>
  )
}
