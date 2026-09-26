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
import '../compat/index.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => {
    const notify = () => { if (registration.waiting) window.dispatchEvent(new Event('app-update-ready')) }
    notify()
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', notify))
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
