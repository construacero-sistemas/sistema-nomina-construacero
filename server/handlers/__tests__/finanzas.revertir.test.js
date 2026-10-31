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

  it('al crear un nombre archivado reactiva la fila en vez de responder "ya existe"', async () => {
    let patch
    const archivada = { id: catId, nombre: 'Mantenimiento', tipo: 'ambos', activo: false }
    mock = installFetchMock([
      {
        match: '/finanzas_categorias',
        method: 'POST',
        respond: { __raw: 'duplicate key value violates unique constraint "finanzas_categorias_cuenta_id_nombre_key"', ok: false, status: 409 },
      },
      { match: '/finanzas_categorias', method: 'GET', respond: [archivada] },
      {
        match: '/finanzas_categorias',
        method: 'PATCH',
        respond: (url, init) => {
          patch = JSON.parse(init.body)
          return [{ ...archivada, ...patch }]
        },
      },
    ])
    const response = await H.handleCrearFinanzasCategoria(makeRequest({ nombre: 'Mantenimiento', tipo: 'egreso' }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.reactivada).toBe(true)
    expect(result.body.categoria).toMatchObject({ id: catId, nombre: 'Mantenimiento', tipo: 'egreso', activo: true })
    expect(patch).toEqual({ activo: true, tipo: 'egreso' })
    expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
  })

  it('al crear un nombre que ya está activo responde 409 sin tocar la fila', async () => {
    mock = installFetchMock([
      {
        match: '/finanzas_categorias',
        method: 'POST',
        respond: { __raw: 'duplicate key value violates unique constraint "finanzas_categorias_cuenta_id_nombre_key"', ok: false, status: 409 },
      },
      { match: '/finanzas_categorias', method: 'GET', respond: [{ id: catId, nombre: 'Mantenimiento', tipo: 'ambos', activo: true }] },
    ])
    const response = await H.handleCrearFinanzasCategoria(makeRequest({ nombre: 'Mantenimiento', tipo: 'egreso' }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/ya existe/i)
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
  })

  it('renombra una categoría activa sin tocar movimientos históricos', async () => {
    let patch
    mock = installFetchMock([
      { match: '/finanzas_categorias', method: 'GET', respond: [{ id: catId, nombre: 'Personal', tipo: 'egreso', activo: true }] },
      {
        match: '/finanzas_categorias',
        method: 'PATCH',
        respond: (url, init) => {
          patch = JSON.parse(init.body)
          return [{ id: catId, nombre: patch.nombre, tipo: 'egreso', activo: true }]
        },
      },
    ])
    const response = await H.handleRenombrarFinanzasCategoria(makeRequest({ id: catId, nombre: '  Nómina extra  ' }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.categoria.nombre).toBe('Nómina extra')
    expect(patch).toEqual({ nombre: 'Nómina extra' })
    expect(mock.calls.some(call => call.url.includes('/finanzas_movimientos'))).toBe(false)
    expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
  })

  it('renombrar a un nombre ya existente responde 409', async () => {
    mock = installFetchMock([
      { match: '/finanzas_categorias', method: 'GET', respond: [{ id: catId, nombre: 'Personal', tipo: 'egreso', activo: true }] },
      {
        match: '/finanzas_categorias',
        method: 'PATCH',
        respond: { __raw: 'duplicate key value violates unique constraint "finanzas_categorias_cuenta_id_nombre_key"', ok: false, status: 409 },
      },
    ])
    const response = await H.handleRenombrarFinanzasCategoria(makeRequest({ id: catId, nombre: 'Nómina' }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/ya existe/i)
  })

  it('no renombra categorías predeterminadas del sistema', async () => {
    mock = installFetchMock([
      { match: '/finanzas_categorias', method: 'GET', respond: [{ id: catId, nombre: 'Ventas', tipo: 'ingreso', activo: true }] },
    ])
    const response = await H.handleRenombrarFinanzasCategoria(makeRequest({ id: catId, nombre: 'Ventas 2' }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(400)
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
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
