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
const M = await import('../finanzas.periodos.js')
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
  cuenta_custodia_id: IDS.config,
}

describe('finanzas — períodos mensuales de tesorería', () => {
  const monthlyRequest = (body, url = 'http://worker.test/api/finanzas/periodos-mensuales/operar') => makeRequest(body, { url })
  const payload = { cuentas: [{ cuentaCustodiaId: IDS.config, metodo: 'saldo_real', saldoReal: '100', tasaUsdVes: '400', tasaUsdtVes: '450' }], tasaUsdVes: '400', tasaUsdtVes: '450' }

  it('consulta estado mensual con tenant del operador y valida el contrato RPC', async () => {
    mock = installFetchMock([{ match: '/rpc/finanzas_periodo_mensual_estado', method: 'POST', respond: { schemaVersion: 1, estado: 'abierto', mes: '2026-10-01', cuentas: [] } }])
    const response = await M.handleGetFinanzasPeriodoMensual(monthlyRequest(undefined, 'http://worker.test/api/finanzas/periodos-mensuales?mes=2026-10-01'), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(mock.calls[0].body).toEqual({ p_cuenta_id: OPERADORES.administracion.cuenta_id, p_mes_inicio: '2026-10-01' })
  })

  it('rechaza mes inválido y roles sin gestión antes de RPC', async () => {
    mock = installFetchMock([])
    let response = await M.handleGetFinanzasPeriodoMensual(monthlyRequest(undefined, 'http://worker.test/api/finanzas/periodos-mensuales?mes=2026-13-01'), ENV)
    expect((await readResponse(response)).status).toBe(400)
    operadorActual = OPERADORES.finanzas
    response = await M.handleGetFinanzasPeriodoMensual(monthlyRequest(undefined, 'http://worker.test/api/finanzas/periodos-mensuales?mes=2026-10-01'), ENV)
    expect((await readResponse(response)).status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })

  it('valida apertura antes de RPC y opera con tenant/operator de sesión', async () => {
    mock = installFetchMock([{ match: '/rpc/finanzas_periodo_mensual_operar', method: 'POST', respond: { ok: true, estado: 'abierto' } }])
    const bad = await M.handleOperarFinanzasPeriodoMensual(monthlyRequest({ accion: 'aperturar', mesInicio: '2026-10-01', idempotencyKey: 'monthly-open-key-0001', payload: { ...payload, tasaUsdVes: null } }), ENV)
    expect((await readResponse(bad)).status).toBe(400)
    // Sin tasas ni valoración previa registrada en el libro no se intenta ningún RPC.
    expect(mock.calls.filter(call => call.method === 'POST')).toHaveLength(0)
    const response = await M.handleOperarFinanzasPeriodoMensual(monthlyRequest({ accion: 'aperturar', mesInicio: '2026-10-01', idempotencyKey: 'monthly-open-key-0001', payload }), ENV)
    expect((await readResponse(response)).status).toBe(200)
    const rpc = mock.calls.find(call => call.url.includes('/rpc/finanzas_periodo_mensual_operar'))
    expect(rpc.body).toMatchObject({ p_cuenta_id: OPERADORES.administracion.cuenta_id, p_operador_id: OPERADORES.administracion.id, p_accion: 'aperturar', p_mes_inicio: '2026-10-01' })
  })

  it('sin tasas del cliente usa la última valoración registrada y arma la lista de cuentas (254)', async () => {
    mock = installFetchMock([
      { match: 'order=creado_en.desc', method: 'GET', respond: [
        { moneda: 'USD', tasa_ves: 400, tasa_usd_ves: 400 },
        { moneda: 'USDT', tasa_ves: 450, tasa_usd_ves: 400 },
      ] },
      { match: '/rpc/finanzas_periodo_mensual_estado', method: 'POST', respond: {
        schemaVersion: 1, estado: 'sin_apertura', mes: '2026-10-01',
        cierreAnterior: [{ cuentaCustodiaId: IDS.config, moneda: 'USD', saldo: '80' }],
        cuentas: [
          { cuentaCustodiaId: IDS.config, nombre: 'Caja USD', moneda: 'USD', activo: true, saldoHistorico: '80.000000' },
          { cuentaCustodiaId: IDS.periodo, nombre: 'Banco VES', moneda: 'VES', activo: true, saldoHistorico: '1500.000000' },
        ],
      } },
      { match: '/rpc/finanzas_periodo_mensual_operar', method: 'POST', respond: { ok: true, estado: 'abierto' } },
    ])
    const response = await M.handleOperarFinanzasPeriodoMensual(monthlyRequest({
      accion: 'aperturar', mesInicio: '2026-10-01', idempotencyKey: 'monthly-open-key-0002', payload: {},
    }), ENV)
    expect((await readResponse(response)).status).toBe(200)
    const sent = mock.calls.find(call => call.url.includes('/rpc/finanzas_periodo_mensual_operar')).body
    expect(sent.p_payload.tasaUsdVes).toBe('400')
    expect(sent.p_payload.tasaUsdtVes).toBe('450')
    expect(sent.p_payload.cuentas).toEqual([
      { cuentaCustodiaId: IDS.config, metodo: 'cierre_anterior', tasaUsdVes: '400', tasaUsdtVes: '450' },
      { cuentaCustodiaId: IDS.periodo, metodo: 'saldo_real', saldoReal: '1500', motivo: null, tasaUsdVes: '400', tasaUsdtVes: '450' },
    ])
  })

  it('alta de cuenta solo opera con período abierto y confirma clave tenant-scoped', async () => {
    mock = installFetchMock([
      { match: '/rpc/finanzas_periodo_mensual_estado', method: 'POST', respond: { schemaVersion: 1, estado: 'abierto', cuentas: [] } },
      { match: '/rpc/finanzas_periodo_mensual_operar', method: 'POST', respond: { ok: true, idempotente: false, saldoApertura: 25 } },
    ])
    const response = await M.handleRegistrarCuentaEnPeriodoMensual(monthlyRequest({ mesInicio: '2026-10-01', idempotencyKey: 'monthly-wallet-key-001', payload: { cuentaCustodiaId: IDS.config, saldoReal: '25', tasaUsdVes: '400', tasaUsdtVes: '450' } }), ENV)
    expect((await readResponse(response)).body).toMatchObject({ ok: true, aperturaMensual: true, saldoApertura: 25 })
    expect(mock.calls[1].body).toMatchObject({ p_accion: 'alta_cuenta', p_mes_inicio: '2026-10-01', p_cuenta_id: OPERADORES.administracion.cuenta_id })
  })
})

describe('finanzas — guardrails de administración', () => {
  it('rechaza cualquier operador sin acceso a finanzas antes de consultar', async () => {
    operadorActual = OPERADORES.logistica
    mock = installFetchMock([])
    const response = await H.handleGetFinanzasCategorias(makeRequest(), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(403)
    expect(result.body.error).toMatch(/Acceso denegado/i)
    expect(mock.calls).toHaveLength(0)
  })

  it('rechaza el alta sin cuenta de custodia: ningún movimiento huérfano (anti-huérfanos)', async () => {
    mock = installFetchMock([])
    const response = await H.handleCrearFinanzasMovimiento(makeRequest(movementInput), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/cuenta de origen\/destino/i)
    // No debe haber tocado Supabase: la validación es la primera barrera.
    expect(mock.calls.filter(call => call.method === 'POST')).toHaveLength(0)
  })

  it('rechaza el alta con cuenta de custodia malformada', async () => {
    mock = installFetchMock([])
    const response = await H.handleCrearFinanzasMovimiento(
      makeRequest({ ...movementInput, cuentaCustodiaId: 'no-es-un-uuid' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/cuenta de origen\/destino|inválida/i)
  })

  it('rechaza el alta cuya cuenta de custodia no existe o es de otro tenant', async () => {
    const ajena = '99999999-9999-4999-8999-999999999999'
    mock = installFetchMock([
      { match: `/cuentas_custodia?id=eq.${ajena}`, method: 'GET', respond: [] },
    ])
    const response = await H.handleCrearFinanzasMovimiento(
      makeRequest({ ...movementInput, cuentaCustodiaId: ajena }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/no corresponde|no existe/i)
    expect(mock.calls.filter(call => call.method === 'POST')).toHaveLength(0)
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
  it('rechaza un egreso que supera el saldo de la cartera sin escribir', async () => {
    const custodyId = IDS.config
    mock = installFetchMock([
      { match: `/cuentas_custodia?id=eq.${custodyId}`, method: 'GET', respond: [{ id: custodyId, nombre: 'Caja USD', moneda: 'USD' }] },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/rpc/finanzas_saldos', method: 'POST', respond: { schemaVersion: 1, cuentas: [{ cuentaCustodiaId: custodyId, saldoNativo: '60' }] } },
      { match: '/finanzas_movimientos?cuenta_id=', method: 'GET', respond: [] },
    ])
    const response = await H.handleCrearFinanzasMovimiento(makeRequest({ ...movementInput, cuentaCustodiaId: custodyId }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ code: 'FINANCIAL_INSUFFICIENT_FUNDS', disponible: 60, faltante: 40 })
    expect(result.body.error).toMatch(/disponible 60,00 USD, faltan 40,00 USD/i)
    expect(mock.calls.filter(call => call.method === 'POST' && call.url.endsWith('/finanzas_movimientos'))).toHaveLength(0)
  })

  it('rol finanzas registra un movimiento en su tenant sin requerir ver saldos', async () => {
    let sent
    operadorActual = OPERADORES.finanzas
    const custodyId = IDS.config
    mock = installFetchMock([
      { match: `/cuentas_custodia?id=eq.${custodyId}`, method: 'GET', respond: [{ id: custodyId, nombre: 'Caja USD', moneda: 'USD' }] },
      { match: 'idempotency_key=eq.finanzas-create-test-001', method: 'GET', respond: [] },
      { match: '/rpc/finanzas_saldos', method: 'POST', respond: { schemaVersion: 1, cuentas: [{ cuentaCustodiaId: custodyId, saldoNativo: '1000' }] } },
      { match: '/finanzas_movimientos?cuenta_id=', method: 'GET', respond: [] },
      { match: '/finanzas_movimientos', method: 'POST', respond: (url, init) => { sent = JSON.parse(init.body); return [{ ...movement, creado_por: OPERADORES.finanzas.id, cuenta_custodia_id: custodyId }] } },
    ])

    const response = await H.handleCrearFinanzasMovimiento(makeRequest({
      ...movementInput,
      idempotencyKey: 'finanzas-create-test-001',
      cuentaCustodiaId: custodyId,
    }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(201)
    expect(sent).toMatchObject({
      cuenta_id: OPERADORES.finanzas.cuenta_id,
      creado_por: OPERADORES.finanzas.id,
      cuenta_custodia_id: custodyId,
      cuenta_origen: 'Caja USD',
    })
    expect(mock.calls.filter(call => call.method === 'POST' && call.url.endsWith('/finanzas_movimientos'))).toHaveLength(1)
  })

  it('crea un movimiento con cuenta, tasa e idempotencia server-side', async () => {
    let sent
    const custodyId = IDS.config
    mock = installFetchMock([
      { match: `/cuentas_custodia?id=eq.${custodyId}`, method: 'GET', respond: [{ id: custodyId, nombre: 'Caja USD', moneda: 'USD' }] },
      { match: 'idempotency_key=eq.movimiento-test-0001', method: 'GET', respond: [] },
      { match: '/rpc/finanzas_saldos', method: 'POST', respond: { schemaVersion: 1, cuentas: [{ cuentaCustodiaId: custodyId, saldoNativo: '1000' }] } },
      { match: '/finanzas_movimientos?cuenta_id=', method: 'GET', respond: [] },
      { match: '/finanzas_movimientos', method: 'POST', respond: (url, init) => { sent = JSON.parse(init.body); return [{ ...movement, cuenta_custodia_id: custodyId }] } },
    ])
    const response = await H.handleCrearFinanzasMovimiento(
      makeRequest({ ...movementInput, cuentaCustodiaId: custodyId }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(201)
    expect(result.body.movimiento.monto_ves).toBe(12000)
    expect(sent.cuenta_id).toBe(OPERADORES.administracion.cuenta_id)
    expect(sent.creado_por).toBe(OPERADORES.administracion.id)
    expect(sent).not.toHaveProperty('monto_ves')
  })

  it('reintento con la misma idempotency key no crea otra fila', async () => {
    const custodyId = IDS.config
    mock = installFetchMock([
      { match: `/cuentas_custodia?id=eq.${custodyId}`, method: 'GET', respond: [{ id: custodyId, nombre: 'Caja USD', moneda: 'USD' }] },
      { match: 'idempotency_key=eq.movimiento-test-0001', method: 'GET', respond: [movement] },
    ])
    const response = await H.handleCrearFinanzasMovimiento(
      makeRequest({ ...movementInput, cuentaCustodiaId: custodyId }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.idempotente).toBe(true)
    expect(mock.calls.filter(call => call.method === 'POST')).toHaveLength(0)
  })

  it('los replay legados con otra referencia siguen siendo idempotentes', async () => {
    // Contrato del simulador determinista: la referencia es metadato documental;
    // los reintentos del flujo de nómina legado llegan con otra referencia y no
    // deben recibir conflicto de idempotencia.
    const custodyId = IDS.config
    mock = installFetchMock([
      { match: `/cuentas_custodia?id=eq.${custodyId}`, method: 'GET', respond: [{ id: custodyId, nombre: 'Caja USD', moneda: 'USD' }] },
      { match: 'idempotency_key=eq.movimiento-test-0001', method: 'GET', respond: [{ ...movement, referencia: 'NOMINA-QUINCENA-1' }] },
    ])
    const response = await H.handleCrearFinanzasMovimiento(
      makeRequest({ ...movementInput, referencia: 'REF-OP-MES', cuentaCustodiaId: custodyId }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.idempotente).toBe(true)
    expect(mock.calls.filter(call => call.method === 'POST')).toHaveLength(0)
  })

  it('la misma clave con datos distintos se rechaza en vez de confirmar el movimiento previo', async () => {
    const custodyId = IDS.config
    mock = installFetchMock([
      { match: `/cuentas_custodia?id=eq.${custodyId}`, method: 'GET', respond: [{ id: custodyId, nombre: 'Caja USD', moneda: 'USD' }] },
      { match: 'idempotency_key=eq.movimiento-test-0001', method: 'GET', respond: [movement] },
    ])
    const response = await H.handleCrearFinanzasMovimiento(
      makeRequest({ ...movementInput, monto: 250, cuentaCustodiaId: custodyId }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('FINANCIAL_IDEMPOTENCY_CONFLICT')
    expect(result.body.movimiento.monto).toBe(100)
    expect(mock.calls.filter(call => call.method === 'POST')).toHaveLength(0)
  })

  it('bloquea un movimiento exacto aunque se envíe con otra clave', async () => {
    const custodyId = IDS.config
    mock = installFetchMock([
      { match: `/cuentas_custodia?id=eq.${custodyId}`, method: 'GET', respond: [{ id: custodyId, nombre: 'Caja USD', moneda: 'USD' }] },
      { match: 'idempotency_key=eq.movimiento-otra-clave-0001', method: 'GET', respond: [] },
      { match: '/rpc/finanzas_saldos', method: 'POST', respond: { schemaVersion: 1, cuentas: [{ cuentaCustodiaId: custodyId, saldoNativo: '1000' }] } },
      { match: '/finanzas_movimientos?cuenta_id=', method: 'GET', respond: [{ ...movement, fecha: movementInput.fecha, tipo: movementInput.tipo, concepto: movementInput.concepto, monto: movementInput.monto, moneda: movementInput.moneda, referencia: 'TRF-1234', cuenta_custodia_id: custodyId }] },
    ])
    const response = await H.handleCrearFinanzasMovimiento(makeRequest({ ...movementInput, referencia: 'TRF-1234', idempotencyKey: 'movimiento-otra-clave-0001', cuentaCustodiaId: custodyId }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('FINANCIAL_DUPLICATE_EXACT')
    expect(mock.calls.filter(call => call.method === 'POST' && call.url.endsWith('/finanzas_movimientos'))).toHaveLength(0)
  })

  it('devuelve advertencia para mismo concepto y referencia con importe distinto; permite excepción justificada', async () => {
    const custodyId = IDS.config
    const similar = { ...movement, fecha: movementInput.fecha, tipo: movementInput.tipo, concepto: movementInput.concepto, monto: 99, moneda: movementInput.moneda, referencia: 'TRF-1234', cuenta_custodia_id: custodyId }
    let sent
    mock = installFetchMock([
      { match: `/cuentas_custodia?id=eq.${custodyId}`, method: 'GET', respond: [{ id: custodyId, nombre: 'Caja USD', moneda: 'USD' }] },
      { match: 'idempotency_key=eq.movimiento-similar-0001', method: 'GET', respond: [] },
      { match: '/rpc/finanzas_saldos', method: 'POST', respond: { schemaVersion: 1, cuentas: [{ cuentaCustodiaId: custodyId, saldoNativo: '1000' }] } },
      { match: '/finanzas_movimientos?cuenta_id=', method: 'GET', respond: [similar] },
      { match: '/rpc/finanzas_saldos', method: 'POST', respond: { schemaVersion: 1, cuentas: [{ cuentaCustodiaId: custodyId, saldoNativo: '1000' }] } },
      { match: '/finanzas_movimientos', method: 'POST', respond: (url, init) => { sent = JSON.parse(init.body); return [{ ...movement, ...sent, cuenta_custodia_id: custodyId }] } },
    ])
    const warning = await H.handleCrearFinanzasMovimiento(makeRequest({ ...movementInput, referencia: 'TRF-1234', idempotencyKey: 'movimiento-similar-0001', cuentaCustodiaId: custodyId }), ENV)
    const warningBody = await readResponse(warning)
    expect(warningBody.status).toBe(409)
    expect(warningBody.body.code).toBe('FINANCIAL_DUPLICATE_SIMILAR')
    const accepted = await H.handleCrearFinanzasMovimiento(makeRequest({ ...movementInput, referencia: 'TRF-1234', idempotencyKey: 'movimiento-similar-0001', cuentaCustodiaId: custodyId, motivoCoincidencia: 'Factura distinta comprobada' }), ENV)
    expect((await readResponse(accepted)).status).toBe(201)
    expect(sent.motivo_coincidencia).toBe('Factura distinta comprobada')
  })

  it('resume por RPC acotado al tenant y rango', async () => {
    mock = installFetchMock([
      { match: '/rpc/finanzas_resumen_consistente', method: 'POST', respond: { versionLibro: '7', rows: [
        { tipo: 'egreso', categoria: 'Proveedores', total_ves: 120, total_usd: 1, movimientos: 1 },
      ] } },
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
      { match: '/rpc/finanzas_movimientos_pagina', method: 'POST', respond: { movimientos: [movement], versionLibro: '7', paginacion: { total: 1, recibidos: 1, siguiente: null } } },
    ])
    const request = makeRequest(undefined, {
      url: 'http://worker.test/api/finanzas/movimientos?desde=2026-08-01&hasta=2026-08-31&tipo=egreso&categoria=Proveedores&moneda=USD&mostrarAnulados=true&limit=50&cartera=USD&versionLibro=7',
    })
    const response = await H.handleGetFinanzasMovimientos(request, ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.movimientos).toHaveLength(1)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].url).toBe(`${ENV.SUPABASE_URL}/rest/v1/rpc/finanzas_movimientos_pagina`)
    expect(mock.calls[0].body).toEqual({ p_cuenta_id: OPERADORES.administracion.cuenta_id,
      p_desde: '2026-08-01', p_hasta: '2026-08-31', p_tipo: 'egreso', p_categoria: 'Proveedores',
      p_moneda: 'USD', p_cartera: 'USD', p_anulados: true, p_limite: 50, p_offset: 0, p_version: '7' })
    expect(result.body.versionLibro).toBe('7')
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

  it('rol finanzas puede crear categorías (operar el libro) y rol nomina no puede', async () => {
    // Regla de negocio: crear categorías/motivos es parte de registrar ingresos/egresos.
    // El rol finanzas opera el libro (aunque no vea saldos); nomina no toca finanzas.
    mock = installFetchMock([
      {
        match: '/finanzas_categorias',
        method: 'POST',
        respond: [{ id: IDS.config, nombre: 'Fletes', tipo: 'egreso', activo: true }],
      },
    ])
    operadorActual = OPERADORES.finanzas
    const ok = await H.handleCrearFinanzasCategoria(
      makeRequest({ nombre: 'Fletes', tipo: 'egreso' }), ENV)
    const okBody = await readResponse(ok)
    expect(okBody.status).toBe(201)
    expect(okBody.body.categoria.nombre).toBe('Fletes')

    operadorActual = OPERADORES.nomina
    const denied = await H.handleCrearFinanzasCategoria(
      makeRequest({ nombre: 'X', tipo: 'egreso' }), ENV)
    const deniedBody = await readResponse(denied)
    expect(deniedBody.status).toBe(403)
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
