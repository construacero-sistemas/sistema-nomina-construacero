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
const profile = user => ({ id: `operator-${user.id}`, cuenta_id: user.id, rol: 'jefe', activo: true })
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
async function flush() { for (let i = 0; i < 12; i += 1) await Promise.resolve() }

let store, persisters, emit, cleanup
beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  mocks.disk.clear()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://session-tests.invalid')
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
  mocks.auth.onAuthStateChange.mockImplementation(callback => {
    emit = callback
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  store = (await import('../useAuthStore.js')).default
  persisters = await import('../../lib/queryPersister.js')
  cleanup = null
})
afterEach(() => {
  cleanup?.()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function seedAccount(user) {
  store.getState()._changeAccount(user)
  store.setState({ perfil: profile(user), authStatus: 'authenticated', initialized: true })
  localStorage.setItem(`listo_perfil_cache-${user.id}`, JSON.stringify(profile(user)))
  localStorage.setItem(`listo_operators_cache-${user.id}`, JSON.stringify([profile(user)]))
  localStorage.setItem(`nomina_cuentas_custodia_${user.id}`, 'sensitive')
  mocks.disk.set(`CONSTRUACERO_RQ_CACHE_V2:${user.id}`, { protected: user.id })
}

describe('Session isolation and recovery', () => {
  it('a late password response and SDK event cannot restore access after logout', async () => {
    mocks.auth.getSession.mockReturnValue(new Promise(() => {}))
    cleanup = store.getState().initialize()
    const late = deferred()
    mocks.auth.signInWithPassword.mockReturnValue(late.promise)
    const login = store.getState().login(accountA.email, 'test-password')
    await store.getState().logout()
    emit('SIGNED_IN', session(accountA))
    late.resolve({ data: { user: accountA, session: session(accountA) }, error: null })
    await expect(login).resolves.toEqual({ ok: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState()).toMatchObject({ accountId: null, perfil: null, authStatus: 'anonymous', loading: false })
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(2)
  })

  it('a superseded password response cannot replace B or sign B out', async () => {
    const late = deferred()
    mocks.auth.signInWithPassword.mockReturnValue(late.promise)
    const login = store.getState().login(accountA.email, 'test-password')
    seedAccount(accountB)
    late.resolve({ data: { user: accountA, session: session(accountA) }, error: null })
    await expect(login).resolves.toEqual({ ok: false })
    expect(store.getState()).toMatchObject({ accountId: accountB.id, perfil: profile(accountB), authStatus: 'authenticated' })
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.auth.signOut).not.toHaveBeenCalled()
  })

  it('accepts its own SIGNED_IN event without invalidating the password attempt', async () => {
    mocks.auth.getSession.mockReturnValue(new Promise(() => {}))
    cleanup = store.getState().initialize()
    mocks.auth.signInWithPassword.mockImplementation(async () => {
      emit('SIGNED_IN', session(accountA))
      return { data: { user: accountA, session: session(accountA) }, error: null }
    })
    fetch.mockResolvedValue(response(200, { profile: profile(accountA) }))
    await expect(store.getState().login(accountA.email, 'test-password')).resolves.toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState()).toMatchObject({ accountId: accountA.id, authStatus: 'authenticated', loading: false })
    // F2: el login primero limpia la selección de operador y luego carga el perfil.
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['resolve', 'reject'])('an online lookup settling after SIGNED_OUT stays withdrawn (%s)', async outcome => {
    const online = deferred()
    mocks.auth.getSession.mockReturnValueOnce(new Promise(() => {})).mockReturnValueOnce(online.promise)
    cleanup = store.getState().initialize()
    window.dispatchEvent(new Event('online'))
    emit('SIGNED_OUT', null)
    if (outcome === 'resolve') online.resolve({ data: { session: session(accountA) } })
    else online.reject(new Error('Late network error'))
    await flush()
    expect(store.getState()).toMatchObject({ accountId: null, perfil: null, authStatus: 'anonymous' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('profile retry refuses an SDK token belonging to another account', async () => {
    seedAccount(accountA)
    mocks.auth.getSession.mockResolvedValue({ data: { session: session(accountB) } })
    await expect(store.getState().retryProfile()).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(store.getState()).toMatchObject({ accountId: accountA.id, perfil: null, authStatus: 'denied' })
  })
  it.each([401, 403, 500])('login with profile HTTP %i never restores cached authorization', async status => {
    localStorage.setItem(`listo_perfil_cache-${accountA.id}`, JSON.stringify(profile(accountA)))
    mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: accountA, session: session(accountA) }, error: null })
    fetch.mockResolvedValue(response(status, { error: 'Profile unavailable' }))
    expect(await store.getState().login(' A@example.invalid ', 'test-password')).toEqual({ ok: false })
    expect(mocks.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@example.invalid', password: 'test-password' })
    expect(store.getState()).toMatchObject({ accountId: accountA.id, perfil: null, initialized: true, loading: false,
      _cargandoPerfil: false, authStatus: status === 500 ? 'error' : 'denied', error: 'Profile unavailable' })
    expect(localStorage.getItem(`listo_perfil_cache-${accountA.id}`)).toBeNull()
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('SIGNED_OUT cancels requests and clears profile, account caches and queries immediately', async () => {
    mocks.auth.getSession.mockReturnValue(new Promise(() => {}))
    cleanup = store.getState().initialize()
    seedAccount(accountA)
    await flush()
    const previous = store.getState()
    emit('SIGNED_OUT', null)
    await flush()
    expect(store.getState()).toMatchObject({ user: null, perfil: null, accountId: null, authStatus: 'anonymous', initialized: true })
    expect(previous.sessionSignal.aborted).toBe(true)
    expect(store.getState().sessionGeneration).toBeGreaterThan(previous.sessionGeneration)
    expect(mocks.query.cancelQueries).toHaveBeenCalled()
    expect(mocks.query.clear).toHaveBeenCalled()
    expect(localStorage.getItem(`listo_perfil_cache-${accountA.id}`)).toBeNull()
    expect(localStorage.getItem(`listo_operators_cache-${accountA.id}`)).toBeNull()
    expect(localStorage.getItem(`nomina_cuentas_custodia_${accountA.id}`)).toBeNull()
    expect(mocks.disk.has(`CONSTRUACERO_RQ_CACHE_V2:${accountA.id}`)).toBe(false)
  })

  it('logout clears local access before the remote signout resolves', async () => {
    seedAccount(accountA)
    const remote = deferred()
    mocks.auth.signOut.mockReturnValue(remote.promise)
    const action = store.getState().logout()
    expect(store.getState()).toMatchObject({ accountId: null, user: null, perfil: null, authStatus: 'anonymous' })
    remote.reject(new Error('Network unavailable'))
    await expect(action).resolves.toEqual({ ok: true })
    expect(store.getState().loading).toBe(false)
  })

  it('ignores a late profile response from A after switching to B', async () => {
    const late = deferred()
    fetch.mockReturnValueOnce(late.promise).mockResolvedValueOnce(response(200, { profile: profile(accountB) }))
    store.getState()._changeAccount(accountA)
    const oldSignal = store.getState().sessionSignal
    const requestA = store.getState()._cargarPerfil(accountA, session(accountA).access_token)
    store.getState()._changeAccount(accountB)
    await store.getState()._cargarPerfil(accountB, session(accountB).access_token)
    late.resolve(response(200, { profile: profile(accountA) }))
    await expect(requestA).resolves.toBe(false)
    expect(oldSignal.aborted).toBe(true)
    expect(store.getState()).toMatchObject({ accountId: accountB.id, perfil: profile(accountB), authStatus: 'authenticated', _cargandoPerfil: false })
  })

  it('ignores the initial getSession result arriving after SIGNED_OUT', async () => {
    const probe = deferred()
    mocks.auth.getSession.mockReturnValue(probe.promise)
    cleanup = store.getState().initialize()
    emit('SIGNED_OUT', null)
    probe.resolve({ data: { session: session(accountA) } })
    await flush()
    expect(store.getState()).toMatchObject({ accountId: null, perfil: null, authStatus: 'anonymous' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not process an enqueued SIGNED_IN after a later SIGNED_OUT', async () => {
    mocks.auth.getSession.mockReturnValue(new Promise(() => {}))
    cleanup = store.getState().initialize()
    emit('SIGNED_IN', session(accountA))
    emit('SIGNED_OUT', null)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState()).toMatchObject({ accountId: null, perfil: null, authStatus: 'anonymous' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cross-tab account events clear A before asynchronous loading of B', async () => {
    mocks.auth.getSession.mockReturnValue(new Promise(() => {}))
    cleanup = store.getState().initialize()
    seedAccount(accountA)
    await flush()
    const oldSignal = store.getState().sessionSignal
    fetch.mockResolvedValue(response(200, { profile: profile(accountB) }))
    emit('SIGNED_IN', session(accountB))
    expect(oldSignal.aborted).toBe(true)
    expect(store.getState()).toMatchObject({ accountId: accountB.id, perfil: null, authStatus: 'loading-profile' })
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState()).toMatchObject({ accountId: accountB.id, perfil: profile(accountB), authStatus: 'authenticated' })
    expect(mocks.disk.has(`CONSTRUACERO_RQ_CACHE_V2:${accountA.id}`)).toBe(false)
  })

  it('denyAccess cancels in-flight work and removes sensitive caches', async () => {
    seedAccount(accountA)
    await flush()
    const previous = store.getState()
    store.getState().denyAccess()
    await flush()
    expect(previous.sessionSignal.aborted).toBe(true)
    expect(store.getState()).toMatchObject({ accountId: accountA.id, perfil: null, authStatus: 'denied', _cargandoPerfil: false })
    expect(store.getState().sessionGeneration).toBeGreaterThan(previous.sessionGeneration)
    expect(mocks.disk.has(`CONSTRUACERO_RQ_CACHE_V2:${accountA.id}`)).toBe(false)
  })

  it.each(['session', 'body'])('a stalled profile %s ends with a recoverable timeout', async stage => {
    store.getState()._changeAccount(accountA)
    if (stage === 'session') mocks.auth.getSession.mockReturnValue(new Promise(() => {}))
    else fetch.mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) })
    const request = store.getState()._cargarPerfil(accountA, stage === 'body' ? 'test-token' : undefined)
    await vi.advanceTimersByTimeAsync(15000)
    await expect(request).resolves.toBe(false)
    expect(store.getState()).toMatchObject({ perfil: null, initialized: true, _cargandoPerfil: false })
    expect(['error', 'denied']).toContain(store.getState().authStatus)
    expect(store.getState().error).toMatch(/demasiado/)
  })

  it('a retry session lookup cannot restore access after explicit logout', async () => {
    const lookup = deferred()
    mocks.auth.getSession.mockReturnValue(lookup.promise)
    fetch.mockResolvedValue(response(200, { profile: profile(accountA) }))
    const retry = store.getState().retryProfile()
    await store.getState().logout()
    lookup.resolve({ data: { session: session(accountA) } })
    await retry
    expect(store.getState()).toMatchObject({ accountId: null, perfil: null, authStatus: 'anonymous' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a profile explicitly belonging to a different account', async () => {
    store.getState()._changeAccount(accountA)
    fetch.mockResolvedValue(response(200, { profile: profile(accountB) }))
    await expect(store.getState()._cargarPerfil(accountA, 'test-token')).resolves.toBe(false)
    expect(store.getState()).toMatchObject({ perfil: null, authStatus: 'denied' })
  })
})

describe('Account query persistence', () => {
  it('never hydrates the legacy global cache or any protected cache by default', async () => {
    mocks.disk.set('CONSTRUACERO_RQ_CACHE', { protected: accountA.id })
    mocks.disk.set(`CONSTRUACERO_RQ_CACHE_V2:${accountA.id}`, { protected: accountA.id })
    await expect(persisters.indexedDbPersister.restoreClient()).resolves.toBeUndefined()
    const disabled = persisters.createAccountQueryPersister(accountA.id)
    await expect(disabled.restoreClient()).resolves.toBeUndefined()
    await disabled.persistClient({ protected: 'new' })
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.disk.has('CONSTRUACERO_RQ_CACHE')).toBe(false)
  })

  it('cannot restore or save without account identity even when enabled', async () => {
    const anonymous = persisters.createAccountQueryPersister(null, { enabled: true })
    await anonymous.persistClient({ protected: accountA.id })
    await expect(anonymous.restoreClient()).resolves.toBeUndefined()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('partitions explicitly enabled caches by account and deletes only the selected account', async () => {
    const a = persisters.createAccountQueryPersister(accountA.id, { enabled: true })
    const b = persisters.createAccountQueryPersister(accountB.id, { enabled: true })
    await a.persistClient({ protected: accountA.id })
    await b.persistClient({ protected: accountB.id })
    await expect(a.restoreClient()).resolves.toEqual({ protected: accountA.id })
    await expect(b.restoreClient()).resolves.toEqual({ protected: accountB.id })
    await a.removeClient()
    await expect(a.restoreClient()).resolves.toBeUndefined()
    await expect(b.restoreClient()).resolves.toEqual({ protected: accountB.id })
  })
})
