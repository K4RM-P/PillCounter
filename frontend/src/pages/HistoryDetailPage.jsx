import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
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
  if (!record) return <div className="page"><p className="hint">Loading...</p></div>

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>{record.label || 'Untitled'}</h2>
          <p className="hint">
            {record.count} pills — {new Date(record.created_at).toLocaleString()}
          </p>
        </div>
        <button className="btn no-print" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <MarkerOverlay imageUrl={mediaUrl(record.image_id)} markers={record.detections} editable={false} />
    </div>
  )
}
