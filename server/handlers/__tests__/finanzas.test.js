// server/handlers/__tests__/finanzas.test.js
// Flujo E2E de Finanzas contra fetch declarado: sin red ni secretos reales.
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

const movementInput = {
  fecha: '2026-08-18', tipo: 'egreso', categoria: 'Proveedores', concepto: 'Cemento',
  monto: 100, moneda: 'USD', tasaVes: 120, fuenteTasa: 'MANUAL',
  observacionTasa: 'Aprobada por administración', idempotencyKey: 'movimiento-test-0001',
}

const movement = {
  id: IDS.linea, ...movementInput, tasa_ves: 120, monto_ves: 12000,
  fuente_tasa: 'MANUAL', estado: 'activo', creado_en: '2026-08-18T12:00:00Z',
}

describe('finanzas — guardrails de administración', () => {
  it('rechaza cualquier operador distinto de administración antes de consultar', async () => {
    operadorActual = OPERADORES.logistica
    mock = installFetchMock([])
    const response = await H.handleGetFinanzasCategorias(makeRequest(), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(403)
    expect(result.body.error).toMatch(/administración/i)
    expect(mock.calls).toHaveLength(0)
  })

  it('rechaza movimiento inválido sin tocar Supabase', async () => {
    mock = installFetchMock([])
    const response = await H.handleCrearFinanzasMovimiento(makeRequest({ ...movementInput, monto: -1 }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/monto/i)
    expect(mock.calls).toHaveLength(0)
  })
})

describe('finanzas — flujo crear, reportar y anular', () => {
  it('crea un movimiento con cuenta, tasa e idempotencia server-side', async () => {
    let sent
    mock = installFetchMock([
      { match: 'idempotency_key=eq.movimiento-test-0001', method: 'GET', respond: [] },
      { match: '/finanzas_movimientos', method: 'POST', respond: (url, init) => { sent = JSON.parse(init.body); return [movement] } },
    ])
    const response = await H.handleCrearFinanzasMovimiento(makeRequest(movementInput), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(201)
    expect(result.body.movimiento.monto_ves).toBe(12000)
    expect(sent.cuenta_id).toBe(OPERADORES.administracion.cuenta_id)
    expect(sent.creado_por).toBe(OPERADORES.administracion.id)
    expect(sent).not.toHaveProperty('monto_ves')
  })

  it('reintento con la misma idempotency key no crea otra fila', async () => {
    mock = installFetchMock([
      { match: 'idempotency_key=eq.movimiento-test-0001', method: 'GET', respond: [movement] },
    ])
    const response = await H.handleCrearFinanzasMovimiento(makeRequest(movementInput), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.idempotente).toBe(true)
    expect(mock.calls.filter(call => call.method === 'POST')).toHaveLength(0)
  })

  it('resume por RPC acotado al tenant y rango', async () => {
    mock = installFetchMock([
      { match: '/rpc/finanzas_resumen', method: 'POST', respond: [
        { tipo: 'egreso', categoria: 'Proveedores', total_ves: 120, movimientos: 1 },
      ] },
    ])
    const request = makeRequest(undefined, { url: 'http://worker.test/api/finanzas/reportes/resumen?desde=2026-08-01&hasta=2026-08-31&moneda=USD&tipo=egreso&categoria=Proveedores' })
    const response = await H.handleGetFinanzasResumen(request, ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.resumen.balance_ves).toBe(-120)
    expect(mock.calls[0].body.p_cuenta_id).toBe(OPERADORES.administracion.cuenta_id)
    expect(mock.calls[0].body.p_desde).toBe('2026-08-01')
    expect(mock.calls[0].body.p_tipo).toBe('egreso')
    expect(mock.calls[0].body.p_categoria).toBe('Proveedores')
  })

  it('anula sin borrar y conserva la trazabilidad', async () => {
    let patch
    mock = installFetchMock([
      { match: `finanzas_movimientos?id=eq.${IDS.linea}`, method: 'GET', respond: [movement] },
      { match: `finanzas_movimientos?id=eq.${IDS.linea}`, method: 'PATCH', respond: (url, init) => { patch = JSON.parse(init.body); return [{ ...movement, ...patch }] } },
    ])
    const response = await H.handleAnularFinanzasMovimiento(makeRequest({ id: IDS.linea, motivo: 'Registro duplicado', idempotencyKey: 'anulacion-test-0001' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.movimiento.estado).toBe('anulado')
    expect(patch.estado).toBe('anulado')
    expect(patch.motivo_anulacion).toBe('Registro duplicado')
    expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
  })

  it('lista movimientos con rango, tenant, tipo, categoria, moneda y mostrarAnulados', async () => {
    mock = installFetchMock([
      { match: '/finanzas_movimientos', method: 'GET', respond: [movement] },
    ])
    const request = makeRequest(undefined, {
      url: 'http://worker.test/api/finanzas/movimientos?desde=2026-08-01&hasta=2026-08-31&tipo=egreso&categoria=Proveedores&moneda=USD&mostrarAnulados=true&limit=50',
    })
    const response = await H.handleGetFinanzasMovimientos(request, ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.movimientos).toHaveLength(1)
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
    expect(mock.calls[0].url).toContain('tipo=eq.egreso')
    expect(mock.calls[0].url).toContain('categoria=eq.Proveedores')
    expect(mock.calls[0].url).toContain('moneda=eq.USD')
    expect(mock.calls[0].url).not.toContain('estado=eq.activo') // when mostrarAnulados is true
    expect(mock.calls[0].url).toContain('limit=50')
    expect(mock.calls[0].url).not.toContain('select=*')
  })

  it('rechaza rangos y paginación inválidos antes de consultar', async () => {
    mock = installFetchMock([])
    const badRange = await H.handleGetFinanzasMovimientos(makeRequest(undefined, {
      url: 'http://worker.test/api/finanzas/movimientos?desde=2026-09-01&hasta=2026-08-31',
    }), ENV)
    const badPage = await H.handleGetFinanzasMovimientos(makeRequest(undefined, {
      url: 'http://worker.test/api/finanzas/movimientos?desde=2026-08-01&hasta=2026-08-31&limit=101',
    }), ENV)
    expect((await readResponse(badRange)).status).toBe(400)
    expect((await readResponse(badPage)).status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })

  it('rechaza anulación sin clave idempotente válida antes de leer el movimiento', async () => {
    mock = installFetchMock([])
    const response = await H.handleAnularFinanzasMovimiento(makeRequest({
      id: IDS.linea,
      motivo: 'Duplicado',
      idempotencyKey: 'corta',
    }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/idempotency/i)
    expect(mock.calls).toHaveLength(0)
  })

  it('lista categorías del tenant y completa las predeterminadas sin insertar filas', async () => {
    mock = installFetchMock([
      {
        match: '/finanzas_categorias',
        method: 'GET',
        respond: (url) => {
          // La segunda consulta (papelera) filtra activo=eq.false
          if (String(url).includes('activo=eq.false')) return []
          return [{ id: IDS.config, nombre: 'Obra propia', tipo: 'egreso', activo: true }]
        },
      },
      {
        match: '/finanzas_movimientos',
        method: 'GET',
        respond: () => [{ categoria: 'Obra propia' }, { categoria: 'Obra propia' }],
      },
    ])
    const response = await H.handleGetFinanzasCategorias(makeRequest(), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    const obraPropia = result.body.categorias.find(item => item.nombre === 'Obra propia')
    expect(obraPropia).toBeTruthy()
    expect(obraPropia.movimientos_count).toBe(2)
    expect(result.body.categorias.some(item => item.nombre === 'Ventas' && item.predeterminada)).toBe(true)
    expect(result.body.eliminadas).toEqual([])
    // Tres lecturas: activas + papelera de eliminadas + conteo de movimientos históricos
    expect(mock.calls).toHaveLength(3)
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
    expect(mock.calls[1].url).toContain('activo=eq.false')
    expect(mock.calls[2].url).toContain('/finanzas_movimientos')
  })

  it('crea una categoría con tenant y actor administrativo', async () => {
    let sent
    mock = installFetchMock([{
      match: '/finanzas_categorias',
      method: 'POST',
      respond: (url, init) => { sent = JSON.parse(init.body); return [{ id: IDS.config, nombre: 'Alquiler', tipo: 'egreso' }] },
    }])
    const response = await H.handleCrearFinanzasCategoria(makeRequest({ nombre: '  Alquiler  ', tipo: 'egreso' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(201)
    expect(sent).toMatchObject({ cuenta_id: OPERADORES.administracion.cuenta_id, creado_por: OPERADORES.administracion.id, nombre: 'Alquiler' })
  })
})
