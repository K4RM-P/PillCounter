const QUEUE_KEY = 'pillcount_pending_uploads'

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch {
    return []
  }
}

function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Failed to read photo for offline queue'))
    reader.readAsDataURL(blob)
  })
}

function dataUrlToBlob(dataUrl) {
  return fetch(dataUrl).then((res) => res.blob())
}

export function getQueue() {
  return readQueue()
}

export function queueLength() {
  return readQueue().length
}

export async function enqueuePhoto(blob, label) {
  const dataUrl = await blobToDataUrl(blob)
  const queue = readQueue()
  queue.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, dataUrl, label: label || '', queuedAt: new Date().toISOString() })
  writeQueue(queue)
}

export function removeFromQueue(id) {
  writeQueue(readQueue().filter((item) => item.id !== id))
}

// Attempts to upload+save every queued photo. uploadAndSave(blob, label) should
// throw on failure (e.g. still offline) so the item stays queued.
export async function flushQueue(uploadAndSave) {
  const queue = readQueue()
  let flushed = 0
  for (const item of queue) {
    try {
      const blob = await dataUrlToBlob(item.dataUrl)
      await uploadAndSave(blob, item.label)
      removeFromQueue(item.id)
      flushed += 1
    } catch {
      break
    }
  }
  return flushed
}

export function isNetworkError(err) {
  return err instanceof TypeError
}
