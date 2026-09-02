import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { ToastProvider } from '../compat/components/ui/Toast.jsx'
import { ErrorBoundary } from '../compat/components/ui/ErrorBoundary.jsx'
import OfflineBanner from '../compat/components/ui/OfflineBanner.jsx'
import queryClient from '../compat/lib/queryClient.js'
import { indexedDbPersister, CACHE_BUSTER } from '../compat/lib/queryPersister.js'
import NominaApp from './NominaApp.jsx'
import '../compat/index.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined), { once: true })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: indexedDbPersister,
          maxAge: 1000 * 60 * 60 * 24,
          buster: `nomina-construacero-${CACHE_BUSTER}`,
          dehydrateOptions: { shouldDehydrateQuery: query => query.state.status === 'success' },
        }}>
        <BrowserRouter>
          <ToastProvider>
            <OfflineBanner>
              <NominaApp />
            </OfflineBanner>
          </ToastProvider>
        </BrowserRouter>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
