// Bounds only pathologically large source photos (e.g. desktop screenshots,
// DSLR exports) — phone camera photos (~3000-6000px, higher-end Android
// sensors included) pass through close to native resolution. The pill
// counter's tiled inference needs that detail: dropping to 1600px
// measurably loses small/overlapping pills in dense trays (verified: a
// 13-pill tray photo counted 13/13 at native res vs 11/13 once downscaled
// to 1600px).
//
// Matched to the backend's MAX_IMAGE_DIMENSION (see render.yaml): the
// server resizes anything larger down to that before inference, so pixels
// above this bound are decoded, re-encoded and uploaded only to be thrown
// away — on cellular that inflates the upload several-fold and was a real
// contributor to requests appearing to "not reach the server". Keep this
// in sync if the backend's cap is raised.
const MAX_DIMENSION = 3000

function isHeic(file) {
  const type = (file.type || '').toLowerCase()
  const name = (file.name || '').toLowerCase()
  return type.includes('heic') || type.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif')
}

export async function downscaleImage(file) {
  if (!isHeic(file)) return downscaleToJpeg(file)

  // Safari/WebKit can decode HEIC natively via <img>/canvas — it's Apple's
  // own format — including HDR gain-map and Live Photo variants that
  // heic2any's JS-based decoder chokes on. Try that first; it's also faster
  // since it skips a full JS decode. Fall back to heic2any for browsers
  // without native HEIC support (Chrome/Firefox/Android).
  try {
    return await downscaleToJpeg(file)
  } catch {
    // fall through to heic2any
  }

  try {
    const heic2any = (await import('heic2any')).default
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
    const source = Array.isArray(converted) ? converted[0] : converted
    return await downscaleToJpeg(source)
  } catch {
    throw new Error(
      'This photo\'s format (HDR or Live Photo HEIC) isn\'t supported. Try taking the photo with the in-app camera instead, or re-export it as JPEG (Photos app → Share → Options → uncheck "Live" / choose JPEG) before uploading.'
    )
  }
}

function downscaleToJpeg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      let { width, height } = img
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl)
          if (blob) resolve(blob)
          else reject(new Error('Failed to downscale image'))
        },
        'image/jpeg',
        0.92
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to load image'))
    }

    img.src = objectUrl
  })
}
