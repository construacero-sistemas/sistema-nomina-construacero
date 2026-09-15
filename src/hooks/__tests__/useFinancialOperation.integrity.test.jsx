import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { webcrypto } from 'node:crypto'
const mocks = vi.hoisted(() => ({ session: {}, authFetch: vi.fn(), invalidateQueries: vi.fn() }))
vi.mock('../../../compat/services/authFetch.js', () => ({ authFetch: mocks.authFetch }))
vi.mock('../../../compat/lib/accountQueries.js', () => ({ useAccountQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }))
vi.mock('../../../compat/store/useAuthStore.js', () => {
  const store = selector => selector(mocks.session)
  store.getState = () => mocks.session
  return { default: store }
})
import useFinancialOperation from '../useFinancialOperation.js'
const fields = { origenCuentaId: '10000000-0000-4000-8000-000000000001', destinoCuentaId: '10000000-0000-4000-8000-000000000002', montoOrigen: '10', tasaCambio: '400', tasaUsdVes: '400', fecha: '2026-09-13', observaciones: 'Test transfer' }
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status })
const confirmation = body => ({ ok: true, estado: 'confirmada', tipo: 'traspaso', operationId: '10000000-0000-4000-8000-000000000003', idempotencyKey: body.operationId, resultado: { montoOrigen: '10' } })
let iteration = 0
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto)
  mocks.session = { accountId: `test-account-${++iteration}`, sessionGeneration: 1 }
  mocks.invalidateQueries.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())
const mount = () => renderHook(() => useFinancialOperation('traspaso', '/api/transfer'))
async function uncertain(result) {
  mocks.authFetch.mockRejectedValueOnce(Object.assign(new Error('Unknown result'), { code: 'OPERATION_RESULT_UNKNOWN' }))
  await act(async () => { await expect(result.current.mutateAsync(fields)).rejects.toThrow('Unknown result') })
}
describe('Financial operation identity and recovery', () => {
  it('preserves full payload, waits for confirmation, and invalidates both domains', async () => {
    mocks.authFetch.mockImplementation(async (_url, options) => reply(confirmation(JSON.parse(options.body))))
    const { result } = mount()
    await act(async () => { await result.current.mutateAsync(fields) })
    const sent = JSON.parse(mocks.authFetch.mock.calls[0][1].body)
    expect(sent).toMatchObject(fields); expect(sent.operationId).toMatch(/^[a-f0-9-]{36}$/)
    expect(mocks.authFetch).toHaveBeenCalledTimes(1)
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['finanzas'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['nomina'] })
    expect(result.current.operationId).toBeNull()
  })
  it('keeps the same key across timeout and remount; stores no financial fields', async () => {
    const first = mount(); await uncertain(first.result)
    const key = first.result.current.operationId
    const stored = JSON.parse(sessionStorage.getItem(`nomina-operation:${mocks.session.accountId}:traspaso`))
    expect(Object.keys(stored).sort()).toEqual(['fingerprint','operationId'])
    first.unmount()
    const second = mount()
    expect(second.result.current.operationId).toBe(key)
    mocks.authFetch.mockImplementation(async (_url, options) => reply(confirmation(JSON.parse(options.body))))
    await act(async () => { await second.result.current.mutateAsync(fields) })
    expect(JSON.parse(mocks.authFetch.mock.calls[1][1].body).operationId).toBe(key)
  })
  it('does not resubmit changed data while the original result is unknown', async () => {
    const { result } = mount(); await uncertain(result)
    const key = result.current.operationId
    mocks.authFetch.mockResolvedValueOnce(reply({ estado: 'no_encontrada', tipo: 'traspaso', idempotencyKey: key }))
    await act(async () => { await expect(result.current.mutateAsync({ ...fields, montoOrigen: '11' })).rejects.toThrow(/pendiente/) })
    expect(mocks.authFetch.mock.calls.filter(([,options]) => options?.method === 'POST')).toHaveLength(1)
    expect(result.current.operationId).toBe(key)
  })
  it('rejects a mismatched status envelope without forgetting the pending key', async () => {
    const { result } = mount(); await uncertain(result)
    const key = result.current.operationId
    mocks.authFetch.mockResolvedValueOnce(reply(confirmation({ operationId: 'wrong-key' })))
    await act(async () => { await expect(result.current.checkStatus()).rejects.toThrow(/no verificable/) })
    expect(result.current.operationId).toBe(key)
  })
  it('rejects incomplete success without treating it as payment confirmation', async () => {
    mocks.authFetch.mockImplementation(async (_url, options) => { const result = confirmation(JSON.parse(options.body)); delete result.resultado; return reply(result) })
    const { result } = mount()
    await act(async () => { await expect(result.current.mutateAsync(fields)).rejects.toThrow(/no verificable/) })
    expect(result.current.operationId).not.toBeNull(); expect(mocks.invalidateQueries).not.toHaveBeenCalled()
  })
  it('does not apply a late response from A to B', async () => {
    let resolveRequest, started
    const begun = new Promise(resolve => { started = resolve })
    mocks.authFetch.mockImplementation((_url, options) => new Promise(resolve => { resolveRequest = () => resolve(reply(confirmation(JSON.parse(options.body)))); started() }))
    const { result, rerender } = mount()
    let pending
    await act(async () => { pending = result.current.mutateAsync(fields); await begun })
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    mocks.session = { accountId: 'different-account', sessionGeneration: 2 }
    rerender()
    await act(async () => { resolveRequest(); await rejection })
    expect(result.current.operationId).toBeNull(); expect(result.current.error).toBeNull()
    expect(mocks.invalidateQueries).not.toHaveBeenCalled()
  })
  it('rejects repeated submission synchronously before hashing or sending', async () => {
    let finish, started
    const begun = new Promise(resolve => { started = resolve })
    mocks.authFetch.mockImplementation((_url, options) => new Promise(resolve => { finish = () => resolve(reply(confirmation(JSON.parse(options.body)))); started() }))
    const { result } = mount()
    let pending
    await act(async () => {
      pending = result.current.mutateAsync(fields)
      await expect(result.current.mutateAsync(fields)).rejects.toThrow(/procesando/)
    })
    await act(async () => { await begun; finish(); await pending })
    expect(mocks.authFetch).toHaveBeenCalledTimes(1)
  })
})
