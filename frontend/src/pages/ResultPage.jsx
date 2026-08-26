import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { mediaUrl, saveCount, uploadForCount } from '../api'
import { downscaleImage } from '../downscale'
import MarkerOverlay from '../components/MarkerOverlay'
import CameraCapture from '../components/CameraCapture'
import { showToast } from '../toast'

export default function ResultPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { imageId, markers: initialMarkers } = location.state || {}

  const [history, setHistory] = useState([initialMarkers || []])
  const [historyIndex, setHistoryIndex] = useState(0)
  const markers = history[historyIndex]

  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyCount, setVerifyCount] = useState(null)

  function pushMarkers(next) {
    setHistory((prev) => [...prev.slice(0, historyIndex + 1), next])
    setHistoryIndex((i) => i + 1)
  }

  function undo() {
    setHistoryIndex((i) => Math.max(0, i - 1))
  }

  function redo() {
    setHistoryIndex((i) => Math.min(history.length - 1, i + 1))
  }

  useEffect(() => {
    function onKeyDown(e) {
      const meta = e.metaKey || e.ctrlKey
      if (!meta || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [history.length])

  if (!imageId) {
    return (
      <div className="page">
        <p>No photo to show. Start a new count.</p>
        <button className="btn btn-primary" onClick={() => navigate('/')} style={{ alignSelf: 'flex-start' }}>
          New Count
        </button>
      </div>
    )
  }

  function addMarker(marker) {
    pushMarkers([...markers, marker])
  }

  function removeMarker(index) {
    pushMarkers(markers.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await saveCount({ imageId, label, detections: markers })
      showToast(`Saved — ${markers.length} pills`)
      navigate('/history')
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleRetake() {
    navigate('/')
  }

  async function handleVerifyPhoto(blob) {
    setVerifying(false)
    setError(null)
    try {
      const file = new File([blob], 'verify.jpg', { type: 'image/jpeg' })
      const downscaled = await downscaleImage(file)
      const result = await uploadForCount(downscaled)
      setVerifyCount(result.detections.length)
    } catch (err) {
      setError(err.message || 'Verification photo failed')
    }
  }

  const disagreement =
    verifyCount !== null && markers.length > 0
      ? Math.abs(verifyCount - markers.length) / markers.length
      : 0
  const flaggedCount = markers.filter((m) => (m.confidence ?? 1) < 0.75).length

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ marginBottom: 0 }}>Count: {markers.length}</h2>
        <div className="row">
          <button className="btn btn-icon" onClick={undo} disabled={historyIndex === 0} title="Undo (Cmd/Ctrl+Z)">↺</button>
          <button className="btn btn-icon" onClick={redo} disabled={historyIndex === history.length - 1} title="Redo (Cmd/Ctrl+Shift+Z)">↻</button>
        </div>
      </div>
      <p className="hint">Tap empty space to add a marker. Tap a marker to remove it.</p>

      <div className="legend-row">
        <span className="legend-item">
          <span className="legend-dot" style={{ background: 'rgba(170, 59, 255, 0.75)' }} />
          Confident
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: 'rgba(245, 158, 11, 0.85)' }} />
          Borderline
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: 'rgba(229, 72, 77, 0.85)' }} />
          Flagged
        </span>
      </div>

      {flaggedCount > 0 && (
        <p className="badge badge-warn" style={{ alignSelf: 'flex-start' }}>
          {flaggedCount} low-confidence detection{flaggedCount === 1 ? '' : 's'} flagged — worth a second look.
        </p>
      )}

      <MarkerOverlay
        imageUrl={mediaUrl(imageId)}
        markers={markers}
        onAddMarker={addMarker}
        onRemoveMarker={removeMarker}
        editable
      />

      <div className="stack">
        <input
          className="input"
          type="text"
          placeholder="Label (optional, e.g. drug name)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />

        {verifyCount !== null && (
          <p className={disagreement > 0.1 ? 'badge badge-warn' : 'badge'} style={{ alignSelf: 'flex-start' }}>
            Verification photo counted {verifyCount} — {disagreement > 0.1 ? 'differs from current count, double-check' : 'matches closely'}
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

        <button className="btn icon-label-btn" onClick={() => setVerifying((v) => !v)}>
          <VerifyIcon />
          {verifying ? 'Cancel verification' : 'Verify with another photo'}
        </button>
      </div>

      {verifying && (
        <CameraCapture onCapture={handleVerifyPhoto} onUnavailable={() => setError('Camera unavailable for verification photo.')} />
      )}

      <div className="sticky-action-bar no-print">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
          {saving ? 'Saving...' : 'Save Count'}
        </button>
        <button className="btn icon-label-btn" onClick={handleRetake} disabled={saving}>
          <RetakeIcon />
          Retake
        </button>
      </div>
    </div>
  )
}

function RetakeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function VerifyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}
