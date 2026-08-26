let listeners = []

export function showToast(message, opts = {}) {
  const toast = { id: Date.now() + Math.random(), message, ...opts }
  listeners.forEach((fn) => fn(toast))
}

export function subscribeToast(fn) {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}
