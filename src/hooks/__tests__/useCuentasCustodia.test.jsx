// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { authFetch } from '../../../compat/services/authFetch.js'
import { showToast } from '../../../compat/components/ui/toastBus.js'
import { useCuentasCustodia } from '../useCuentasCustodia.js'

const session = vi.hoisted(() => ({
  accountId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  user: { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  perfil: { rol: 'jefe', cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
}))
vi.mock('../../../compat/services/authFetch.js', () => ({ authFetch: vi.fn() }))
vi.mock('../../../compat/components/ui/toastBus.js', () => ({ showToast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../../compat/store/useAuthStore.js', () => {
  const useAuthStore = vi.fn(selector => selector ? selector(session) : session)
  useAuthStore.getState = () => session
  return { default: useAuthStore }
})

const ACCOUNTS = [
  { id: '11111111-1111-4111-8111-111111111111', nombre: 'Banco BNC', moneda: 'VES', subcuentaId: 'Banco en Bolívares', activo: true },
  { id: '22222222-2222-4222-8222-222222222222', nombre: 'Banco Mercantil', moneda: 'VES', subcuentaId: 'Banco en Bolívares', activo: true },
]
const clients = []
let catalog, balances, catalogStatus, balanceStatus, mutationStatus
const balance = (account, saldoNativo, valorUsd = saldoNativo) => ({
  cuentaCustodiaId: account.id, saldoNativo, valorUsd,
  valoracionCompleta: true, conciliacion: 'confirmada', disponible: true,
})
const response = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  session.accountId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  session.user = { id: session.accountId }
  session.perfil = { rol: 'jefe', cuenta_id: session.accountId }
  catalog = { cuentas: ACCOUNTS.map(account => ({ ...account })), eliminadas: [] }
  balances = { schemaVersion: 1, conciliacionPendiente: false, cuentas: [balance(ACCOUNTS[0], -1000, -10), balance(ACCOUNTS[1], 500, 5)], noAsignados: [] }
  catalogStatus = 200
  balanceStatus = 200
  mutationStatus = 200
  authFetch.mockImplementation(async path => {
    if (path === '/api/finanzas/cuentas-custodia') return response(catalogStatus === 200 ? catalog : { error: 'Catalog unavailable' }, catalogStatus)
    if (path === '/api/finanzas/saldos') return response(balanceStatus === 200 ? balances : { error: 'Balances unavailable' }, balanceStatus)
    if (path.startsWith('/api/finanzas/cuentas-custodia/')) return response(mutationStatus === 200 ? { ok: true } : { error: 'Mutation rejected' }, mutationStatus)
    throw new Error(`Unexpected API route: ${path}`)
  })
})

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
})

function renderCustodia(movimientos = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } })
  clients.push(client)
  function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { ...renderHook(({ visible }) => useCuentasCustodia(visible), { wrapper: Wrapper, initialProps: { visible: movimientos } }), client }
}

async function ready(result) {
  await waitFor(() => {
    expect(result.current.cargando).toBe(false)
    expect(result.current.saldosCargando).toBe(false)
    expect(result.current.saldosError).toBe('')
    expect(result.current.cuentas.every(account => account.saldoConfirmado)).toBe(true)
  })
}

describe('useCuentasCustodia canonical account balances', () => {
  it('uses distinct custody UUIDs instead of duplicating a shared logical bank balance', async () => {
    const { result, client } = renderCustodia([])
    await ready(result)
    expect(result.current.cuentas[0]).toMatchObject({ id: ACCOUNTS[0].id, saldo: -1000, valorUsd: -10, saldoConfirmado: true, disponible: true })
    expect(result.current.cuentas[1]).toMatchObject({ id: ACCOUNTS[1].id, saldo: 500, valorUsd: 5, saldoConfirmado: true, disponible: true })
    expect(authFetch).toHaveBeenCalledWith('/api/finanzas/saldos', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(client.getQueryData(['account', session.accountId, 'finanzas', 'saldos'])).toEqual(balances)
    expect(client.getQueryData(['finanzas', 'saldos'])).toBeUndefined()
  })

  it('keeps the server balance of 75 rows ($7500) independent of 50 visible rows and filters', async () => {
    catalog = { cuentas: [{ ...ACCOUNTS[0], moneda: 'USD' }], eliminadas: [] }
    balances.cuentas = [balance(ACCOUNTS[0], 7500)]
    const visible = Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}`, cuenta_custodia_id: ACCOUNTS[0].id, cuenta_origen: ACCOUNTS[0].nombre, moneda: 'USD', tipo: 'ingreso', monto: 100, estado: 'activo' }))
    const { result, rerender } = renderCustodia(visible)
    await ready(result)
    expect(result.current.cuentas[0].saldo).toBe(7500)
    rerender({ visible: visible.slice(0, 1) })
    expect(result.current.cuentas[0].saldo).toBe(7500)
    rerender({ visible: [] })
    expect(result.current.cuentas[0].saldo).toBe(7500)
    expect(authFetch.mock.calls.filter(([path]) => path === '/api/finanzas/saldos')).toHaveLength(1)
  })

  it('does not turn unassigned visible movements into funds in a custody account', async () => {
    balances.cuentas = ACCOUNTS.map(account => balance(account, 0))
    const { result } = renderCustodia([{ tipo: 'ingreso', moneda: 'VES', monto: 800, estado: 'activo' }])
    await ready(result)
    expect(result.current.cuentas.map(account => account.saldo)).toEqual([0, 0])
  })

  it('respects an empty backend catalog without injecting default accounts', async () => {
    catalog = { cuentas: [], eliminadas: [] }
    balances.cuentas = []
    const { result } = renderCustodia()
    await ready(result)
    expect(result.current.cuentas).toEqual([])
    expect(authFetch).toHaveBeenCalledWith('/api/finanzas/cuentas-custodia', expect.any(Object))
  })

  it('keeps catalog errors visible and never inserts local seed accounts', async () => {
    catalogStatus = 503
    const { result } = renderCustodia()
    await waitFor(() => expect(result.current.error).toBe('Catalog unavailable'))
    expect(result.current.cuentas).toEqual([])
    expect(localStorage.length).toBe(0)
  })

  it('represents failed balance reads as null and unavailable, not zero', async () => {
    balanceStatus = 503
    const { result } = renderCustodia()
    await waitFor(() => expect(result.current.saldosError).toBe('Balances unavailable'))
    await waitFor(() => expect(result.current.cuentas).toHaveLength(2))
    for (const account of result.current.cuentas) {
      expect(account.saldo).toBeNull()
      expect(account.saldoConfirmado).toBe(false)
      expect(account.disponible).toBe(false)
      expect(account.conciliacion).toBe('pendiente')
    }
  })

  it.each([null, '', 'not-a-number'])('keeps a missing or invalid native amount unknown (%s)', async value => {
    balances.cuentas[0].saldoNativo = value
    const { result } = renderCustodia()
    await waitFor(() => expect(result.current.saldosCargando).toBe(false))
    await waitFor(() => expect(result.current.cuentas).toHaveLength(2))
    expect(result.current.cuentas[0]).toMatchObject({ saldo: null, saldoConfirmado: false, disponible: false })
  })

  it('withdraws availability when a refetch fails instead of retaining confirmed stale funds', async () => {
    const { result } = renderCustodia()
    await ready(result)
    balanceStatus = 503
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.saldosError).toBe('Balances unavailable'))
    expect(result.current.cuentas.every(account => account.saldo === null && !account.disponible)).toBe(true)
  })

  it('does not make balances spendable while reconciliation is pending', async () => {
    balances.conciliacionPendiente = true
    const { result } = renderCustodia()
    await waitFor(() => expect(result.current.saldosCargando).toBe(false))
    await waitFor(() => expect(result.current.cuentas).toHaveLength(2))
    expect(result.current.conciliacionPendiente).toBe(true)
    expect(result.current.cuentas.every(account => !account.saldoConfirmado && !account.disponible)).toBe(true)
  })

  it.each(['create', 'update', 'delete', 'restore'])('does not create ghost catalog changes after a rejected %s mutation', async operation => {
    const { result, client } = renderCustodia()
    await ready(result)
    const before = client.getQueryData(['account', session.accountId, 'finanzas', 'cuentas-custodia'])
    mutationStatus = 409
    const actions = {
      create: () => result.current.agregarCuenta({ nombre: 'Ghost account', moneda: 'USD' }),
      update: () => result.current.editarCuenta(ACCOUNTS[0].id, { nombre: 'Ghost rename' }),
      delete: () => result.current.eliminarCuenta(ACCOUNTS[0].id),
      restore: () => result.current.restaurarCuentaEliminada('33333333-3333-4333-8333-333333333333'),
    }
    await act(async () => { await expect(actions[operation]()).rejects.toThrow('Mutation rejected') })
    expect(client.getQueryData(['account', session.accountId, 'finanzas', 'cuentas-custodia'])).toEqual(before)
    expect(result.current.cuentas.map(account => account.nombre)).toEqual(ACCOUNTS.map(account => account.nombre))
    expect(result.current.cuentasEliminadas).toEqual([])
    expect(localStorage.length).toBe(0)
    expect(showToast.error).toHaveBeenCalledWith('Mutation rejected')
    expect(showToast.success).not.toHaveBeenCalled()
  })

  it('exposes confirmed discard and empty-trash mutations', async () => {
    const { result } = renderCustodia()
    await ready(result)
    await act(async () => {
      await expect(result.current.descartarCuentaEliminada(ACCOUNTS[0].id)).resolves.toEqual({ ok: true })
      await expect(result.current.vaciarPapelera()).resolves.toEqual({ ok: true })
    })
    const bodies = authFetch.mock.calls.filter(([path]) => path.endsWith('/descartar')).map(([, options]) => JSON.parse(options.body))
    expect(bodies).toEqual([{ id: ACCOUNTS[0].id, todos: false }, { todos: true }])
  })

  it('finanzas carga cuentas operativas sin consultar saldos ni exponer disponibilidad', async () => {
    session.perfil = { rol: 'finanzas', cuenta_id: session.accountId }
    const { result } = renderCustodia()
    await waitFor(() => expect(result.current.cuentas).toHaveLength(2))
    expect(result.current.cuentas[0]).toMatchObject({ id: ACCOUNTS[0].id, nombre: 'Banco BNC', saldo: null, saldoConfirmado: false, disponible: false, valorUsd: null, valoracionCompleta: false })
    expect(result.current.saldos).toBeNull()
    expect(result.current.saldosError).toBe('')
    expect(authFetch).toHaveBeenCalledWith('/api/finanzas/cuentas-custodia', expect.any(Object))
    expect(authFetch).not.toHaveBeenCalledWith('/api/finanzas/saldos', expect.anything())
  })

  it('does not query private catalog or balances without an authenticated account', () => {
    session.accountId = null
    session.user = null
    session.perfil = { rol: 'jefe' }
    const { result } = renderCustodia()
    expect(authFetch).not.toHaveBeenCalled()
    expect(result.current.cuentas).toEqual([])
  })
})
