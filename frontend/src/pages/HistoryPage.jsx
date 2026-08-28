import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCounts, mediaUrl } from '../api'
import { formatRelativeTime } from '../relativeTime'
import { vibrate } from '../haptics'

const DAY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '1', label: '24h' },
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
]

const DAYS_FILTER_KEY = 'pillcount_history_days'

export default function HistoryPage() {
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [minCount, setMinCount] = useState('')
  const [maxCount, setMaxCount] = useState('')
  const [days, setDays] = useState(() => localStorage.getItem(DAYS_FILTER_KEY) || 'all')
  const [lastFetched, setLastFetched] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  function selectDays(value) {
    vibrate(8)
    setDays(value)
    localStorage.setItem(DAYS_FILTER_KEY, value)
  }

  const hasActiveFilters = query || minCount || maxCount || days !== 'all'

  function clearFilters() {
    setQuery('')
    setMinCount('')
    setMaxCount('')
    selectDays('all')
  }

  function load({ silent } = {}) {
    if (silent) setRefreshing(true)
    return fetchCounts()
      .then((data) => {
        setCounts(data)
        setLastFetched(Date.now())
        setError(null)
      })
      .catch((err) => setError(err.message || 'Failed to load history'))
      .finally(() => setRefreshing(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (counts === null) {
    return (
      <div className="page">
        <h2>History</h2>
        <div className="stats-row">
          <div className="skeleton" style={{ height: 66, flex: 1 }} />
          <div className="skeleton" style={{ height: 66, flex: 1 }} />
          <div className="skeleton" style={{ height: 66, flex: 1 }} />
        </div>
        <div className="stack">
          <div className="skeleton" style={{ height: 80 }} />
          <div className="skeleton" style={{ height: 80 }} />
          <div className="skeleton" style={{ height: 80 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ marginBottom: 0 }}>History</h2>
          {lastFetched && <p className="hint" style={{ fontSize: 12 }}>Updated {formatRelativeTime(new Date(lastFetched).toISOString())}</p>}
        </div>
        <button
          className="btn btn-icon"
          onClick={() => {
            vibrate(8)
            load({ silent: true })
          }}
          disabled={refreshing}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshIcon spinning={refreshing} />
        </button>
      </div>

      {stats && (
        <div className="stats-row">
          <div className="stat-tile">
            <span className="stat-tile-icon"><StackIcon /></span>
            <div className="value">{stats.total}</div>
            <div className="label">Total counts</div>
          </div>
          <div
            className="stat-tile"
            role="button"
            tabIndex={0}
            onClick={() => selectDays('7')}
            onKeyDown={(e) => e.key === 'Enter' && selectDays('7')}
            style={{ cursor: 'pointer' }}
            title="Show only this week"
          >
            <span className="stat-tile-icon"><CalendarIcon /></span>
            <div className="value">{stats.thisWeek}</div>
            <div className="label">This week</div>
          </div>
          <div className="stat-tile">
            <span className="stat-tile-icon"><AvgIcon /></span>
            <div className="value">{stats.avg}</div>
            <div className="label">Avg. pills / count</div>
          </div>
        </div>
      )}

      {counts.length > 0 && (
        <div className="card stack">
          <div className="search-field">
            <input
              className="input"
              type="text"
              placeholder="Search by label..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <ClearIcon />
              </button>
            )}
          </div>
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
          </div>
          <div className="segmented">
            {DAY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={days === opt.value ? 'active' : ''}
                onClick={() => selectDays(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <button type="button" className="btn" style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: '4px 0' }} onClick={clearFilters}>
              Clear all filters
            </button>
          )}
        </div>
      )}

      {counts.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">
            <HistoryEmptyIcon />
          </div>
          <div className="empty-title">No counts yet</div>
          <p className="hint">Your saved pill counts will show up here.</p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 12 }}>
            Count your first pills
          </Link>
        </div>
      )}
      {counts.length > 0 && filtered.length === 0 && <p className="hint">No counts match your filters.</p>}

      {filtered.length > 0 && <p className="section-label">Recent counts</p>}
      <div className="stack">
        {filtered.map((c, i) => (
          <Link key={c.id} to={`/history/${c.id}`} className="history-card" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
            <img className="thumb" src={mediaUrl(c.image_id)} alt="" />
            <div className="meta">
              <div className="title-row">
                <span className="label">{c.label || 'Untitled'}</span>
              </div>
              <div className="hint" style={{ fontSize: 13 }}>{formatRelativeTime(c.created_at)}</div>
            </div>
            <span className="count-chip">{c.count}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function StackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}

function AvgIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-4 4" />
    </svg>
  )
}

function HistoryEmptyIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" />
      <path d="M3.05 13a9 9 0 1 0 .5-4.5L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: spinning ? 'spin 0.7s linear infinite' : 'none' }}
    >
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}
