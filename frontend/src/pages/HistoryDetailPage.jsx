import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchCount, mediaUrl } from '../api'
import MarkerOverlay from '../components/MarkerOverlay'

export default function HistoryDetailPage() {
  const { id } = useParams()
  const [record, setRecord] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchCount(id)
      .then(setRecord)
      .catch((err) => setError(err.message || 'Failed to load count'))
  }, [id])

  if (error) return <div className="page"><p className="error-text">{error}</p></div>

  if (!record) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 28, width: 160 }} />
        <div className="skeleton detail-skeleton-image" />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="print-header">
        <span className="brand">PillCount</span>
        <span className="meta">{new Date().toLocaleString()}</span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 10 }}>
          <Link to="/history" className="btn btn-icon no-print" aria-label="Back to history">
            <BackIcon />
          </Link>
          <div>
            <h2 style={{ marginBottom: 0 }}>{record.label || 'Untitled'}</h2>
            <p className="hint">
              {record.count} pills — {new Date(record.created_at).toLocaleString()}
            </p>
          </div>
        </div>
        <button className="btn btn-icon no-print" onClick={() => window.print()} aria-label="Print or save as PDF" title="Print / Save as PDF">
          <PrintIcon />
        </button>
      </div>
      <MarkerOverlay imageUrl={mediaUrl(record.image_id)} markers={record.detections} editable={false} />
    </div>
  )
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function PrintIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}
