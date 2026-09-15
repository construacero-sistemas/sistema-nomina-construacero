// Shared Supabase client and cancellation scope for authenticated requests.
import { createClient } from '@supabase/supabase-js'

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

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: fetchWithTimeout },
})

export default supabase
