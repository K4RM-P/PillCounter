import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadForCount } from '../api'
import { downscaleImage } from '../downscale'
import { enqueuePhoto, isNetworkError } from '../offlineQueue'
import CameraCapture from '../components/CameraCapture'

export default function CapturePage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [queued, setQueued] = useState(false)
  const [cameraUnavailable, setCameraUnavailable] = useState(false)
  const navigate = useNavigate()

  async function handleFile(file) {
    if (!file) return
    setLoading(true)
    setError(null)
    setQueued(false)
    try {
      const blob = await downscaleImage(file)
      const dims = await getImageDimensions(blob)
      let result
      try {
        result = await uploadForCount(blob)
      } catch (err) {
        if (isNetworkError(err)) {
          await enqueuePhoto(blob, '')
          setQueued(true)
          return
        }
        throw err
      }

      const markers = result.detections.map((d) => ({
        x: d.x / dims.width,
        y: d.y / dims.height,
        confidence: d.confidence,
      }))

      navigate('/result', {
        state: { imageId: result.image_id, markers },
      })
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
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

      {error && <p className="error-text">{error}</p>}
      {queued && (
        <p className="badge badge-warn" style={{ alignSelf: 'flex-start' }}>
          Offline — photo saved on this device, will upload automatically when back online.
        </p>
      )}

      {loading && (
        <div className="camera-frame" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.8)' }}>Processing photo...</p>
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

function getImageDimensions(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.width, height: img.height })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to read image dimensions'))
    }
    img.src = url
  })
}
