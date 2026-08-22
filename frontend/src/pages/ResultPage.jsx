import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { mediaUrl, saveCount, uploadForCount } from '../api'
import { downscaleImage } from '../downscale'
import MarkerOverlay from '../components/MarkerOverlay'
import CameraCapture from '../components/CameraCapture'

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
  const skipVerifyDims = useRef(null)

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
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ marginBottom: 0 }}>Count: {markers.length}</h2>
        <div className="row">
          <button className="btn btn-icon" onClick={undo} disabled={historyIndex === 0} title="Undo (Cmd/Ctrl+Z)">↺</button>
          <button className="btn btn-icon" onClick={redo} disabled={historyIndex === history.length - 1} title="Redo (Cmd/Ctrl+Shift+Z)">↻</button>
        </div>
      </div>
      <p className="hint">Tap empty space to add a marker. Tap a marker to remove it.</p>
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

      <div className="stack" style={{ maxWidth: 360 }}>
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

        <div className="row">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
            {saving ? 'Saving...' : 'Save Count'}
          </button>
          <button className="btn" onClick={handleRetake} disabled={saving}>
            Retake
          </button>
        </div>

        <button className="btn" onClick={() => setVerifying((v) => !v)}>
          {verifying ? 'Cancel verification' : 'Verify with another photo'}
        </button>
      </div>

      {verifying && (
        <div style={{ maxWidth: 360 }}>
          <CameraCapture onCapture={handleVerifyPhoto} onUnavailable={() => setError('Camera unavailable for verification photo.')} />
        </div>
      )}
    </div>
  )
}
