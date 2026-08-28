import { useRef, useState } from 'react'
import { vibrate } from '../haptics'

// Fixed, small marker size — proportional sizing (based on detected pill
// size) was tried and made circles too large in practice on dense photos,
// so every marker gets the same small dot regardless of pill size. The tap
// target is a bit larger than the visible dot for reliable removal without
// the dot itself visually overlapping neighboring pills.
const DOT_PX = 10
const HIT_TARGET_PX = 22

// Renders an image with editable pill markers overlaid.
// markers are stored in normalized (0-1) image coordinates so they stay
// correctly positioned regardless of the rendered image size.
const DBLCLICK_WINDOW_MS = 250

export default function MarkerOverlay({ imageUrl, markers, onAddMarker, onRemoveMarker, editable }) {
  const imgRef = useRef(null)
  const [zoomed, setZoomed] = useState(false)
  const pendingClickRef = useRef(null)

  // A double-click to zoom fires as click, click, dblclick — without this
  // delay, both plain clicks would already have added markers by the time
  // dblclick toggles zoom, planting two phantom markers every time someone
  // zooms in. Holding the first click briefly lets a following click (or
  // dblclick) cancel it instead of committing a marker.
  function handleImageClick(e) {
    if (!editable || !onAddMarker) return
    if (pendingClickRef.current) {
      clearTimeout(pendingClickRef.current)
      pendingClickRef.current = null
      return
    }
    const rect = imgRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    pendingClickRef.current = setTimeout(() => {
      pendingClickRef.current = null
      onAddMarker({ x, y, confidence: 1.0 })
      vibrate(8)
    }, DBLCLICK_WINDOW_MS)
  }

  function handleDoubleClick(e) {
    e.stopPropagation()
    if (pendingClickRef.current) {
      clearTimeout(pendingClickRef.current)
      pendingClickRef.current = null
    }
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
      {markers.map((marker, index) => (
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
            width: HIT_TARGET_PX,
            height: HIT_TARGET_PX,
            marginLeft: -HIT_TARGET_PX / 2,
            marginTop: -HIT_TARGET_PX / 2,
            cursor: editable ? 'pointer' : 'default',
          }}
        >
          <span
            className="marker-dot"
            style={{ width: DOT_PX, height: DOT_PX, background: markerColor(marker.confidence) }}
          />
        </div>
      ))}
    </div>
  )
}

// Manually added markers (confidence 1.0) are always the "confident" color.
// Two states only: confident (the app's own accent) or flagged for review —
// a third, unrelated hue for "borderline" fragmented the app's color
// language without adding a decision the user could act on differently.
function markerColor(confidence) {
  const c = confidence ?? 1
  return c >= 0.75 ? 'var(--accent2)' : 'rgba(229, 72, 77, 0.9)'
}

function markerTitle(marker) {
  const c = marker.confidence ?? 1
  if (c >= 0.75) return 'Tap to remove'
  return `Flagged, low confidence (${Math.round(c * 100)}%) — tap to remove`
}
