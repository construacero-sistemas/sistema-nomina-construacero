// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: { getSession: vi.fn(), refreshSession: vi.fn() },
  store: { getState: vi.fn(), setState: vi.fn() },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: mocks.auth }) }))
vi.mock('../../store/useAuthStore', () => ({ default: mocks.store }))
vi.mock('../apiBase', () => ({ apiUrl: path => path }))

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const sdkSession = (account = 'account-a', token = 'test-token-a') => ({ data: { session: { user: { id: account }, access_token: token } } })
const reply = (status = 200, body = { ok: true }) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
async function flush() { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
let authFetch, createRequestScope, fetchWithTimeout, state, sessionController
beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://request-tests.invalid')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key')
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', vi.fn())
  sessionController = new AbortController()
  state = { user: { id: 'account-a' }, accountId: 'account-a', perfil: { id: 'operator-a' },
    sessionGeneration: 1, sessionSignal: sessionController.signal, expireSession: vi.fn(), denyAccess: vi.fn() }
  mocks.store.getState.mockImplementation(() => state)
  mocks.auth.getSession.mockResolvedValue(sdkSession())
  mocks.auth.refreshSession.mockResolvedValue(sdkSession('account-a', 'test-refreshed-token'))
  ;({ authFetch } = await import('../authFetch.js'))
  ;({ createRequestScope, fetchWithTimeout } = await import('../supabase/client.js'))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function changeToB({ abort = true } = {}) {
  if (abort) sessionController.abort(new DOMException('Account changed', 'AbortError'))
  state = { ...state, user: { id: 'account-b' }, accountId: 'account-b', perfil: { id: 'operator-b' },
    sessionGeneration: 2, sessionSignal: new AbortController().signal, expireSession: vi.fn(), denyAccess: vi.fn() }
}

describe('Authenticated request boundaries', () => {
  it.each(['account-b', undefined])('rejects an uncorrelated initial SDK identity %s before sending a mutation', async id => {
    mocks.auth.getSession.mockResolvedValue({ data: { session: { user: id ? { id } : null, access_token: 'other-token' } } })
    await expect(authFetch('/api/example', { method: 'POST', body: '{"amount":12}' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not retry a mutation with a refreshed token lacking account identity', async () => {
    fetch.mockResolvedValue(reply(401))
    mocks.auth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'unattributed-token' } } })
    await expect(authFetch('/api/example', { method: 'POST', body: '{"amount":12}' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('retries one 401 for the same account while preserving body, headers and operator', async () => {
    fetch.mockResolvedValueOnce(reply(401)).mockResolvedValueOnce(reply(200, { saved: true }))
    const body = JSON.stringify({ amount: 12, requestId: 'stable-operation' })
    const result = await authFetch('/api/example', { method: 'POST', body, headers: new Headers({ 'Content-Type': 'application/json', 'Idempotency-Key': 'stable-operation' }) })
    expect(await result.json()).toEqual({ saved: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mocks.auth.refreshSession).toHaveBeenCalledTimes(1)
    const first = fetch.mock.calls[0][1]
    const second = fetch.mock.calls[1][1]
    for (const sent of [first, second]) {
      expect(sent.body).toBe(body)
      expect(sent.method).toBe('POST')
      expect(sent.headers.get('X-Operator-Id')).toBe('operator-a')
      expect(sent.headers.get('Idempotency-Key')).toBe('stable-operation')
      expect(sent.headers.get('Content-Type')).toBe('application/json')
      expect(sent.cache).toBe('no-store')
    }
    expect(first.headers.get('Authorization')).toBe('Bearer test-token-a')
    expect(second.headers.get('Authorization')).toBe('Bearer test-refreshed-token')
    expect(second.signal).toBe(first.signal)
  })

  it('never retries a second 401 and expires the current session', async () => {
    fetch.mockImplementation(async () => reply(401))
    const result = await authFetch('/api/example')
    expect(result.status).toBe(401)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(mocks.auth.refreshSession).toHaveBeenCalledTimes(1)
    expect(state.expireSession).toHaveBeenCalledTimes(1)
  })

  it('forbidden responses revoke profile access without trying a token refresh', async () => {
    fetch.mockResolvedValue(reply(403))
    expect((await authFetch('/api/example')).status).toBe(403)
    expect(state.denyAccess).toHaveBeenCalledTimes(1)
    expect(mocks.auth.refreshSession).not.toHaveBeenCalled()
  })

  it('preserves caller cancellation while session lookup is stalled', async () => {
    mocks.auth.getSession.mockReturnValue(new Promise(() => {}))
    const caller = new AbortController()
    const pending = authFetch('/api/example', { signal: caller.signal })
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    caller.abort(new DOMException('Caller cancelled', 'AbortError'))
    await assertion
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('caller abort reaches the fetch signal rather than being replaced by its timeout', async () => {
    fetch.mockReturnValue(new Promise(() => {}))
    const caller = new AbortController()
    const pending = authFetch('/api/example', { signal: caller.signal })
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await flush()
    const signal = fetch.mock.calls[0][1].signal
    caller.abort()
    await assertion
    expect(signal.aborted).toBe(true)
    expect(signal.reason.name).toBe('AbortError')
  })

  it.each(['session', 'body'])('times out a stalled %s within the request deadline', async stage => {
    if (stage === 'session') mocks.auth.getSession.mockReturnValue(new Promise(() => {}))
    else fetch.mockResolvedValue({ status: 200, arrayBuffer: () => new Promise(() => {}) })
    const pending = authFetch('/api/example', { timeout: 25 })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(25)
    await assertion
    expect(mocks.auth.refreshSession).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a timed-out mutation has unknown outcome and is never automatically replayed', async () => {
    fetch.mockReturnValue(new Promise(() => {}))
    const pending = authFetch('/api/example', { method: 'POST', body: '{"requestId":"one"}', timeout: 25 })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'OPERATION_RESULT_UNKNOWN' })
    await vi.advanceTimersByTimeAsync(25)
    await assertion
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(mocks.auth.refreshSession).not.toHaveBeenCalled()
  })

  it('rejects stale generation even if a fetch ignores cancellation', async () => {
    const late = deferred()
    fetch.mockReturnValue(late.promise)
    const pending = authFetch('/api/example')
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await flush()
    changeToB({ abort: false })
    late.resolve(reply(200, { protected: 'account-a' }))
    await assertion
    expect(state.expireSession).not.toHaveBeenCalled()
  })

  it('a late 401 from A cannot expire B or refresh B on behalf of A', async () => {
    const late = deferred()
    const oldExpire = state.expireSession
    fetch.mockReturnValue(late.promise)
    const pending = authFetch('/api/example')
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await flush()
    changeToB({ abort: false })
    late.resolve(reply(401))
    await assertion
    expect(oldExpire).not.toHaveBeenCalled()
    expect(state.expireSession).not.toHaveBeenCalled()
    expect(mocks.auth.refreshSession).not.toHaveBeenCalled()
  })

  it('a late refresh completion after account change cannot issue a retry', async () => {
    const refresh = deferred()
    const oldExpire = state.expireSession
    fetch.mockResolvedValue(reply(401))
    mocks.auth.refreshSession.mockReturnValue(refresh.promise)
    const pending = authFetch('/api/example')
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await flush()
    expect(mocks.auth.refreshSession).toHaveBeenCalledTimes(1)
    changeToB()
    refresh.resolve({ data: { session: null } })
    await assertion
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(oldExpire).not.toHaveBeenCalled()
    expect(state.expireSession).not.toHaveBeenCalled()
  })

  it('blocks offline mutations before authentication or network work', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(authFetch('/api/example', { method: 'PATCH', body: '{}' })).rejects.toMatchObject({ code: 'OFFLINE_WRITE_DISABLED' })
    expect(mocks.auth.getSession).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('Shared request scopes and Supabase fetch', () => {
  it('combines caller and account cancellation and removes listeners on disposal', async () => {
    const caller = new AbortController()
    const account = new AbortController()
    const remove = vi.spyOn(caller.signal, 'removeEventListener')
    const scope = createRequestScope({ signals: [caller.signal, account.signal], timeout: 100 })
    const wait = scope.wait(new Promise(() => {}))
    const assertion = expect(wait).rejects.toMatchObject({ name: 'AbortError' })
    account.abort()
    await assertion
    expect(scope.signal.aborted).toBe(true)
    scope.dispose()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps timeout active when a caller signal is supplied', async () => {
    const scope = createRequestScope({ signals: [new AbortController().signal], timeout: 25 })
    const wait = scope.wait(new Promise(() => {}))
    const assertion = expect(wait).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(25)
    await assertion
    scope.dispose()
  })

  it('Supabase fetch honors a pre-aborted caller without making a request', async () => {
    const caller = new AbortController()
    caller.abort()
    await expect(fetchWithTimeout('https://request-tests.invalid/auth', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('Supabase fetch combines caller cancellation with its 30-second timeout', async () => {
    fetch.mockReturnValue(new Promise(() => {}))
    const pending = fetchWithTimeout('https://request-tests.invalid/auth', { signal: new AbortController().signal })
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(30000)
    await assertion
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
