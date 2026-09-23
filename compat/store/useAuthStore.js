// La identidad se valida en servidor. Un perfil guardado nunca concede acceso.
import { create } from 'zustand'
import supabase, { createRequestScope } from '../services/supabase/client'
import { apiUrl } from '../services/apiBase'
import queryClient from '../lib/queryClient'
import { createAccountQueryPersister, indexedDbPersister } from '../lib/queryPersister'
import { tieneAccesoOperativo } from '../../server/lib/permissions.js'

const AUTH_DEBUG = import.meta.env.DEV && import.meta.env.VITE_AUTH_DEBUG === 'true'
let sessionController = new AbortController()
let profileSequence = 0
let initializationSequence = 0
let loginSequence = 0
// Local password requests are handled by their owning attempt, not by an
// uncorrelated SDK event that could arrive after logout or an account switch.
const passwordAttempts = new Set()

function clearAccountData(accountId) {
  queryClient.cancelQueries().catch(() => undefined)
  queryClient.clear()
  createAccountQueryPersister(accountId).removeClient().catch(() => undefined)
  try {
    for (const key of Object.keys(localStorage)) {
      if (key === 'listo_perfil_cache' || key === 'listo_operators_cache' ||
          key === `listo_perfil_cache-${accountId}` || key === `listo_operators_cache-${accountId}` ||
          key === `nomina_cuentas_custodia_${accountId}` || key === 'nomina_cuentas_custodia_default') {
        localStorage.removeItem(key)
      }
    }
  } catch { /* La sesión no depende de que el almacenamiento esté disponible. */ }
}

function loginError(message = '') {
  if (/invalid login credentials/i.test(message)) return 'Correo o contraseña incorrectos'
  if (/email not confirmed/i.test(message)) return 'Debes confirmar tu correo antes de entrar'
  if (/rate limit|too many/i.test(message)) return 'Demasiados intentos. Espera unos minutos e intenta de nuevo'
  return 'No se pudo iniciar sesión. Comprueba la conexión e inténtalo nuevamente.'
}

// Token de la sesión actual solo si pertenece a esa cuenta (mismo criterio en
// selección, cambio de operador y arranque de cuenta).
async function tokenDeSesion(authUser) {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id === authUser.id ? data.session.access_token : null
  } catch { return null }
}

const useAuthStore = create((set, get) => ({
  user: null, perfil: null, accountId: null,
  authStatus: 'initializing', initialized: false, loading: false, error: null,
  offline: typeof navigator !== 'undefined' && !navigator.onLine,
  sessionGeneration: 0, sessionSignal: sessionController.signal,
  _cargandoPerfil: false, _initializing: false, _logoutManual: false, _seleccionando: false,
  // F2 — barrera de acceso: si la cuenta tiene varios operadores y aún no se
  // eligió uno con PIN, el servidor responde OPERADOR_REQUERIDO y el store
  // guarda la lista pública para la pantalla de selección.
  seleccionPendiente: false, operadoresDisponibles: [], cuentaSinOperadores: false,

  _changeAccount: (user) => {
    const next = user?.id || null
    if (get().accountId === next && get().user?.id === next) return
    const previous = get().accountId
    loginSequence += 1
    sessionController.abort(new DOMException('La sesión cambió', 'AbortError'))
    sessionController = new AbortController()
    profileSequence += 1
    set({ user, perfil: null, accountId: next, loading: false, sessionGeneration: get().sessionGeneration + 1,
      sessionSignal: sessionController.signal, authStatus: next ? 'loading-profile' : 'anonymous',
      seleccionPendiente: false, operadoresDisponibles: [], cuentaSinOperadores: false })
    clearAccountData(previous)
  },

  expireSession: (message = 'Tu sesión terminó. Inicia sesión nuevamente.') => {
    loginSequence += 1
    get()._changeAccount(null)
    set({ initialized: true, loading: false, _cargandoPerfil: false, _initializing: false, error: message, authStatus: 'anonymous' })
  },

  denyAccess: (message = 'Tu cuenta no tiene autorización para esta operación.') => {
    loginSequence += 1
    profileSequence += 1
    sessionController.abort(new DOMException('Autorización retirada', 'AbortError'))
    sessionController = new AbortController()
    clearAccountData(get().accountId)
    set({ perfil: null, authStatus: 'denied', error: message, _cargandoPerfil: false,
      sessionGeneration: get().sessionGeneration + 1, sessionSignal: sessionController.signal })
  },

  initialize: () => {
    const generation = ++initializationSequence
    let disposed = false
    let eventRevision = 0
    const pending = new Set()
    set({ _initializing: true })
    indexedDbPersister.removeClient().catch(() => undefined)
    const processSession = (session) => {
      if (disposed || generation !== initializationSequence) return
      if (session?.user && [...passwordAttempts].some(attempt => attempt.email === session.user.email?.toLowerCase())) return
      if (!session?.user) {
        get().expireSession(null)
        return
      }
      get()._changeAccount(session.user)
      // Fuera del callback de Supabase: llamar a auth.* dentro de ese callback
      // puede esperar el mismo lock que todavía está ocupado por el emisor.
      void get()._cargarPerfil(session.user, session.access_token)
    }
    const timer = setTimeout(() => {
      if (!disposed && !get().initialized) set({ initialized: true, _initializing: false,
        authStatus: 'error', error: 'No se pudo comprobar la sesión. Reintenta o vuelve a iniciar sesión.' })
    }, 15000)
    const probeRevision = eventRevision, probeSequence = loginSequence
    const probeGeneration = get().sessionGeneration
    const probeCurrent = () => !disposed && generation === initializationSequence && eventRevision === probeRevision
      && loginSequence === probeSequence && get().sessionGeneration === probeGeneration
    supabase.auth.getSession().then(({ data, error }) => {
      if (!probeCurrent()) return
      if (error) throw error
      processSession(data?.session)
    }).catch(() => {
      if (probeCurrent()) set({ initialized: true, _initializing: false, authStatus: 'error', error: 'No se pudo comprobar la sesión.' })
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return
      const revision = ++eventRevision
      if (event === 'SIGNED_OUT') {
        profileSequence += 1
        get().expireSession(get()._logoutManual ? null : 'La sesión terminó. Inicia sesión nuevamente.')
        return
      }
      if (!['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) return
      if (passwordAttempts.size && (!session?.user || [...passwordAttempts].some(attempt => attempt.email === session.user.email?.toLowerCase()))) return
      // Invalida inmediatamente la cuenta anterior antes del trabajo asíncrono.
      if (session?.user && session.user.id !== get().accountId) get()._changeAccount(session.user)
      const id = setTimeout(() => { pending.delete(id); if (revision === eventRevision) processSession(session) }, 0)
      pending.add(id)
    })
    const online = () => {
      set({ offline: false })
      if (get().user) void get().retryProfile()
      else if (!get().initialized) {
        const revision = eventRevision, sequence = loginSequence, sessionGeneration = get().sessionGeneration
        const current = () => !disposed && generation === initializationSequence && revision === eventRevision
          && sequence === loginSequence && sessionGeneration === get().sessionGeneration
        void supabase.auth.getSession().then(({ data, error }) => {
          if (!current()) return
          if (error) throw error
          processSession(data?.session)
        }).catch(() => {
          if (current()) set({ initialized: true, _initializing: false, authStatus: 'error', error: 'No se pudo comprobar la sesión. Reintenta.' })
        })
      }
    }
    const offline = () => set({ offline: true })
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      disposed = true
      clearTimeout(timer)
      for (const id of pending) clearTimeout(id)
      subscription.unsubscribe()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      set({ _initializing: false })
    }
  },

  _cargarPerfil: async (authUser, suppliedToken) => {
    if (!authUser?.id) return false
    if (get().accountId !== authUser.id) return false
    const sequence = ++profileSequence
    const generation = get().sessionGeneration
    const active = () => sequence === profileSequence && generation === get().sessionGeneration && get().accountId === authUser.id
    const request = createRequestScope({ signals: [get().sessionSignal], timeout: 15000 })
    // Revalidación de fondo con selección ya asentada: conservar la pantalla de
    // operadores en vez de volver a 'loading-profile' — ese cambio remontaba
    // OperatorPicker y reiniciaba la animación de entrada (pantalla en negro)
    // con cada TOKEN_REFRESHED. El resultado de esta petición decide el estado.
    const seleccionAsentada = get().seleccionPendiente && get().authStatus === 'seleccion-pendiente'
    set({ _cargandoPerfil: true, authStatus: get().perfil ? 'authenticated' : (seleccionAsentada ? 'seleccion-pendiente' : 'loading-profile') })
    try {
      let token = suppliedToken
      if (!token) {
        const { data } = await request.wait(supabase.auth.getSession())
        if (!active()) return false
        if (data?.session?.user?.id !== authUser.id) throw Object.assign(new Error('La identidad de la sesión cambió. Vuelve a iniciar sesión.'), { status: 403 })
        token = data.session.access_token
      }
      if (!active()) return false
      request.signal.throwIfAborted()
      if (!token) throw Object.assign(new Error('No hay una sesión activa.'), { status: 401 })
      const response = await request.wait(fetch(apiUrl('/api/auth/me'), { headers: { Authorization: `Bearer ${token}` }, signal: request.signal, cache: 'no-store' }))
      const result = await request.wait(response.json()).catch(() => ({}))
      if (!response.ok) {
        // Cuenta multi-operador sin selección: mostrar la pantalla de operadores.
        // No es un error de sesión: el token es válido, falta el PIN del operador.
        if (result?.error === 'OPERADOR_REQUERIDO' && Array.isArray(result.operators)) {
          clearAccountData(authUser.id)
          if (!active()) return false
          set({ perfil: null, seleccionPendiente: true, operadoresDisponibles: result.operators,
            initialized: true, error: null, authStatus: 'seleccion-pendiente' })
          return false
        }
        // Cuenta sin ningún usuario operativo: la pantalla de error monta el
        // arranque (crear el primer usuario), no un callejón sin salida.
        if (result?.code === 'SIN_OPERADORES') {
          clearAccountData(authUser.id)
          if (!active()) return false
          set({ perfil: null, cuentaSinOperadores: true, initialized: true,
            error: result.error || 'No hay un usuario operativo configurado', authStatus: 'denied' })
          return false
        }
        throw Object.assign(new Error(result.error || 'No se pudo cargar el perfil.'), { status: response.status })
      }
      const profile = result.profile
      if (!profile?.id || !tieneAccesoOperativo(profile) || profile.activo === false || (profile.cuenta_id && profile.cuenta_id !== authUser.id)) {
        throw Object.assign(new Error('El perfil no tiene acceso a esta cuenta.'), { status: 403 })
      }
      if (!active()) return false
      set({ user: authUser, perfil: { ...profile, cuenta_id: authUser.id, email: authUser.email },
        authStatus: 'authenticated', error: null, initialized: true,
        seleccionPendiente: false, operadoresDisponibles: [], cuentaSinOperadores: false })
      return true
    } catch (error) {
      if (!active()) return false
      // No fallback desde disco, ni siquiera ante error transitorio: la política
      // de datos sensibles offline permanece deshabilitada hasta aprobación.
      clearAccountData(authUser.id)
      set({ perfil: null, initialized: true, authStatus: [401, 403].includes(error.status) ? 'denied' : 'error',
        error: request.signal.reason?.name === 'TimeoutError' ? 'La comprobación del perfil tardó demasiado. Puedes reintentar.' : (error.message || 'No se pudo cargar el perfil.') })
      if (AUTH_DEBUG) console.debug('[auth] profile unavailable', error.status || 'network')
      return false
    } finally {
      request.dispose()
      if (active()) set({ _cargandoPerfil: false, _initializing: false })
    }
  },

  retryProfile: async () => {
    const user = get().user
    if (user) return get()._cargarPerfil(user)
    const generation = get().sessionGeneration
    const request = createRequestScope({ signals: [get().sessionSignal], timeout: 15000 })
    const current = () => generation === get().sessionGeneration
    try {
      const { data } = await request.wait(supabase.auth.getSession())
      if (!current()) return false
      if (!data?.session?.user) { get().expireSession(null); return false }
      get()._changeAccount(data.session.user)
      return get()._cargarPerfil(data.session.user, data.session.access_token)
    } catch {
      if (current()) set({ error: 'No se pudo comprobar la sesión.', initialized: true, authStatus: 'error' })
      return false
    } finally { request.dispose() }
  },

  login: async (email, password) => {
    if (get().loading) return { ok: false }
    let sequence = ++loginSequence
    const attempt = { email: email.trim().toLowerCase() }
    const current = () => sequence === loginSequence
    passwordAttempts.add(attempt)
    set({ loading: true, error: null })
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: attempt.email, password })
      if (!current()) {
        // A cancelled login may still have persisted an SDK session. Clear it
        // only if no replacement account or password attempt owns the SDK.
        if (!get().accountId && passwordAttempts.size === 1) {
          const cleanupSequence = loginSequence
          set({ loading: true })
          try { await supabase.auth.signOut({ scope: 'local' }) }
          catch { /* Local access remains withdrawn; never restore the profile. */ }
          finally { if (cleanupSequence === loginSequence || !get().accountId) set({ loading: false }) }
        }
        return { ok: false }
      }
      if (error) throw error
      if (!data?.user?.id || data.session?.user?.id !== data.user.id || !data.session?.access_token) throw new Error('Missing session identity')
      get()._changeAccount(data.user)
      sequence = loginSequence
      set({ loading: true })
      // F2 — barrera de acceso: al abrir una sesión con contraseña se limpia la
      // selección de operador del servidor; el perfil responde OPERADOR_REQUERIDO
      // y el usuario debe elegir operador e ingresar su PIN (ninguna sesión nueva
      // entra sin la barrera). Si la limpieza falla (sin red), el servidor
      // conserva la selección anterior: caso residual documentado.
      try {
        await fetch(apiUrl('/api/auth/clear-operator'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
        })
      } catch { /* El cierre de la barrera no depende de la red; sigue vigente al cambiar de operador. */ }
      await get()._cargarPerfil(data.user, data.session.access_token)
      // El login también es exitoso cuando falta el PIN del operador: la sesión
      // de la cuenta está abierta y la pantalla de selección queda montada.
      return { ok: current() && get().accountId === data.user.id
        && ['authenticated', 'seleccion-pendiente'].includes(get().authStatus) }
    } catch (error) {
      if (current()) set({ error: loginError(error.message) })
      return { ok: false }
    } finally {
      passwordAttempts.delete(attempt)
      if (current()) set({ loading: false })
    }
  },

  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/reset-password` })
    return { ok: !error, error: error?.message }
  },

  logout: async () => {
    set({ _logoutManual: true })
    get().expireSession(null)
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch { /* La limpieza local y cancelación ya se han aplicado. */ }
    finally { set({ _logoutManual: false, loading: false }) }
    return { ok: true }
  },

  // F2 — selección de operador con PIN. El servidor valida el PIN (PBKDF2) en
  // el Worker y escribe la metadata del operador; luego se recarga el perfil.
  // Bloqueo síncrono anti doble envío (mismo patrón que LoginPinModal).
  // Devuelve siempre un booleano: LoginPinModal usa el resultado como señal de
  // éxito/fallo (un objeto sería truthy y ocultaría el PIN incorrecto).
  seleccionarOperador: async (operatorId, pin) => {
    if (get()._seleccionando) return false
    set({ _seleccionando: true })
    const authUser = get().user
    if (!authUser?.id) {
      set({ _seleccionando: false })
      return false
    }
    const token = await tokenDeSesion(authUser)
    if (!token) {
      set({ _seleccionando: false })
      return false
    }
    try {
      const response = await fetch(apiUrl('/api/auth/switch-operator'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ operator_id: operatorId, pin }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        set({ error: result.error || 'No se pudo seleccionar el operador.' })
        return false
      }
      set({ seleccionPendiente: false, operadoresDisponibles: [], error: null })
      await get()._cargarPerfil(authUser, token)
      return get().authStatus === 'authenticated'
    } catch {
      set({ error: 'No se pudo seleccionar el operador.' })
      return false
    } finally {
      set({ _seleccionando: false })
    }
  },
  // F2 — cambiar de operador sin cerrar la cuenta: limpia la selección en el
  // servidor y vuelve a la pantalla de selección + PIN. Devuelve true si quedó
  // en la selección; false si no hay sesión o no se pudo limpiar (sigue dentro).
  cambiarOperador: async () => {
    const authUser = get().user
    if (!authUser?.id) return false
    const token = await tokenDeSesion(authUser)
    if (!token) return false
    try {
      await fetch(apiUrl('/api/auth/clear-operator'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
    } catch { /* Sin red el servidor conserva la selección: se queda donde está. */ }
    await get()._cargarPerfil(authUser, token)
    return get().authStatus === 'seleccion-pendiente'
  },
  // Arranque de cuenta (callejón «sin operadores activos»): crea el primer
  // usuario con la identidad de la CUENTA y entra con él por la barrera
  // canónica — seleccionarOperador valida el PIN recién creado en el Worker y
  // escribe la metadata, exactamente igual que desde el picker.
  crearPrimerOperador: async ({ nombre, pin }) => {
    if (get().loading) return false
    const authUser = get().user
    if (!authUser?.id) return false
    const token = await tokenDeSesion(authUser)
    if (!token) return false
    set({ loading: true, error: null })
    try {
      const response = await fetch(apiUrl('/api/gestion/operadores/bootstrap'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre, pin }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result?.usuario?.id) {
        set({ error: result?.error || 'No se pudo crear el usuario.' })
        return false
      }
      return await get().seleccionarOperador(result.usuario.id, pin)
    } catch {
      set({ error: 'No se pudo crear el usuario.' })
      return false
    } finally {
      set({ loading: false })
    }
  },
  limpiarError: () => set({ error: null }),
}))

export default useAuthStore
