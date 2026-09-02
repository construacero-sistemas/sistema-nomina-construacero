// Estado de conectividad para el modo offline-first.
// No interrumpe la interfaz con banners: las vistas muestran sus propios estados
// de carga/error cuando una operación realmente lo necesita.
import { createContext, useState, useEffect } from 'react'

const OfflineCtx = createContext(false)

export default function OfflineBanner({ children }) {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine)

  useEffect(() => {
    const onOnline = () => setOffline(false)
    const onOffline = () => setOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return <OfflineCtx.Provider value={offline}>{children}</OfflineCtx.Provider>
}
