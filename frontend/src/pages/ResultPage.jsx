import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchCounts, mediaUrl, saveCount, uploadForCount } from '../api'
import { downscaleImage } from '../downscale'
import MarkerOverlay from '../components/MarkerOverlay'
import CameraCapture from '../components/CameraCapture'
import { showToast } from '../toast'
import { vibrate } from '../haptics'

export default function ResultPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { imageId, markers: initialMarkers, modelVersion, qualityWarnings } = location.state || {}

  const [history, setHistory] = useState([initialMarkers || []])
  const [historyIndex, setHistoryIndex] = useState(0)
  const markers = history[historyIndex]

  const [label, setLabel] = useState('')
  const [priorLabels, setPriorLabels] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyCount, setVerifyCount] = useState(null)
  const verifyRef = useRef(null)

  const draftLabelKey = imageId ? `pillcount_draft_label_${imageId}` : null

  useEffect(() => {
    if (verifying) verifyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [verifying])

  async function handleShare() {
    const text = `Counted ${markers.length} pill${markers.length === 1 ? '' : 's'}${label ? ` (${label})` : ''} with PillCount.`
    if (navigator.share) {
      try {
        await navigator.share({ text })
      } catch {
        // user cancelled the share sheet — nothing to do
      }
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      showToast('Copied count to clipboard')
    } catch {
      showToast('Could not share', { variant: 'warn' })
    }
  }

  useEffect(() => {
    fetchCounts()
      .then((counts) => {
        const labels = [...new Set(counts.map((c) => c.label).filter(Boolean))]
        setPriorLabels(labels)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!draftLabelKey) return
    const draft = sessionStorage.getItem(draftLabelKey)
    if (draft) setLabel(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLabelKey])

  function handleLabelChange(value) {
    setLabel(value)
    if (draftLabelKey) sessionStorage.setItem(draftLabelKey, value)
  }

  // Warns on a hard page close/refresh (browser back within the SPA is
  // handled separately by handleRetake's confirm) so an accidental tab
  // close doesn't silently lose an unsaved, already-marked count.
  useEffect(() => {
    function onBeforeUnload(e) {
      if (markers.length === 0 || saved) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [markers.length, saved])

  function pushMarkers(next) {
    setHistory((prev) => [...prev.slice(0, historyIndex + 1), next])
    setHistoryIndex((i) => i + 1)
  }

  function undo() {
    vibrate(8)
    setHistoryIndex((i) => Math.max(0, i - 1))
  }

  function redo() {
    vibrate(8)
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

  useEffect(() => {
    if (!verifying) return
    function onKeyDown(e) {
      if (e.key === 'Escape') setVerifying(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [verifying])

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
    const removed = markers[index]
    pushMarkers(markers.filter((_, i) => i !== index))
    if (removed && typeof removed.confidence === 'number') {
      showToast(`Removed marker (${Math.round(removed.confidence * 100)}% confidence)`)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await saveCount({ imageId, label, detections: markers })
      vibrate([10, 40, 10])
      showToast(`Saved — ${markers.length} pills`)
      setSaved(true)
      if (draftLabelKey) sessionStorage.removeItem(draftLabelKey)
      setTimeout(() => navigate('/history'), 550)
    } catch (err) {
      setError(err.message || 'Save failed')
      setSaving(false)
    }
  }

  function handleRetake() {
    if (markers.length > 0 && !window.confirm('Discard this count and start over?')) return
    vibrate(8)
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
  const disagreementCount = markers.filter((m) => m.agreement === false).length

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="print-header">
        <span className="brand">PillCount</span>
        <span className="meta">{new Date().toLocaleString()}</span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="hero-count">
          <span className="value">{markers.length}</span>
          <span className="unit">pill{markers.length === 1 ? '' : 's'}</span>
          {modelVersion && <span className="badge">Model {modelVersion}</span>}
        </div>
        <div className="row no-print">
          <button className="btn btn-icon" onClick={handleShare} title="Share count" aria-label="Share count">
            <ShareIcon />
          </button>
          <button className="btn btn-icon" onClick={undo} disabled={historyIndex === 0} title="Undo (Cmd/Ctrl+Z)" aria-label="Undo">
            <UndoIcon />
          </button>
          <button className="btn btn-icon" onClick={redo} disabled={historyIndex === history.length - 1} title="Redo (Cmd/Ctrl+Shift+Z)" aria-label="Redo">
            <RedoIcon />
          </button>
        </div>
      </div>
      <p className="hint no-print">Tap empty space to add a marker, tap a marker to remove it, double-tap the photo to zoom in.</p>

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
        <p className="badge badge-warn badge-warn-icon" style={{ alignSelf: 'flex-start' }}>
          <WarnIcon />
          {flaggedCount} low-confidence detection{flaggedCount === 1 ? '' : 's'} flagged — worth a second look.
        </p>
      )}

      {disagreementCount > 0 && (
        <p className="badge badge-warn badge-warn-icon" style={{ alignSelf: 'flex-start' }}>
          <WarnIcon />
          {disagreementCount} pill{disagreementCount === 1 ? '' : 's'} only found by one of the two models —
          still counted, worth a second look.
        </p>
      )}

      {qualityWarnings?.map((w) => (
        <p key={w} className="badge badge-warn badge-warn-icon" style={{ alignSelf: 'flex-start' }}>
          <WarnIcon />
          {w}
        </p>
      ))}

      <MarkerOverlay
        imageUrl={mediaUrl(imageId)}
        markers={markers}
        onAddMarker={addMarker}
        onRemoveMarker={removeMarker}
        editable
      />

      <div className="section-card no-print">
        <input
          className="input"
          type="text"
          list="prior-labels"
          placeholder="Label (optional, e.g. drug name)"
          value={label}
          onChange={(e) => handleLabelChange(e.target.value)}
        />
        <datalist id="prior-labels">
          {priorLabels.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>

        {verifyCount !== null && (
          <p className={disagreement > 0.1 ? 'badge badge-warn' : 'badge'} style={{ alignSelf: 'flex-start' }}>
            Verification photo counted {verifyCount} — {disagreement > 0.1 ? 'differs from current count, double-check' : 'matches closely'}
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

        <button className="btn icon-label-btn" onClick={() => setVerifying((v) => !v)}>
          <VerifyIcon />
          {verifying ? 'Cancel verification (Esc)' : 'Verify with another photo'}
        </button>
      </div>

      {verifying && (
        <div ref={verifyRef}>
          <CameraCapture onCapture={handleVerifyPhoto} onUnavailable={() => setError('Camera unavailable for verification photo.')} />
        </div>
      )}

      <div className="sticky-action-bar no-print">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || verifying} style={{ flex: 1 }}>
          {saved ? <CheckIcon /> : saving ? 'Saving...' : 'Save Count'}
        </button>
        <button className="btn icon-label-btn" onClick={handleRetake} disabled={saving}>
          <RetakeIcon />
          Retake
        </button>
      </div>

      {saved && (
        <div className="save-success-overlay no-print">
          <div className="save-success-badge">
            <CheckIcon size={28} />
          </div>
        </div>
      )}
    </div>
  )
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
    </svg>
  )
}

function CheckIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
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

function UndoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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
