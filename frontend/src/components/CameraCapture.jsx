import { useEffect, useRef, useState } from 'react'

// Live in-browser camera preview with a shutter button. Falls back to the
// caller rendering a plain file input when getUserMedia isn't available or
// permission is denied.
export default function CameraCapture({ onCapture, onUnavailable }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function start() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        onUnavailable?.()
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // Request the highest resolution the device's camera offers — the
          // pill counter's accuracy depends heavily on native resolution for
          // dense/overlapping pills, so we don't want to pre-limit this the
          // way the old 1600px cap did. The browser clamps to whatever the
          // hardware actually supports.
          video: { facingMode: 'environment', width: { ideal: 4096 }, height: { ideal: 4096 } },
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
    setFlash(true)
    setTimeout(() => setFlash(false), 350)
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
    <div className="camera-frame">
      <video ref={videoRef} playsInline muted className="camera-video" />
      {!ready && <div className="camera-loading">Starting camera...</div>}
      {flash && <div className="shutter-flash" />}
      <button
        className="shutter-btn"
        onClick={handleShutter}
        disabled={!ready}
        aria-label="Take photo"
      >
        <span className="shutter-btn-ring" />
      </button>
    </div>
  )
}
