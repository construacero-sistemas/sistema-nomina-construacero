import supabase, { createRequestScope } from './supabase/client'
import { apiUrl } from './apiBase'
import useAuthStore from '../store/useAuthStore'
import { CODIGO_OPERADOR_INVALIDO } from '../api/lib/utils.js'

const DEFAULT_TIMEOUT = 15000
let refreshPromise = null

function assertSession(original) {
  const current = useAuthStore.getState()
  if (current.sessionGeneration !== original.sessionGeneration || current.user?.id !== original.user?.id) {
    throw new DOMException('La sesión cambió durante la solicitud', 'AbortError')
  }
}

// Un 403 SOLO cierra la sesión cuando el servidor lo marca como
// `OPERADOR_INVALIDO` (operador inactivo o rol revocado, emitidos por
// `validateOperator`). Cualquier otro 403 es un error de ACCIÓN — capacidad
// insuficiente, permiso de administración, cuenta sin tenant, RPC financiera
// (PT403)… — y se entrega a la interfaz con la sesión intacta. Antes bastaba
// cualquier 403 sin marca para barrer la sesión («No pudimos abrir tu cuenta»
// al desactivar un usuario); eso no debe volver a pasar.
async function esSesionInvalida(response) {
  try {
    const payload = await response.clone().json()
    return payload?.code === CODIGO_OPERADOR_INVALIDO
  } catch {
    // Sin JSON legible no se asume revocación: un error en la interfaz es
    // preferible a un falso cierre de sesión.
    return false
  }
}

// Propaga cancelación y conserva el body de la operación en el único retry401.
// Nunca reintenta una escritura ante timeout: su estado podría estar comprometido.
export async function authFetch(path, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, signal, ...fetchOpts } = options
  const original = useAuthStore.getState()
  const method = (fetchOpts.method || 'GET').toUpperCase()
  if (typeof navigator !== 'undefined' && !navigator.onLine && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    throw Object.assign(new Error('Conéctate a internet antes de registrar cambios.'), { code: 'OFFLINE_WRITE_DISABLED' })
  }
  const scope = createRequestScope({ signals: [signal, original.sessionSignal], timeout })
  try {
    const { data } = await scope.wait(supabase.auth.getSession())
    assertSession(original)
    if (!data?.session?.access_token) throw Object.assign(new Error('Inicia sesión nuevamente.'), { status: 401 })
    if (!original.user?.id || data.session.user?.id !== original.user.id) throw new DOMException('La identidad de la sesión cambió', 'AbortError')
    const send = async token => {
      scope.signal.throwIfAborted()
      assertSession(original)
      const headers = new Headers(fetchOpts.headers)
      headers.set('Authorization', `Bearer ${token}`)
      if (original.perfil?.id) headers.set('X-Operator-Id', original.perfil.id)
      const response = await scope.wait(fetch(apiUrl(path), { ...fetchOpts, headers, signal: scope.signal, cache: 'no-store' }))
      // Consume el body dentro del timeout. La generación vuelve a comprobarse
      // antes de entregar la respuesta al queryFn; un fetch tardío no cruza cuenta.
      const buffer = await scope.wait(response.arrayBuffer())
      assertSession(original)
      return new Response(buffer.byteLength ? buffer : null, { status: response.status, statusText: response.statusText, headers: response.headers })
    }
    let response = await send(data.session.access_token)
    if (response.status === 401) {
      if (!refreshPromise || refreshPromise.generation !== original.sessionGeneration || refreshPromise.account !== original.accountId) {
        const record = { generation: original.sessionGeneration, account: original.accountId }
        record.promise = supabase.auth.refreshSession().finally(() => { if (refreshPromise === record) refreshPromise = null })
        refreshPromise = record
      }
      const refreshed = await scope.wait(refreshPromise.promise)
      assertSession(original)
      const token = refreshed.data?.session?.access_token
      if (!token) throw Object.assign(new Error('La sesión terminó. Inicia sesión nuevamente.'), { status: 401 })
      if (refreshed.data.session.user?.id !== original.user.id) throw new DOMException('La sesión cambió durante la renovación', 'AbortError')
      response = await send(token)
    }
    if ([401, 403].includes(response.status)) {
      // Invalidación de rol; no restaurar el perfil administrativo cacheado.
      if (response.status === 401) original.expireSession?.('La sesión terminó. Inicia sesión nuevamente.')
      else if (await esSesionInvalida(response)) original.denyAccess?.('Tu cuenta no tiene autorización para esta operación.')
    }
    return response
  } catch (error) {
    if (error?.status === 401) { assertSession(original); original.expireSession?.(error.message) }
    if (scope.signal.aborted && scope.signal.reason?.name === 'TimeoutError') {
      throw Object.assign(new Error(method === 'GET' ? 'La lectura tardó demasiado. Reintenta.' : 'No se pudo confirmar el resultado. Conserva esta operación y comprueba su estado antes de repetirla.'), {
        code: method === 'GET' ? 'REQUEST_TIMEOUT' : 'OPERATION_RESULT_UNKNOWN',
      })
    }
    throw error
  } finally {
    scope.dispose()
  }
}
