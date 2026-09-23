// @vitest-environment jsdom
// Compuertas de rol del frontend: cada consulta se habilita por CAPACIDAD de la
// matriz única (server/lib/permissions.js vía config/accesoModulos.js), nunca
// por una lista de roles local. Este test fija las reglas del negocio tal como
// las ve el usuario: finanzas nunca ve saldos ni nómina; nomina nunca ve
// finanzas; jefe ve todo.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const session = vi.hoisted(() => ({
  accountId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  user: { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  perfil: { rol: 'administracion', cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
}))

vi.mock('../../../compat/services/authFetch.js', () => ({
  authFetch: vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
}))
vi.mock('../../../compat/components/ui/toastBus.js', () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../../compat/store/useAuthStore.js', () => {
  const useAuthStore = vi.fn(selector => (selector ? selector(session) : session))
  useAuthStore.getState = () => session
  return { default: useAuthStore }
})

import { authFetch } from '../../../compat/services/authFetch.js'
import { useCuentasCustodia } from '../useCuentasCustodia.js'
import { useNominaEmpleados } from '../useNomina.js'
import { useFinanzasCategorias } from '../useFinanzas.js'

function renderCompuerta(useHook) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(useHook, { wrapper })
}

/** Rutas consultadas (el segundo argumento varía: signal, opciones…). */
function rutas() {
  return authFetch.mock.calls.map(([path]) => path)
}

async function sinConsultas() {
  // Un tick para que cualquier efecto pendiente se ejecute antes de afirmar.
  await act(async () => { await Promise.resolve() })
  expect(rutas()).toEqual([])
}

beforeEach(() => {
  vi.clearAllMocks()
  session.accountId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  session.user = { id: session.accountId }
  session.perfil = { rol: 'administracion', cuenta_id: session.accountId }
})

describe('compuertas de módulo por capacidad (matriz única)', () => {
  it.each(['finanzas', 'nomina'])('el rol %s consulta solo el catálogo mínimo, nunca saldos (verSaldos)', async rol => {
    session.perfil = { rol, cuenta_id: session.accountId }
    renderCompuerta(() => useCuentasCustodia())
    await waitFor(() => expect(rutas()).toContain('/api/finanzas/cuentas-custodia'))
    expect(rutas()).not.toContain('/api/finanzas/saldos')
  })

  it.each(['finanzas', 'logistica', 'vendedor'])('el rol %s nunca consulta empleados de nómina (verNomina)', async rol => {
    session.perfil = { rol, cuenta_id: session.accountId }
    renderCompuerta(() => useNominaEmpleados({}))
    await sinConsultas()
  })

  it.each(['nomina', 'logistica', 'vendedor'])('el rol %s nunca consulta el libro financiero (verFinanzas)', async rol => {
    session.perfil = { rol, cuenta_id: session.accountId }
    renderCompuerta(() => useFinanzasCategorias())
    await sinConsultas()
  })

  it('nomina consulta nómina y no consulta finanzas', async () => {
    session.perfil = { rol: 'nomina', cuenta_id: session.accountId }
    renderCompuerta(() => useNominaEmpleados({}))
    await waitFor(() => expect(rutas()).toContain('/api/nomina/empleados'))
    expect(rutas()).not.toContain('/api/finanzas/categorias')
  })

  it('finanzas consulta el libro y el catálogo operativo, pero no saldos ni nómina', async () => {
    session.perfil = { rol: 'finanzas', cuenta_id: session.accountId }
    renderCompuerta(() => useCuentasCustodia())
    renderCompuerta(() => useFinanzasCategorias())
    await waitFor(() => expect(rutas()).toContain('/api/finanzas/categorias'))
    expect(rutas()).toContain('/api/finanzas/cuentas-custodia')
    expect(rutas()).not.toContain('/api/finanzas/saldos')
    expect(rutas()).not.toContain('/api/nomina/empleados')
  })

  it('jefe consulta nómina, libro y custodia (acceso total)', async () => {
    session.perfil = { rol: 'jefe', cuenta_id: session.accountId }
    renderCompuerta(() => useCuentasCustodia([]))
    await waitFor(() => expect(rutas()).toContain('/api/finanzas/cuentas-custodia'))
    renderCompuerta(() => useNominaEmpleados({}))
    await waitFor(() => expect(rutas()).toContain('/api/nomina/empleados'))
    renderCompuerta(() => useFinanzasCategorias())
    await waitFor(() => expect(rutas()).toContain('/api/finanzas/categorias'))
  })
})
