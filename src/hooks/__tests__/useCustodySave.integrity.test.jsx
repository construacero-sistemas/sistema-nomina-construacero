import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ movement: vi.fn(), state: { accountId: 'A', sessionGeneration: 1 } }))
vi.mock('../useFinanzas.js', () => ({ useCrearMovimiento: () => ({ mutateAsync: mocks.movement }) }))
vi.mock('../../../compat/store/useAuthStore.js', () => ({ default: { getState: () => mocks.state } }))
import useCustodySave from '../useCustodySave.js'
const fields = { nombre: 'Caja nueva', tipo: 'efectivo_usd', moneda: 'USD' }
const key = '10000000-0000-4000-8000-000000000001'
beforeEach(() => { vi.clearAllMocks(); mocks.state = { accountId: 'A', sessionGeneration: 1 } })
describe('Account opening explicit confirmations', () => {
  it('retries only the unconfirmed opening with the same id and saved rate', async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, cuenta: { id: key } })
    mocks.movement.mockRejectedValueOnce(new Error('Network lost')).mockResolvedValueOnce({ ok: true })
    const view = renderHook(({ usd }) => useCustodySave({ agregarCuenta: create, editarCuenta: vi.fn(), usd, usdt: 440 }), { initialProps: { usd: 400 } })
    await act(async () => { await expect(view.result.current(fields, 100, key)).rejects.toThrow(/ya est/) })
    view.rerender({ usd: 450 })
    await act(async () => { await view.result.current(fields, 100, key) })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({ ...fields, id: key })
    expect(mocks.movement.mock.calls[0][0]).toEqual(mocks.movement.mock.calls[1][0])
    expect(mocks.movement.mock.calls[1][0]).toMatchObject({ cuentaCustodiaId: key, tasaVes: 400, idempotencyKey: `apertura:${key}` })
  })
  it('rejects a changed payload after a partial confirmation', async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, cuenta: { id: key } })
    mocks.movement.mockRejectedValue(new Error('No confirmation'))
    const { result } = renderHook(() => useCustodySave({ agregarCuenta: create, usd: 400 }))
    await act(async () => { await expect(result.current(fields, 100, key)).rejects.toThrow() })
    await act(async () => { await expect(result.current(fields, 101, key)).rejects.toThrow(/originales/) })
    expect(create).toHaveBeenCalledOnce(); expect(mocks.movement).toHaveBeenCalledOnce()
  })
  it('does not create an account with unverified opening rates', async () => {
    const create = vi.fn()
    const { result } = renderHook(() => useCustodySave({ agregarCuenta: create, usd: 0 }))
    await act(async () => { await expect(result.current(fields, 100, key)).rejects.toThrow(/tasas/) })
    expect(create).not.toHaveBeenCalled()
  })
})
