import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { uploadForCount } from '../api'
import { downscaleImage } from '../downscale'
import { enqueuePhoto, isNetworkError } from '../offlineQueue'
import CameraCapture from '../components/CameraCapture'
import { showToast } from '../toast'
import { setUploading } from '../uploadState'

// Remembered across visits so an A/B comparison session doesn't reset the
// toggle on every photo. Written by the Settings page.
const MODEL_VERSION_KEY = 'pillcount_model_version'

const MODEL_LABELS = { v2: 'Model v2', v3: 'Model v3', ensemble: 'Ensemble' }

const PROCESSING_STAGES = [
  { afterMs: 0, text: 'Preparing photo...' },
  { afterMs: 1500, text: 'Uploading photo...' },
  { afterMs: 6000, text: 'Counting pills...' },
  { afterMs: 20000, text: 'Still working — larger or denser photos take longer...' },
]

export default function CapturePage() {
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState(PROCESSING_STAGES[0].text)
  const [error, setError] = useState(null)
  const [cameraUnavailable, setCameraUnavailable] = useState(false)
  const [modelVersion] = useState(
    () => localStorage.getItem(MODEL_VERSION_KEY) || 'v2',
  )
  const navigate = useNavigate()
  const lastFileRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    lastFileRef.current = file
    setLoading(true)
    setUploading(true)
    setError(null)
    setStage(PROCESSING_STAGES[0].text)
    const timers = PROCESSING_STAGES.slice(1).map((s) => setTimeout(() => setStage(s.text), s.afterMs))
    try {
      const blob = await downscaleImage(file)
      setStage(PROCESSING_STAGES[1].text)
      let result
      try {
        result = await uploadForCount(blob, modelVersion)
      } catch (err) {
        if (isNetworkError(err)) {
          await enqueuePhoto(blob, '')
          showToast('Offline — photo saved, will upload automatically', { variant: 'warn' })
          return
        }
        throw err
      }

      // Normalize against the width/height the server actually computed
      // detections against (from decoding the exact uploaded bytes) rather
      // than a separate client-side re-measurement of the same blob — two
      // measurements of "the same" image that could drift apart (browser
      // decode quirks, EXIF handling differences) is exactly the kind of
      // mismatch that silently misaligns every marker.
      const markers = result.detections.map((d) => ({
        x: d.x / result.width,
        y: d.y / result.height,
        confidence: d.confidence,
        size: d.size ?? undefined,
        agreement: d.agreement ?? undefined,
      }))

      navigate('/result', {
        state: { imageId: result.image_id, markers, modelVersion, qualityWarnings: result.warnings },
      })
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      timers.forEach(clearTimeout)
      setLoading(false)
      setUploading(false)
    }
  }

  function handleCameraCapture(blob) {
    const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' })
    handleFile(file)
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <p className="hint capture-hint-line">
          <strong style={{ color: 'var(--text-h)' }}>Count Pills</strong> — spread them out so they don't overlap.
        </p>
        <Link to="/settings" className="model-status-link">
          {MODEL_LABELS[modelVersion]} · Change
        </Link>
      </div>

      {error && (
        <div className="alert-error">
          <AlertIcon />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0 }}>{error}</p>
            <div className="alert-error-actions">
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => handleFile(lastFileRef.current)}
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="camera-frame" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="processing-indicator">
            <span className="spinner" />
            <p style={{ color: 'rgba(255,255,255,0.85)' }}>{stage}</p>
          </div>
        </div>
      )}

      {!loading && !cameraUnavailable && (
        <CameraCapture onCapture={handleCameraCapture} onUnavailable={() => setCameraUnavailable(true)} />
      )}

      {!loading && cameraUnavailable && (
        <div className="card stack">
          <label className="btn btn-primary">
            Take Photo
            <input
              type="file"
              accept="image/*,.heic,.heif"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files[0])}
            />
          </label>
        </div>
      )}

      {!loading && (
        <label className="btn" style={{ alignSelf: 'center', background: 'transparent', border: 'none' }}>
          Upload from library instead
          <input
            type="file"
            accept="image/*,.heic,.heif"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </label>
      )}
    </div>
  )
}

function AlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
