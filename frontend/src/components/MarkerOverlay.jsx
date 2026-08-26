import { useRef } from 'react'

// Renders an image with editable pill markers overlaid.
// markers are stored in normalized (0-1) image coordinates so they stay
// correctly positioned regardless of the rendered image size.
export default function MarkerOverlay({ imageUrl, markers, onAddMarker, onRemoveMarker, editable }) {
  const imgRef = useRef(null)

  function handleImageClick(e) {
    if (!editable || !onAddMarker) return
    const rect = imgRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    onAddMarker({ x, y, confidence: 1.0 })
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Pill count"
        onClick={handleImageClick}
        style={{ display: 'block', maxWidth: '100%', maxHeight: '46vh', width: 'auto', borderRadius: 16, cursor: editable ? 'crosshair' : 'default' }}
      />
      {markers.map((marker, index) => (
        <div
          key={index}
          onClick={(e) => {
            if (!editable) return
            e.stopPropagation()
            onRemoveMarker(index)
          }}
          title={editable ? markerTitle(marker) : undefined}
          style={{
            position: 'absolute',
            left: `${marker.x * 100}%`,
            top: `${marker.y * 100}%`,
            width: 12,
            height: 12,
            marginLeft: -6,
            marginTop: -6,
            borderRadius: '50%',
            background: markerColor(marker.confidence),
            border: '1.5px solid white',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
            cursor: editable ? 'pointer' : 'default',
          }}
        />
      ))}
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
