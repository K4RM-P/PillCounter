import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadForCount } from '../api'
import { downscaleImage } from '../downscale'
import { enqueuePhoto, isNetworkError } from '../offlineQueue'
import CameraCapture from '../components/CameraCapture'
import { showToast } from '../toast'

// Remembered across visits so an A/B comparison session doesn't reset the
// toggle on every photo.
const MODEL_VERSION_KEY = 'pillcount_model_version'

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
  const [modelVersion, setModelVersion] = useState(
    () => localStorage.getItem(MODEL_VERSION_KEY) || 'v2',
  )
  const navigate = useNavigate()

  function selectModelVersion(version) {
    setModelVersion(version)
    localStorage.setItem(MODEL_VERSION_KEY, version)
  }

  async function handleFile(file) {
    if (!file) return
    setLoading(true)
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
    }
  }

  function handleCameraCapture(blob) {
    const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' })
    handleFile(file)
  }

  return (
    <div className="page">
      <div>
        <h2>Count Pills</h2>
        <p className="hint">Spread pills out on a flat, contrasting surface so they don't overlap.</p>
      </div>

      <div className="row" style={{ gap: 6, alignSelf: 'flex-start', flexWrap: 'wrap' }} role="radiogroup" aria-label="Model version">
        {[
          { key: 'v2', label: 'Model v2' },
          { key: 'v3', label: 'Model v3' },
          { key: 'ensemble', label: 'Ensemble (v2+v3)' },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={modelVersion === key}
            className="btn btn-icon"
            onClick={() => selectModelVersion(key)}
            style={
              modelVersion === key
                ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-contrast)' }
                : undefined
            }
          >
            {label}
          </button>
        ))}
      </div>
      {modelVersion === 'ensemble' && (
        <p className="hint">
          Runs both models and combines what either found — slower, but a pill only one model catches still gets
          counted, flagged for a quick look instead of silently missed.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}

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
