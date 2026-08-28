let uploading = false
let listeners = []

export function setUploading(value) {
  uploading = value
  listeners.forEach((fn) => fn(uploading))
}

export function isUploading() {
  return uploading
}

export function subscribeUploading(fn) {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}
