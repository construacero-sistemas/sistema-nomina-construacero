import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../compat/components/ui/Toast.jsx'
import { ErrorBoundary } from '../compat/components/ui/ErrorBoundary.jsx'
import OfflineBanner from '../compat/components/ui/OfflineBanner.jsx'
import queryClient from '../compat/lib/queryClient.js'
import { indexedDbPersister } from '../compat/lib/queryPersister.js'
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

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => {
    const activateNewSw = () => {
      if (registration.waiting) {
        // Enviar SKIP_WAITING al SW para que llame self.skipWaiting() y
        // luego self.clients.claim() en su evento activate. Esto fuerza
        // que todas las pestañas pasen a la nueva versión inmediatamente,
        // evitando errores de MIME type por hashes de assets obsoletos.
        registration.waiting.postMessage({ type: 'SKIP_WAITING' })
      }
    }
    const notify = () => {
      if (registration.waiting) {
        window.dispatchEvent(new Event('app-update-ready'))
        // Auto-activar sin esperar interacción del usuario
        activateNewSw()
      }
    }
    notify()
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', (e) => {
        if (e.target.state === 'installed') notify()
      })
    })
    // Si otra pestaña ya activó un nuevo SW, recargar para obtener los assets correctos
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true
        window.location.reload()
      }
    })
  }).catch(() => undefined), { once: true })
}

// El zoom voluntario sigue disponible. La prevención de autozoom se hace con
// inputs táctiles de 16px, no cancelando gestos de accesibilidad.
// No hidratar el caché global anterior antes de resolver la identidad.
indexedDbPersister.removeClient().catch(() => undefined)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <OfflineBanner>
              <NominaApp />
            </OfflineBanner>
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
