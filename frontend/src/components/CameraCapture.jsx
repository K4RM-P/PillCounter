import { useEffect, useRef, useState } from 'react'

// Live in-browser camera preview with a shutter button. Falls back to the
// caller rendering a plain file input when getUserMedia isn't available or
// permission is denied.
export default function CameraCapture({ onCapture, onUnavailable }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function start() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        onUnavailable?.()
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1600 }, height: { ideal: 1600 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setReady(true)
      } catch {
        setError('Camera access unavailable or denied.')
        onUnavailable?.()
      }
    }

    start()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [onUnavailable])

  function handleShutter() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (blob) onCapture(blob)
    }, 'image/jpeg', 0.9)
  }

  if (error) return null

  return (
    <div className="stack">
      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', background: '#000' }}>
        <video ref={videoRef} playsInline muted style={{ display: 'block', width: '100%', maxHeight: 420, objectFit: 'cover' }} />
      </div>
      <button className="btn btn-primary" onClick={handleShutter} disabled={!ready} style={{ alignSelf: 'center', width: 72, height: 72, borderRadius: '50%', fontSize: 0 }}>
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#fff' }} />
      </button>
    </div>
  )
}
