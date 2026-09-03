// server/handlers/__tests__/cuentasCustodia.test.js
// Tests del CRUD de cuentas de custodia persistidas en Supabase — sin red ni secretos reales.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'
import {
  handleGetCuentasCustodia,
  handleCrearCuentaCustodia,
  handleActualizarCuentaCustodia,
  handleEliminarCuentaCustodia,
  handleRestaurarCuentasCustodia,
  handleRestaurarUnaCuentaCustodia,
  handleDescartarCuentaCustodia,
} from '../cuentasCustodia.js'
import { CUENTAS_DEFAULT, CAJAS_PERMANENTES } from '../../lib/cuentasCustodiaUtils.js'

let operadorActual = OPERADORES.administracion
let mock

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: vi.fn(() => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' })),
}))

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
})

function urlBase() {
  return `${ENV.SUPABASE_URL}/rest/v1`
}

const CUENTA_FILA = {
  id: 'c1111111-1111-4111-8111-111111111111',
  codigo: 'banco-bnc-ves',
  nombre: 'Banco BNC (Principal)',
  tipo: 'banco_ves',
  cartera: 'VES',
  moneda: 'VES',
  banco: 'BNC (Banco Nacional de Crédito)',
  numero_cuenta: '0191-0001-23-4567890123',
  titular: 'Construacero C.A.',
  identificacion: 'J-12345678-9',
  subcuenta_id: 'Banco en Bolívares',
  predeterminada: true,
  activo: true,
  creado_en: '2026-09-02T10:00:00Z',
}

describe('cuentas de custodia', () => {
  it('GET siembra las cuentas por defecto cuando el tenant aún no tiene filas', async () => {
    const fetched = { primera: true }
    mock = installFetchMock([
      // 1º GET (activas): vacío · 2º GET (select=id): vacío (nunca hubo filas) · 3º GET: con seed
      { match: '/cuentas_custodia?cuenta_id', method: 'GET', respond: (url) => {
        if (String(url).includes('select=id&limit=1')) return []
        if (fetched.primera) { fetched.primera = false; return [] }
        return [CUENTA_FILA]
      } },
      // POST de seed
      { match: '/cuentas_custodia', method: 'POST', respond: [] },
    ])
    const res = await handleGetCuentasCustodia(makeRequest(undefined, { url: `${urlBase()}/finanzas/cuentas-custodia` }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.cuentas).toHaveLength(1)
    expect(body.cuentas[0].nombre).toBe('Banco BNC (Principal)')
    // Se hizo el seed (al menos un POST)
    const postCalls = mock.calls.filter(c => c.method === 'POST' && String(c.url).includes('/cuentas_custodia'))
    expect(postCalls.length).toBeGreaterThan(0)
    // El seed envía SOLO las 2 cajas físicas (sin bancos demo con datos falsos)
    expect(postCalls[0].body).toHaveLength(2)
    expect(postCalls[0].body.map(c => c.codigo).sort()).toEqual([...CAJAS_PERMANENTES].sort())
  })

  it('GET NO re-sembrar cuando el tenant ELIMINÓ todas sus cuentas (hay filas inactivas)', async () => {
    mock = installFetchMock([
      // 1º GET (activas): vacío · 2º GET (select=id): HAY una fila (inactiva) → no seed
      { match: '/cuentas_custodia?cuenta_id', method: 'GET', respond: (url) => {
        if (String(url).includes('select=id&limit=1')) return [{ id: CUENTA_FILA.id }]
        return []
      } },
    ])
    const res = await handleGetCuentasCustodia(makeRequest(undefined, { url: `${urlBase()}/finanzas/cuentas-custodia` }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    // Lista vacía respetada: la decisión del tenant de no tener cuentas
    expect(body.cuentas).toHaveLength(0)
    // No hubo POST de seed
    expect(mock.calls.some(c => c.method === 'POST' && String(c.url).includes('/cuentas_custodia'))).toBe(false)
  })

  it('GET devuelve solo las cuentas ACTIVAS sin re-sembrar si ya hay filas', async () => {
    mock = installFetchMock([
      { match: '/cuentas_custodia?cuenta_id', method: 'GET', respond: [CUENTA_FILA] },
    ])
    const res = await handleGetCuentasCustodia(makeRequest(undefined, { url: `${urlBase()}/finanzas/cuentas-custodia` }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.cuentas).toHaveLength(1)
    // No hubo POST de seed
    expect(mock.calls.some(c => c.method === 'POST' && String(c.url).includes('/cuentas_custodia'))).toBe(false)
  })

  it('POST /crear crea una cuenta y la devuelve', async () => {
    mock = installFetchMock([
      { match: '/cuentas_custodia', method: 'POST', respond: [{ ...CUENTA_FILA, id: 'c2222222-2222-4222-8222-222222222222', codigo: null, nombre: 'Banesco', banco: 'Banesco', predeterminada: false }] },
      { match: '/auditoria', method: 'POST', respond: [] },
      { match: '/usuarios', respond: [] },
    ])
    const body = {
      nombre: 'Banesco',
      tipo: 'banco_ves',
      moneda: 'VES',
      cartera: 'VES',
      banco: 'Banesco',
      numeroCuenta: '0134-0001-23-4567890123',
      subcuentaId: 'Banco en Bolívares',
    }
    const res = await handleCrearCuentaCustodia(makeRequest(body, { url: `${urlBase()}/finanzas/cuentas-custodia/crear` }), ENV)
    const { status, body: resp } = await readResponse(res)
    expect(status).toBe(201)
    expect(resp.ok).toBe(true)
    expect(resp.cuenta.nombre).toBe('Banesco')
    expect(resp.cuenta.predeterminada).toBe(false)
  })

  it('POST /crear valida payload inválido', async () => {
    mock = installFetchMock([])
    const res = await handleCrearCuentaCustodia(
      makeRequest({ nombre: '', tipo: 'banco_ves' }, { url: `${urlBase()}/finanzas/cuentas-custodia/crear` }),
      ENV,
    )
    const { status } = await readResponse(res)
    expect(status).toBe(400)
  })

  it('POST /actualizar actualiza una cuenta existente', async () => {
    mock = installFetchMock([
      { match: '/cuentas_custodia?', method: 'PATCH', respond: [{ ...CUENTA_FILA, nombre: 'Banco BNC (Actualizado)' }] },
      { match: '/auditoria', method: 'POST', respond: [] },
      { match: '/usuarios', respond: [] },
    ])
    const res = await handleActualizarCuentaCustodia(
      makeRequest({ id: CUENTA_FILA.id, nombre: 'Banco BNC (Actualizado)', tipo: 'banco_ves', moneda: 'VES', cartera: 'VES', subcuentaId: 'Banco en Bolívares' }, { url: `${urlBase()}/finanzas/cuentas-custodia/actualizar` }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.cuenta.nombre).toBe('Banco BNC (Actualizado)')
  })

  it('POST /eliminar hace borrado lógico (PATCH activo=false) y no destruye datos', async () => {
    mock = installFetchMock([
      // Lookup previo: cuenta no permanente
      { match: '/cuentas_custodia?id=', method: 'GET', respond: [{ tipo: 'banco_ves', codigo: 'banco-bnc-ves' }] },
      { match: '/cuentas_custodia?', method: 'PATCH', respond: (url, init) => {
        expect(JSON.parse(init.body).activo).toBe(false)
        return []
      } },
      { match: '/auditoria', method: 'POST', respond: [] },
      { match: '/usuarios', respond: [] },
    ])
    const res = await handleEliminarCuentaCustodia(
      makeRequest({ id: CUENTA_FILA.id }, { url: `${urlBase()}/finanzas/cuentas-custodia/eliminar` }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('POST /eliminar BLOQUEA las cajas físicas permanentes (Bs y $) con 403', async () => {
    mock = installFetchMock([
      // Lookup previo: es una de las cajas permanentes
      { match: '/cuentas_custodia?id=', method: 'GET', respond: [{ tipo: 'efectivo_ves', codigo: 'caja-efectivo-bs' }] },
    ])
    const res = await handleEliminarCuentaCustodia(
      makeRequest({ id: CUENTA_FILA.id }, { url: `${urlBase()}/finanzas/cuentas-custodia/eliminar` }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(403)
    expect(body.error).toMatch(/permanentes/i)
    // Nunca llegó a hacer el PATCH de borrado
    expect(mock.calls.some(c => c.method === 'PATCH')).toBe(false)
  })

  it('POST /eliminar PERMITE borrar una caja EXTRA del usuario (sin codigo semilla)', async () => {
    mock = installFetchMock([
      // Lookup previo: caja extra creada por el usuario (codigo null)
      { match: '/cuentas_custodia?id=', method: 'GET', respond: [{ tipo: 'efectivo_usd', codigo: null }] },
      { match: '/cuentas_custodia?', method: 'PATCH', respond: [] },
      { match: '/auditoria', method: 'POST', respond: [] },
      { match: '/usuarios', respond: [] },
    ])
    const res = await handleEliminarCuentaCustodia(
      makeRequest({ id: CUENTA_FILA.id }, { url: `${urlBase()}/finanzas/cuentas-custodia/eliminar` }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('POST /restaurar reactiva las cajas físicas semilla', async () => {
    mock = installFetchMock([
      { match: '/cuentas_custodia?cuenta_id', method: 'GET', respond: [CUENTA_FILA] },
      { match: '/cuentas_custodia?cuenta_id&codigo', method: 'GET', respond: [{ id: CUENTA_FILA.id }] },
      { match: '/cuentas_custodia?id=', method: 'PATCH', respond: () => { /* reactivar */ return [] } },
      { match: '/cuentas_custodia', method: 'POST', respond: [] },
      { match: '/auditoria', method: 'POST', respond: [] },
      { match: '/usuarios', respond: [] },
    ])
    const res = await handleRestaurarCuentasCustodia(makeRequest({}, { url: `${urlBase()}/finanzas/cuentas-custodia/restaurar` }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.cuentas).toHaveLength(1)
  })

  it('deniega a un rol no administrador', async () => {
    operadorActual = OPERADORES.supervisor
    mock = installFetchMock([])
    const res = await handleGetCuentasCustodia(makeRequest(undefined, { url: `${urlBase()}/finanzas/cuentas-custodia` }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(403)
  })

  it('POST /restaurar-una reactiva una cuenta eliminada concreta (reversible)', async () => {
    let patch
    mock = installFetchMock([
      {
        match: '/cuentas_custodia?id=',
        method: 'PATCH',
        respond: (url, init) => {
          patch = JSON.parse(init.body)
          return [{ ...CUENTA_FILA, activo: true }]
        },
      },
      { match: '/auditoria', method: 'POST', respond: [] },
    ])
    const res = await handleRestaurarUnaCuentaCustodia(
      makeRequest({ id: CUENTA_FILA.id }, { url: `${urlBase()}/finanzas/cuentas-custodia/restaurar-una` }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.cuenta.activo).toBe(true)
    expect(patch.activo).toBe(true)
  })

  it('POST /restaurar-una rechaza id inválido y devuelve 404 si la cuenta es de otra cuenta_id', async () => {
    mock = installFetchMock([
      { match: '/cuentas_custodia?id=', method: 'PATCH', respond: [] },
    ])
    // id inválido: 400 sin llamar a Supabase
    const resBad = await handleRestaurarUnaCuentaCustodia(
      makeRequest({ id: 'no-es-uuid' }, { url: `${urlBase()}/finanzas/cuentas-custodia/restaurar-una` }),
      ENV,
    )
    const { status: s1 } = await readResponse(resBad)
    expect(s1).toBe(400)
    // cuenta de otro tenant: el PATCH filtrado no encuentra filas → 404
    const res404 = await handleRestaurarUnaCuentaCustodia(
      makeRequest({ id: CUENTA_FILA.id }, { url: `${urlBase()}/finanzas/cuentas-custodia/restaurar-una` }),
      ENV,
    )
    const { status: s2 } = await readResponse(res404)
    expect(s2).toBe(404)
  })

  it('POST /descartar elimina físicamente cuentas inactivas (papelera vaciada)', async () => {
    mock = installFetchMock([
      { match: '/cuentas_custodia?', method: 'DELETE', respond: [] },
      { match: '/auditoria', method: 'POST', respond: [] },
    ])
    const res = await handleDescartarCuentaCustodia(
      makeRequest({ todos: true }, { url: `${urlBase()}/finanzas/cuentas-custodia/descartar` }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.descartadas).toBe(true)
  })

  it('POST /descartar con id específico elimina solo esa cuenta', async () => {
    mock = installFetchMock([
      { match: '/cuentas_custodia?id=', method: 'DELETE', respond: [] },
      { match: '/auditoria', method: 'POST', respond: [] },
    ])
    const res = await handleDescartarCuentaCustodia(
      makeRequest({ id: CUENTA_FILA.id }, { url: `${urlBase()}/finanzas/cuentas-custodia/descartar` }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })
})
