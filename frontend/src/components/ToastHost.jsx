import { useEffect, useState } from 'react'
import { subscribeToast } from '../toast'

export default function ToastHost() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    return subscribeToast((toast) => {
      setToasts((prev) => [...prev, toast])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id))
      }, 2600)
    })
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="toast-stack no-print">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.variant === 'warn' ? ' toast-warn' : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
