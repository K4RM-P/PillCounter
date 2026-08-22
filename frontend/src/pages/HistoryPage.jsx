import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCounts, mediaUrl } from '../api'

export default function HistoryPage() {
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [minCount, setMinCount] = useState('')
  const [maxCount, setMaxCount] = useState('')
  const [days, setDays] = useState('all')

  useEffect(() => {
    fetchCounts()
      .then(setCounts)
      .catch((err) => setError(err.message || 'Failed to load history'))
  }, [])

  const filtered = useMemo(() => {
    if (!counts) return []
    const now = Date.now()
    return counts.filter((c) => {
      if (query && !(c.label || '').toLowerCase().includes(query.toLowerCase())) return false
      if (minCount && c.count < Number(minCount)) return false
      if (maxCount && c.count > Number(maxCount)) return false
      if (days !== 'all') {
        const ageMs = now - new Date(c.created_at).getTime()
        if (ageMs > Number(days) * 24 * 60 * 60 * 1000) return false
      }
      return true
    })
  }, [counts, query, minCount, maxCount, days])

  const stats = useMemo(() => {
    if (!counts || counts.length === 0) return null
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const thisWeek = counts.filter((c) => new Date(c.created_at).getTime() >= weekAgo)
    const avg = counts.reduce((sum, c) => sum + c.count, 0) / counts.length
    return {
      total: counts.length,
      thisWeek: thisWeek.length,
      avg: Math.round(avg),
    }
  }, [counts])

  if (error) return <div className="page"><p className="error-text">{error}</p></div>
  if (counts === null) return <div className="page"><p className="hint">Loading...</p></div>

  return (
    <div className="page">
      <h2>History</h2>

      {stats && (
        <div className="stats-row">
          <div className="stat-tile">
            <div className="value">{stats.total}</div>
            <div className="label">Total counts</div>
          </div>
          <div className="stat-tile">
            <div className="value">{stats.thisWeek}</div>
            <div className="label">This week</div>
          </div>
          <div className="stat-tile">
            <div className="value">{stats.avg}</div>
            <div className="label">Avg. pills / count</div>
          </div>
        </div>
      )}

      {counts.length > 0 && (
        <div className="card stack">
          <input
            className="input"
            type="text"
            placeholder="Search by label..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="row">
            <input
              className="input"
              type="number"
              placeholder="Min count"
              value={minCount}
              onChange={(e) => setMinCount(e.target.value)}
              style={{ width: 110 }}
            />
            <input
              className="input"
              type="number"
              placeholder="Max count"
              value={maxCount}
              onChange={(e) => setMaxCount(e.target.value)}
              style={{ width: 110 }}
            />
            <select className="select" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="all">All time</option>
              <option value="1">Last 24h</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>
          </div>
        </div>
      )}

      {counts.length === 0 && <p className="hint">No saved counts yet. Go count some pills!</p>}
      {counts.length > 0 && filtered.length === 0 && <p className="hint">No counts match your filters.</p>}

      <div className="stack">
        {filtered.map((c) => (
          <Link key={c.id} to={`/history/${c.id}`} className="card card-link">
            <img src={mediaUrl(c.image_id)} alt="" width={60} height={60} style={{ objectFit: 'cover', borderRadius: 8 }} />
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-h)' }}>{c.count} pills</div>
              <div>{c.label || 'Untitled'}</div>
              <div className="hint" style={{ fontSize: '0.85rem' }}>
                {new Date(c.created_at).toLocaleString()}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
