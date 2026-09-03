// server/handlers/__tests__/finanzas.revertir.test.js
// Reversibilidad: revertir anulación de movimientos y eliminar/restaurar categorías.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../finanzas.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const anulado = {
  id: IDS.linea,
  fecha: '2026-08-18', tipo: 'egreso', categoria: 'Proveedores', concepto: 'Cemento',
  monto: 100, moneda: 'USD', tasa_ves: 120, monto_ves: 12000,
  fuente_tasa: 'MANUAL', estado: 'anulado', creado_en: '2026-08-18T12:00:00Z',
  anulado_en: '2026-08-19T12:00:00Z', anulado_por: OPERADORES.administracion.id,
  motivo_anulacion: 'Registro duplicado', anulacion_idempotency_key: 'anulacion-test-000000001',
}

describe('finanzas — revertir anulación', () => {
  it('revierte un movimiento anulado a activo y limpia los campos de anulación', async () => {
    let patch
    mock = installFetchMock([
      { match: `finanzas_movimientos?id=eq.${IDS.linea}`, method: 'GET', respond: [anulado] },
      {
        match: `finanzas_movimientos?id=eq.${IDS.linea}`,
        method: 'PATCH',
        respond: (url, init) => {
          patch = JSON.parse(init.body)
          return [{ ...anulado, ...patch }]
        },
      },
    ])
    const response = await H.handleRevertirAnulacionMovimiento(makeRequest({ id: IDS.linea }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.movimiento.estado).toBe('activo')
    expect(patch.estado).toBe('activo')
    expect(patch.anulado_en).toBeNull()
    expect(patch.anulado_por).toBeNull()
    expect(patch.motivo_anulacion).toBeNull()
    expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
  })

  it('revertir un movimiento ya activo es idempotente', async () => {
    mock = installFetchMock([
      { match: `finanzas_movimientos?id=eq.${IDS.linea}`, method: 'GET', respond: [{ ...anulado, estado: 'activo' }] },
    ])
    const response = await H.handleRevertirAnulacionMovimiento(makeRequest({ id: IDS.linea }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.idempotente).toBe(true)
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
  })

  it('rechaza id inválido antes de tocar Supabase', async () => {
    mock = installFetchMock([])
    const response = await H.handleRevertirAnulacionMovimiento(makeRequest({ id: 'no-es-uuid' }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })

  it('bloquea la reversión para roles que no son administración', async () => {
    operadorActual = OPERADORES.vendedor
    mock = installFetchMock([])
    const response = await H.handleRevertirAnulacionMovimiento(makeRequest({ id: IDS.linea }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })
})

describe('finanzas — categorías reversibles', () => {
  const catId = '70000000-0000-4000-8000-000000000001'

  it('elimina (baja lógica) una categoría propia sin DELETE físico', async () => {
    let patch
    mock = installFetchMock([
      { match: '/finanzas_categorias', method: 'GET', respond: [{ id: catId, nombre: 'Mi categoría', activo: true }] },
      {
        match: '/finanzas_categorias',
        method: 'PATCH',
        respond: (url, init) => {
          patch = JSON.parse(init.body)
          return [{ id: catId, nombre: 'Mi categoría', activo: false }]
        },
      },
    ])
    const response = await H.handleEliminarFinanzasCategoria(makeRequest({ id: catId }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(patch.activo).toBe(false)
    expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
  })

  it('rechaza eliminar una categoría predeterminada del sistema', async () => {
    mock = installFetchMock([
      { match: '/finanzas_categorias', method: 'GET', respond: [{ id: catId, nombre: 'Ventas', activo: true }] },
    ])
    const response = await H.handleEliminarFinanzasCategoria(makeRequest({ id: catId }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/predeterminada/i)
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
  })

  it('restaura una categoría eliminada (activo=false → true)', async () => {
    let patch
    mock = installFetchMock([
      {
        match: '/finanzas_categorias',
        method: 'PATCH',
        respond: (url, init) => {
          patch = JSON.parse(init.body)
          return [{ id: catId, nombre: 'Mi categoría', activo: true }]
        },
      },
    ])
    const response = await H.handleRestaurarFinanzasCategoria(makeRequest({ id: catId }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(patch.activo).toBe(true)
  })

  it('devuelve 404 al restaurar una categoría de otra cuenta (aislamiento)', async () => {
    mock = installFetchMock([
      { match: '/finanzas_categorias', method: 'PATCH', respond: [] },
    ])
    const response = await H.handleRestaurarFinanzasCategoria(makeRequest({ id: catId }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(404)
  })
})
