import { useEffect, useRef, useState } from 'react'
import { vibrate } from '../haptics'

// Below this, a circle sized to the true pill would be too small to see or
// tap reliably — floor the visual dot there (the tap target has its own,
// larger floor below).
const MIN_DOT_PX = 8
// Manually-added markers and any detection missing a size fall back to this.
const DEFAULT_DOT_PX = 14
const MIN_HIT_TARGET_PX = 24

// Renders an image with editable pill markers overlaid.
// markers are stored in normalized (0-1) image coordinates so they stay
// correctly positioned regardless of the rendered image size.
export default function MarkerOverlay({ imageUrl, markers, onAddMarker, onRemoveMarker, editable }) {
  const imgRef = useRef(null)
  const [zoomed, setZoomed] = useState(false)
  // Marker `size` is normalized to the *original* image width (see
  // counter.py) so it survives any downscaling/re-encoding — converting it
  // to an on-screen circle diameter needs the image's actual rendered
  // width, which changes with viewport size and the zoom toggle below.
  const [renderedWidth, setRenderedWidth] = useState(0)

  useEffect(() => {
    const el = imgRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setRenderedWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function handleImageClick(e) {
    if (!editable || !onAddMarker) return
    const rect = imgRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    onAddMarker({ x, y, confidence: 1.0 })
    vibrate(8)
  }

  function handleDoubleClick(e) {
    e.stopPropagation()
    setZoomed((z) => !z)
  }

  return (
    <div
      className={`marker-overlay-wrap${zoomed ? ' zoomed' : ''}`}
      style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', overflow: zoomed ? 'auto' : 'visible' }}
    >
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Pill count"
        onClick={handleImageClick}
        onDoubleClick={handleDoubleClick}
        style={{
          display: 'block',
          maxWidth: zoomed ? 'none' : '100%',
          maxHeight: zoomed ? 'none' : '46vh',
          width: zoomed ? '180%' : 'auto',
          borderRadius: 16,
          cursor: editable ? 'crosshair' : 'default',
          transition: 'width 0.2s ease',
        }}
      />
      {markers.map((marker, index) => {
        const dotPx =
          marker.size && renderedWidth
            ? Math.max(MIN_DOT_PX, marker.size * renderedWidth)
            : DEFAULT_DOT_PX
        const hitPx = Math.max(MIN_HIT_TARGET_PX, dotPx)
        return (
          <div
            key={index}
            className="marker-hit-target"
            onClick={(e) => {
              if (!editable) return
              e.stopPropagation()
              onRemoveMarker(index)
              vibrate(8)
            }}
            title={editable ? markerTitle(marker) : undefined}
            style={{
              left: `${marker.x * 100}%`,
              top: `${marker.y * 100}%`,
              width: hitPx,
              height: hitPx,
              marginLeft: -hitPx / 2,
              marginTop: -hitPx / 2,
              cursor: editable ? 'pointer' : 'default',
            }}
          >
            <span
              className="marker-dot"
              style={{ width: dotPx, height: dotPx, background: markerColor(marker.confidence) }}
            />
          </div>
        )
      })}
    </div>
  )
}

// Manually added markers (confidence 1.0) are always the "confident" color.
// Model detections are graded: >=0.75 confident, 0.5-0.75 borderline, <0.5 flagged.
function markerColor(confidence) {
  const c = confidence ?? 1
  if (c >= 0.75) return 'rgba(170, 59, 255, 0.75)'
  if (c >= 0.5) return 'rgba(245, 158, 11, 0.85)'
  return 'rgba(229, 72, 77, 0.85)'
}

function markerTitle(marker) {
  const c = marker.confidence ?? 1
  if (c >= 0.75) return 'Tap to remove'
  if (c >= 0.5) return `Low confidence (${Math.round(c * 100)}%) — tap to remove`
  return `Flagged, low confidence (${Math.round(c * 100)}%) — tap to remove`
}
