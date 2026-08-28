// Shared helpers for detecting install state, plus a module-level capture
// of the browser's `beforeinstallprompt` event — it can fire before React
// mounts, and can only be used once, in response to a later user gesture.
let deferredPrompt = null
let listeners = []

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e
  listeners.forEach((fn) => fn(deferredPrompt))
})

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
})

export function getDeferredPrompt() {
  return deferredPrompt
}

export function subscribeInstallPrompt(fn) {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}

// True when running as an installed PWA (launched from the home screen
// icon) rather than a normal browser tab.
export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

export function isSafari() {
  const ua = window.navigator.userAgent
  return /safari/i.test(ua) && !/crios|fxios|edgios|chrome|android/i.test(ua)
}
