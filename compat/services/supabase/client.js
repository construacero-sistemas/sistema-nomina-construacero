// Shared Supabase client and cancellation scope for authenticated requests.
import { AuthClient } from '@supabase/auth-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan variables de entorno: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. ' +
    'Copia .env.example a .env y configura las credenciales.'
  )
}

export function createRequestScope({ signals = [], timeout = 30000 } = {}) {
  const controller = new AbortController()
  const listeners = []
  for (const signal of signals.filter(Boolean)) {
    const abort = () => controller.abort(signal.reason ?? new DOMException('Request cancelled', 'AbortError'))
    if (signal.aborted) abort()
    else {
      signal.addEventListener('abort', abort, { once: true })
      listeners.push(() => signal.removeEventListener('abort', abort))
    }
  }
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout)
  return {
    signal: controller.signal,
    // Auth SDK calls do not accept AbortSignal. Ignore their results after cancellation.
    wait(promise) {
      return new Promise((resolve, reject) => {
        const abort = () => reject(controller.signal.reason)
        if (controller.signal.aborted) abort()
        else controller.signal.addEventListener('abort', abort, { once: true })
        Promise.resolve(promise).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort))
      })
    },
    dispose() {
      clearTimeout(timer)
      listeners.forEach(remove => remove())
    },
  }
}

export async function fetchWithTimeout(url, options = {}) {
  const method = (options.method ?? url?.method ?? 'GET').toUpperCase()
  if (typeof navigator !== 'undefined' && !navigator.onLine && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new Error('Reconnect before making changes')
  }
  const scope = createRequestScope({ signals: [options.signal, url?.signal] })
  try {
    scope.signal.throwIfAborted()
    return await scope.wait(fetch(url, { ...options, signal: scope.signal }))
  } finally {
    scope.dispose()
  }
}

// El navegador solo usa Supabase para la sesión: todos los datos pasan por
// /api/*. Por eso se carga únicamente el cliente de autenticación (auth-js) y
// no supabase-js completo (base de datos, realtime, storage y functions), que
// pesaba ~200 kB en la carga inicial. Se replican las opciones que aplicaba
// createClient — sobre todo la clave de almacenamiento — para que las
// sesiones guardadas sigan siendo válidas sin volver a iniciar sesión.
const baseUrl = new URL(supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`)

const auth = new AuthClient({
  url: new URL('auth/v1', baseUrl).href,
  headers: { Authorization: `Bearer ${supabaseAnonKey}`, apikey: supabaseAnonKey },
  storageKey: `sb-${baseUrl.hostname.split('.')[0]}-auth-token`,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
  flowType: 'implicit',
  fetch: fetchWithTimeout,
})

const supabase = { auth }

export default supabase
