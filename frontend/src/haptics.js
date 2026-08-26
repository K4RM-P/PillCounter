// Best-effort tactile feedback — silently does nothing on devices/browsers
// without the Vibration API (iOS Safari, most desktops) rather than erroring.
export function vibrate(pattern = 10) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern)
  }
}
