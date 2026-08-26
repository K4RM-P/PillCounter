import { clearToken, getToken } from './auth'

// Falls back to the page's own hostname (not a hardcoded "localhost") so the
// app also works when opened from a phone over LAN at the dev machine's IP —
// "localhost" from the phone's perspective would otherwise mean the phone itself.
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8000`

export function mediaUrl(imageId) {
  return `${API_BASE_URL}/media/${imageId}.jpg`
}

function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Requests otherwise hang indefinitely (well past any spinner feeling
// "stuck") if the host is unreachable — a phone on a different network
// than the backend, a firewalled IP, etc. — since the browser's own
// connection timeout is 60-120s. Cut that down to something a person
// will actually wait out, with an error message that says what happened.
// Kept above Render's free-tier cold-start time (~20-50s after idle) so a
// sleeping backend gets a chance to wake up instead of aborting on it.
const REQUEST_TIMEOUT_MS = 60000

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch {
    throw new Error(
      `Couldn't reach the server at ${API_BASE_URL} — check your connection, or the server may still be waking up (try again in a moment).`,
    )
  } finally {
    clearTimeout(timer)
  }
}

async function apiFetch(path, options = {}) {
  const res = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  })
  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Session expired, please log in again')
  }
  return res
}

export async function checkHealth() {
  const res = await fetchWithTimeout(`${API_BASE_URL}/health`)
  return res.json()
}

export async function login(username, password) {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error('Invalid username or password')
  return res.json()
}

export async function uploadForCount(blob, modelVersion) {
  const formData = new FormData()
  formData.append('file', blob, 'capture.jpg')
  if (modelVersion) formData.append('model_version', modelVersion)
  const res = await apiFetch('/api/count', { method: 'POST', body: formData })
  if (!res.ok) throw new Error('Count request failed')
  return res.json()
}

export async function saveCount({ imageId, label, detections }) {
  const res = await apiFetch('/api/counts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId, label: label || null, detections }),
  })
  if (!res.ok) throw new Error('Save failed')
  return res.json()
}

export async function fetchCounts() {
  const res = await apiFetch('/api/counts')
  if (!res.ok) throw new Error('Failed to load history')
  return res.json()
}

export async function fetchCount(id) {
  const res = await apiFetch(`/api/counts/${id}`)
  if (!res.ok) throw new Error('Failed to load count')
  return res.json()
}
