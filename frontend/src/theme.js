const THEME_KEY = 'pillcount_theme'

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'system'
}

export function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', theme)
  }
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme)
  applyTheme(theme)
}

export function toggleTheme() {
  const current = getTheme()
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const currentlyDark = current === 'dark' || (current === 'system' && prefersDark)
  const next = currentlyDark ? 'light' : 'dark'
  setTheme(next)
  return next
}
