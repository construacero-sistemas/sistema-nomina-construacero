import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../compat/components/ui/Toast.jsx'
import { ErrorBoundary } from '../compat/components/ui/ErrorBoundary.jsx'
import OfflineBanner from '../compat/components/ui/OfflineBanner.jsx'
import queryClient from '../compat/lib/queryClient.js'
import { indexedDbPersister } from '../compat/lib/queryPersister.js'
import { showToast } from '../compat/components/ui/toastBus.js'
import AvisoActualizacion from '../compat/components/ui/AvisoActualizacion.jsx'
import { iniciarActualizaciones, marcarIntentoRecuperacion, puedeIntentarRecuperacion } from '../compat/lib/actualizacionApp.js'
import NominaApp from './NominaApp.jsx'
// Inter auto-hospedada (400–700): se empaqueta con la app, funciona offline en
// el PWA y no depende de CDNs de fuentes. Sin esto, Inter solo estaba declarada
// y el navegador caía a system-ui (Segoe UI en Windows).
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '../compat/index.css'
import './modo-accesible.css'

// Modo accesible: se restaura antes del primer render para evitar parpadeo.
if (typeof localStorage !== 'undefined' && localStorage.getItem('modo-accesible') === '1') {
  document.documentElement.classList.add('modo-accesible')
}

// Versión nueva: se avisa y se aplica en un momento seguro (sin diálogos
// abiertos, campos en edición ni operaciones enviándose). Ver actualizacionApp.js.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    iniciarActualizaciones({ mutando: () => queryClient.isMutating() }).catch(() => undefined)
  }, { once: true })
}

// El zoom voluntario sigue disponible. La prevención de autozoom se hace con
// inputs táctiles de 16px, no cancelando gestos de accesibilidad.
// No hidratar el caché global anterior antes de resolver la identidad.
indexedDbPersister.removeClient().catch(() => undefined)

// Auto-recovery en app: si un chunk dinámico falla (hash viejo tras deploy),
// destruir caches/SW y recargar. Comparte con auto-recovery.js el registro del
// último intento: como máximo uno cada 2 minutos, para no recargar sin fin.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  if (!puedeIntentarRecuperacion()) {
    showToast.error('No se pudo cargar esta parte del sistema. Recarga la página.', 8000)
    return
  }
  marcarIntentoRecuperacion()
  ;(async () => {
    try {
      const ks = await caches.keys()
      await Promise.all(ks.map(k => caches.delete(k)))
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(r => r.unregister()))
      }
    } catch { /* degradar a reload simple */ }
    window.location.reload()
  })()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <OfflineBanner>
              <NominaApp />
            </OfflineBanner>
            <AvisoActualizacion />
            {import.meta.env.MODE === 'staging' && (
              <div className="staging-watermark" role="status" aria-label="Entorno de pruebas staging">
                STAGING
              </div>
            )}
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
