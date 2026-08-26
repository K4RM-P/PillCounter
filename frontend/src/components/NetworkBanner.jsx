import { useEffect, useState } from 'react'

export default function NetworkBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  useEffect(() => {
    function goOnline() {
      setOnline(true)
    }
    function goOffline() {
      setOnline(false)
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null

  return (
    <div className="network-banner no-print">
      <span className="network-banner-dot" />
      You&apos;re offline — photos will be saved on this device and uploaded once you're back online.
    </div>
  )
}
