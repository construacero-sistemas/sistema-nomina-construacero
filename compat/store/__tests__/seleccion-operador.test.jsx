// compat/store/__tests__/seleccion-operador.test.jsx
// F2 — barrera de acceso: cuando la cuenta tiene varios operadores, el perfil no
// se carga sin PIN. El store refleja OPERADOR_REQUERIDO y envía el PIN al Worker.
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(),
    onAuthStateChange: vi.fn(), resetPasswordForEmail: vi.fn(), refreshSession: vi.fn(),
  },
  query: { cancelQueries: vi.fn(), clear: vi.fn() },
  disk: new Map(), get: vi.fn(), set: vi.fn(), del: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: mocks.auth }) }))
vi.mock('../../lib/queryClient', () => ({ default: mocks.query }))
vi.mock('../../services/apiBase', () => ({ apiUrl: path => path }))
vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set, del: mocks.del }))

const accountA = { id: 'account-a', email: 'a@example.invalid' }
const accountB = { id: 'account-b', email: 'b@example.invalid' }
const session = user => ({ user, access_token: `test-token-${user.id}` })
const OPERADORES = {
  jefe: { id: 'op-admin', nombre: 'Jefe', rol: 'jefe', color: null },
  finanzas: { id: 'op-finanzas', nombre: 'Finanzas', rol: 'finanzas', color: '#3b82f6' },
}
const profile = (operador, cuenta = accountA) => ({ ...operador, cuenta_id: cuenta.id, activo: true })
const response = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function storage() {
  const values = {}
  Object.defineProperties(values, {
    getItem: { value: key => values[key] ?? null },
    setItem: { value: (key, value) => { values[key] = String(value) } },
    removeItem: { value: key => { delete values[key] } },
  })
  return values
}

let store
beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  mocks.disk.clear()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://seleccion-tests.invalid')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key')
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('localStorage', storage())
  vi.stubGlobal('fetch', vi.fn())
  mocks.query.cancelQueries.mockResolvedValue(undefined)
  mocks.get.mockImplementation(async key => mocks.disk.get(key))
  mocks.set.mockImplementation(async (key, value) => { mocks.disk.set(key, value) })
  mocks.del.mockImplementation(async key => { mocks.disk.delete(key) })
  mocks.auth.getSession.mockResolvedValue({ data: { session: null } })
  mocks.auth.signOut.mockResolvedValue({ error: null })
  store = (await import('../useAuthStore.js')).default
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function pendiente() {
  store.getState()._changeAccount(accountA)
  store.setState({
    seleccionPendiente: true,
    operadoresDisponibles: [OPERADORES.jefe, OPERADORES.finanzas],
    authStatus: 'seleccion-pendiente', initialized: true,
  })
}

describe('F2 — el perfil exige selección de operador', () => {
  it('OPERADOR_REQUERIDO deja la selección pendiente y no es un error de sesión', async () => {
    fetch.mockResolvedValue(response(403, {
      error: 'OPERADOR_REQUERIDO',
      operators: [OPERADORES.jefe, OPERADORES.finanzas],
    }))
    store.getState()._changeAccount(accountA)
    localStorage.setItem(`listo_perfil_cache-${accountA.id}`, JSON.stringify(profile(OPERADORES.finanzas)))

    await expect(store.getState()._cargarPerfil(accountA, 'token-a')).resolves.toBe(false)

    expect(store.getState()).toMatchObject({
      perfil: null, authStatus: 'seleccion-pendiente', seleccionPendiente: true,
      initialized: true, error: null, _cargandoPerfil: false,
    })
    expect(store.getState().operadoresDisponibles.map(op => op.rol)).toEqual(['jefe', 'finanzas'])
    // La selección pendiente no restaura perfil desde disco.
    expect(localStorage.getItem(`listo_perfil_cache-${accountA.id}`)).toBeNull()
  })

  it('un 403 sin OPERADOR_REQUERIDO sigue siendo acceso denegado', async () => {
    fetch.mockResolvedValue(response(403, { error: 'El perfil no tiene acceso a esta cuenta.' }))
    store.getState()._changeAccount(accountA)

    await expect(store.getState()._cargarPerfil(accountA, 'token-a')).resolves.toBe(false)
    expect(store.getState()).toMatchObject({ authStatus: 'denied', seleccionPendiente: false, perfil: null })
  })

  it('una revalidación de fondo no remonta la selección (conserva seleccion-pendiente)', async () => {
    // Regresión F2/UI: un TOKEN_REFRESHED dispara _cargarPerfil en segundo
    // plano; si pisara el estado con 'loading-profile', LoginPage desmontaría
    // el picker y la animación de entrada volvería a empezar (pantalla en negro).
    pendiente()
    const lenta = deferred()
    fetch.mockReturnValue(lenta.promise)

    const enCurso = store.getState()._cargarPerfil(accountA, 'token-a')

    expect(store.getState()).toMatchObject({
      authStatus: 'seleccion-pendiente', seleccionPendiente: true, _cargandoPerfil: true,
    })

    lenta.resolve(response(403, {
      error: 'OPERADOR_REQUERIDO',
      operators: [OPERADORES.jefe, OPERADORES.finanzas],
    }))
    await expect(enCurso).resolves.toBe(false)
    expect(store.getState()).toMatchObject({
      authStatus: 'seleccion-pendiente', seleccionPendiente: true, _cargandoPerfil: false,
    })
  })
})

describe('arranque de cuenta — sin operadores activos', () => {
  it('SIN_OPERADORES marca cuentaSinOperadores en lugar de un callejón', async () => {
    fetch.mockResolvedValue(response(403, { error: 'No hay un usuario operativo configurado', code: 'SIN_OPERADORES' }))
    store.getState()._changeAccount(accountA)

    await expect(store.getState()._cargarPerfil(accountA, 'token-a')).resolves.toBe(false)

    expect(store.getState()).toMatchObject({
      cuentaSinOperadores: true, authStatus: 'denied', perfil: null, initialized: true,
      error: 'No hay un usuario operativo configurado',
    })
  })

  it('crearPrimerOperador crea el usuario y entra por la barrera PIN (switch-operator)', async () => {
    store.getState()._changeAccount(accountA)
    store.setState({ cuentaSinOperadores: true, authStatus: 'denied', initialized: true })
    mocks.auth.getSession.mockResolvedValue({ data: { session: session(accountA) } })
    const rutas = []
    fetch.mockImplementation(async (url, init) => {
      rutas.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
      if (String(url).includes('/api/gestion/operadores/bootstrap')) {
        return response(201, { ok: true, usuario: { id: 'op-jefe', nombre: 'María Pérez', rol: 'jefe', color: null } })
      }
      if (String(url).includes('/api/auth/switch-operator')) return response(200, { ok: true })
      return response(200, { profile: { id: 'op-jefe', nombre: 'María Pérez', rol: 'jefe', color: null, cuenta_id: accountA.id, activo: true } })
    })

    await expect(store.getState().crearPrimerOperador({ nombre: 'María Pérez', pin: '123456' })).resolves.toBe(true)

    expect(rutas.map(ruta => ruta.url)).toEqual([
      '/api/gestion/operadores/bootstrap',
      '/api/auth/switch-operator',
      '/api/auth/me',
    ])
    expect(rutas[0].body).toEqual({ nombre: 'María Pérez', pin: '123456' })
    expect(rutas[1].body).toEqual({ operator_id: 'op-jefe', pin: '123456' })
    expect(store.getState()).toMatchObject({
      authStatus: 'authenticated', cuentaSinOperadores: false,
      perfil: expect.objectContaining({ id: 'op-jefe', rol: 'jefe' }),
    })
  })

  it('si el servidor rechaza (cuenta ya con usuarios) no toca switch-operator', async () => {
    store.getState()._changeAccount(accountA)
    store.setState({ cuentaSinOperadores: true, authStatus: 'denied', initialized: true })
    mocks.auth.getSession.mockResolvedValue({ data: { session: session(accountA) } })
    fetch.mockResolvedValue(response(409, { error: 'La cuenta ya tiene usuarios activos. Gestiónalos desde Usuarios y accesos.' }))

    await expect(store.getState().crearPrimerOperador({ nombre: 'María Pérez', pin: '123456' })).resolves.toBe(false)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.getState()).toMatchObject({ authStatus: 'denied', cuentaSinOperadores: true })
    expect(store.getState().error).toContain('ya tiene usuarios activos')
  })
})

describe('F2 — cada inicio de sesión exige elegir operador y PIN', () => {
  it('login limpia la selección de operador en el servidor antes de cargar el perfil', async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: accountA, session: session(accountA) }, error: null })
    let rutas = []
    fetch.mockImplementation(async url => {
      rutas.push(String(url))
      return String(url).includes('/api/auth/clear-operator')
        ? response(200, { ok: true })
        : response(403, { error: 'OPERADOR_REQUERIDO', operators: [OPERADORES.finanzas] })
    })

    // El login también es exitoso cuando falta el PIN: la pantalla de selección queda montada.
    await expect(store.getState().login('a@example.invalid', 'test-password')).resolves.toEqual({ ok: true })
    expect(rutas[0]).toContain('/api/auth/clear-operator')
    expect(rutas[1]).toContain('/api/auth/me')
    expect(store.getState()).toMatchObject({ authStatus: 'seleccion-pendiente', seleccionPendiente: true, perfil: null })
  })

  it('cambiarOperador limpia la selección y vuelve a la pantalla de PIN', async () => {
    store.getState()._changeAccount(accountA)
    store.setState({ perfil: profile(OPERADORES.finanzas), authStatus: 'authenticated', initialized: true })
    mocks.auth.getSession.mockResolvedValue({ data: { session: session(accountA) } })
    fetch.mockImplementation(async url => (
      String(url).includes('/api/auth/clear-operator')
        ? response(200, { ok: true })
        : response(403, { error: 'OPERADOR_REQUERIDO', operators: [OPERADORES.jefe, OPERADORES.finanzas] })
    ))

    await expect(store.getState().cambiarOperador()).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledWith('/api/auth/clear-operator', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-token-account-a' }),
    }))
    expect(store.getState()).toMatchObject({ authStatus: 'seleccion-pendiente', seleccionPendiente: true, perfil: null })
    expect(store.getState().operadoresDisponibles).toHaveLength(2)
  })
})

describe('F2 — seleccionarOperador valida el PIN en el Worker', () => {
  it('envía operator_id y pin, y recarga el perfil elegido', async () => {
    pendiente()
    mocks.auth.getSession.mockResolvedValue({ data: { session: session(accountA) } })
    fetch.mockImplementation(async url => (
      String(url).includes('/api/auth/switch-operator')
        ? response(200, { ok: true, operator: OPERADORES.finanzas })
        : response(200, { profile: profile(OPERADORES.finanzas) })
    ))

    await expect(store.getState().seleccionarOperador(OPERADORES.finanzas.id, '123456')).resolves.toBe(true)

    expect(fetch).toHaveBeenCalledWith('/api/auth/switch-operator', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ operator_id: 'op-finanzas', pin: '123456' }),
      headers: expect.objectContaining({ Authorization: 'Bearer test-token-account-a' }),
    }))
    expect(store.getState()).toMatchObject({
      authStatus: 'authenticated', seleccionPendiente: false, error: null,
      perfil: expect.objectContaining({ id: 'op-finanzas', rol: 'finanzas' }),
    })
    expect(store.getState().operadoresDisponibles).toEqual([])
    expect(store.getState()._seleccionando).toBe(false)
  })

  it('un PIN incorrecto mantiene la selección pendiente y no carga perfil', async () => {
    pendiente()
    mocks.auth.getSession.mockResolvedValue({ data: { session: session(accountA) } })
    fetch.mockResolvedValue(response(401, { error: 'PIN incorrecto' }))

    await expect(store.getState().seleccionarOperador(OPERADORES.finanzas.id, '000000')).resolves.toBe(false)

    expect(store.getState()).toMatchObject({
      error: 'PIN incorrecto', authStatus: 'seleccion-pendiente', perfil: null,
      seleccionPendiente: true, _seleccionando: false,
    })
    // Solo el intento de selección: nunca se pidió el perfil sin PIN validado.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('un segundo envío simultáneo no duplica el POST', async () => {
    pendiente()
    mocks.auth.getSession.mockResolvedValue({ data: { session: session(accountA) } })
    const gate = deferred()
    let calls = 0
    fetch.mockImplementation(() => {
      calls += 1
      if (calls === 1) return gate.promise
      return Promise.resolve(response(200, { profile: profile(OPERADORES.finanzas) }))
    })

    const primero = store.getState().seleccionarOperador(OPERADORES.finanzas.id, '123456')
    await expect(store.getState().seleccionarOperador(OPERADORES.finanzas.id, '123456')).resolves.toBe(false)
    expect(calls).toBe(1)

    gate.resolve(response(200, { ok: true, operator: OPERADORES.finanzas }))
    await expect(primero).resolves.toBe(true)
    expect(calls).toBe(2)
  })

  it('sin identidad de cuenta no llama al Worker', async () => {
    pendiente()
    store.setState({ user: null })

    await expect(store.getState().seleccionarOperador(OPERADORES.finanzas.id, '123456')).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(store.getState()._seleccionando).toBe(false)
  })

  it('un token de otra cuenta no se usa para seleccionar', async () => {
    pendiente()
    mocks.auth.getSession.mockResolvedValue({ data: { session: session(accountB) } })

    await expect(store.getState().seleccionarOperador(OPERADORES.finanzas.id, '123456')).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('un fallo de red no deja un perfil cargado', async () => {
    pendiente()
    mocks.auth.getSession.mockResolvedValue({ data: { session: session(accountA) } })
    fetch.mockRejectedValue(new Error('Network unavailable'))

    await expect(store.getState().seleccionarOperador(OPERADORES.finanzas.id, '123456')).resolves.toBe(false)
    expect(store.getState()).toMatchObject({ perfil: null, seleccionPendiente: true, _seleccionando: false })
    expect(store.getState().error).toMatch(/no se pudo seleccionar/i)
  })
})
