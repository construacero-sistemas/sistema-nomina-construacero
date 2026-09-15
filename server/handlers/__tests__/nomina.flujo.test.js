// api/handlers/__tests__/nomina.flujo.test.js
// Reglas de ciclo de vida: bloqueos por estado, recálculo no destructivo,
// transiciones de período y aislamiento de tenant. Todo contra fetch mockeado.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ENV, OPERADORES, IDS, makeRequest, readResponse, installFetchMock, authOk, expectSinRedReal } from './_harness'
let operadorActual = OPERADORES.administracion
vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
}))
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(async () => {}),
}))
const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks(); operadorActual = OPERADORES.administracion })
// ─── Bloqueo de asistencia por período cerrado ───────────────────────────────
describe('asistencia bloqueada por estado del período', () => {
  it('no permite registrar en un período cerrado', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ id: IDS.periodo, nombre: 'Semana 1', estado: 'cerrado' }] },
    ])
    const res = await H.handleRegistrarAsistencia(
      makeRequest({ empleadoId: IDS.empleado, fecha: '2026-08-03', horaEntrada: '08:00', horaSalida: '17:00' }),
      ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/cerrado/i)
  })
  it('no permite registro masivo en un período pagado', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ nombre: 'Semana 1', estado: 'pagado' }] },
    ])
    const res = await H.handleRegistrarAsistenciaMasivo(
      makeRequest({ fecha: '2026-08-03', horaEntrada: '08:00', horaSalida: '17:00' }), ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/pagado/i)
  })
  it('no permite eliminar un registro de un período cerrado', async () => {
    mock = installFetchMock([
      { match: '/registro_asistencia', method: 'GET', respond: [{ fecha: '2026-08-03' }] },
      { match: '/nomina_periodos', respond: [{ nombre: 'Semana 1', estado: 'cerrado' }] },
    ])
    const res = await H.handleEliminarAsistencia(makeRequest({ id: IDS.registro }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/cerrado/i)
  })
  it('rechaza registrar si el empleado no tiene configuración de nómina', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [] },
      { match: '/nomina_config_empleado', respond: [] },
    ])
    const res = await H.handleRegistrarAsistencia(
      makeRequest({ empleadoId: IDS.empleado, fecha: '2026-08-03', horaEntrada: '08:00', horaSalida: '17:00' }),
      ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/no tiene configuración/i)
  })
  it('una ausencia guarda horas en null', async () => {
    let enviado = null
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [] },
      { match: '/configuracion_negocio', respond: [{}] },
      { match: '/nomina_config_empleado', respond: [{ horas_jornada: 8 }] },
      { match: '/registro_asistencia', method: 'POST', respond: (url, init) => {
        enviado = JSON.parse(init.body)
        return [{ id: IDS.registro }]
      }},
    ])
    await H.handleRegistrarAsistencia(
      makeRequest({ empleadoId: IDS.empleado, fecha: '2026-08-03', horaEntrada: '08:00', horaSalida: '17:00', esAusencia: true }),
      ENV
    )
    expect(enviado.hora_entrada).toBeNull()
    expect(enviado.hora_salida).toBeNull()
    expect(enviado.horas_trabajadas).toBe(0)
    expect(enviado.es_ausencia).toBe(true)
  })
})
// ─── Creación de período: solapamiento ───────────────────────────────────────
describe('creación de período', () => {
  it('rechaza fechas que se solapan con otro período', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', method: 'GET', respond: [{ id: IDS.periodo, nombre: 'Semana previa' }] },
    ])
    const res = await H.handleCrearPeriodo(
      makeRequest({ nombre: 'Nueva', desde: '2026-08-03', hasta: '2026-08-09' }), ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/solapan/i)
  })
  it('normaliza un tipo desconocido a semanal', async () => {
    let enviado = null
    mock = installFetchMock([
      { match: '/nomina_periodos', method: 'GET',  respond: [] },
      { match: '/nomina_periodos', method: 'POST', respond: (url, init) => {
        enviado = JSON.parse(init.body)
        return [{ id: IDS.periodo }]
      }},
    ])
    await H.handleCrearPeriodo(
      makeRequest({ nombre: 'P', desde: '2026-08-03', hasta: '2026-08-09', tipo: 'anual' }), ENV
    )
    expect(enviado.tipo).toBe('semanal')
    expect(enviado.estado).toBe('abierto')
  })
})
// ─── Cálculo: recálculo no destructivo ───────────────────────────────────────
describe('cálculo de período', () => {
  const periodoAbierto = { id: IDS.periodo, nombre: 'Semana 1', desde: '2026-08-03', hasta: '2026-08-09', estado: 'abierto' }
  it('no recalcula un período cerrado', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ ...periodoAbierto, estado: 'cerrado' }] },
    ])
    const res = await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/cerrado/i)
  })
  it('devuelve 404 si el período no existe', async () => {
    mock = installFetchMock([{ match: '/nomina_periodos', respond: [] }])
    const res = await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(404)
  })
  it('falla si no hay empleados activos', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos',        respond: [periodoAbierto] },
      { match: '/nomina_config_empleado', respond: [] },
      { match: '/configuracion_negocio',  respond: [{}] },
      { match: '/registro_asistencia',    respond: [] },
      { match: '/nomina_lineas',          respond: [] },
    ])
    const res = await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/no hay empleados/i)
  })
  it('calcula los montos a partir de la asistencia registrada', async () => {
    let insertadas = null
    mock = installFetchMock([
      { match: '/nomina_periodos',        respond: [periodoAbierto] },
      { match: '/nomina_config_empleado', respond: [
        { empleado_id: IDS.empleado, cargo: 'Almacenista', salario_dia_usd: 30, horas_jornada: 8 },
      ]},
      { match: '/configuracion_negocio',  respond: [{
        nomina_factor_hora_extra: 1.5, nomina_factor_sabado: 1.25, nomina_factor_feriado: 2,
      }]},
      { match: '/registro_asistencia', respond: [
        { empleado_id: IDS.empleado, fecha: '2026-08-03', horas_normales: 8, horas_extra: 2, es_sabado: false, es_feriado: false, es_ausencia: false },
        { empleado_id: IDS.empleado, fecha: '2026-08-04', horas_normales: 8, horas_extra: 0, es_sabado: false, es_feriado: false, es_ausencia: false },
      ]},
      { match: '/nomina_lineas', method: 'GET',    respond: [] },
      { match: '/nomina_lineas', method: 'DELETE', respond: [] },
      { match: '/nomina_lineas', method: 'POST',   respond: (url, init) => {
        insertadas = JSON.parse(init.body)
        return []
      }},
    ])
    const res = await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.lineas_generadas).toBe(1)
    const l = insertadas[0]
    expect(l.dias_trabajados).toBe(2)
    expect(l.monto_normal_usd).toBe(60)          // 2 × 30
    expect(l.horas_extra).toBe(2)
    expect(l.monto_extra_usd).toBe(11.25)        // 2 × 3.75 × 1.5
    expect(l.total_neto_usd).toBe(71.25)
  })
  it('preserva las líneas ya pagadas al recalcular', async () => {
    let urlDelete = null
    let insertadas = null
    mock = installFetchMock([
      { match: '/nomina_periodos',        respond: [periodoAbierto] },
      { match: '/nomina_config_empleado', respond: [
        { empleado_id: IDS.empleado,  salario_dia_usd: 30, horas_jornada: 8 },
        { empleado_id: IDS.empleado2, salario_dia_usd: 40, horas_jornada: 8 },
      ]},
      { match: '/configuracion_negocio', respond: [{}] },
      { match: '/registro_asistencia',   respond: [] },
      // El empleado 1 ya cobró; el 2 no.
      { match: '/nomina_lineas', method: 'GET', respond: [
        { empleado_id: IDS.empleado,  pagado: true,  bonos_usd: 0, deducciones_usd: 0 },
        { empleado_id: IDS.empleado2, pagado: false, bonos_usd: 15, deducciones_usd: 5, nota_bonos: 'Bono X' },
      ]},
      { match: '/nomina_lineas', method: 'DELETE', respond: (url) => { urlDelete = url; return [] } },
      { match: '/nomina_lineas', method: 'POST',   respond: (url, init) => {
        insertadas = JSON.parse(init.body); return []
      }},
    ])
    const res = await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.lineas_preservadas).toBe(1)
    expect(body.lineas_generadas).toBe(1)
    // No se borra el período completo: al no haber líneas obsoletas, el upsert
    // conserva la línea pagada y actualiza únicamente la no pagada.
    expect(urlDelete).toBeNull()
    // Solo se reinserta/upserta el no pagado.
    expect(insertadas).toHaveLength(1)
    expect(insertadas[0].empleado_id).toBe(IDS.empleado2)
  })
  it('re-aplica los ajustes manuales de las líneas no pagadas', async () => {
    let insertadas = null
    mock = installFetchMock([
      { match: '/nomina_periodos',        respond: [periodoAbierto] },
      { match: '/nomina_config_empleado', respond: [
        { empleado_id: IDS.empleado, salario_dia_usd: 30, horas_jornada: 8 },
      ]},
      { match: '/configuracion_negocio', respond: [{}] },
      { match: '/registro_asistencia',   respond: [
        { empleado_id: IDS.empleado, horas_normales: 8, horas_extra: 0, es_sabado: false, es_feriado: false, es_ausencia: false },
      ]},
      { match: '/nomina_lineas', method: 'GET', respond: [
        { empleado_id: IDS.empleado, pagado: false, bonos_usd: 20, deducciones_usd: 10,
          nota_bonos: 'Bono productividad', nota_deducciones: 'Adelanto' },
      ]},
      { match: '/nomina_lineas', method: 'DELETE', respond: [] },
      { match: '/nomina_lineas', method: 'POST',   respond: (url, init) => {
        insertadas = JSON.parse(init.body); return []
      }},
    ])
    await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const l = insertadas[0]
    expect(l.bonos_usd).toBe(20)
    expect(l.deducciones_usd).toBe(10)
    expect(l.nota_bonos).toBe('Bono productividad')
    expect(l.nota_deducciones).toBe('Adelanto')
    expect(l.total_bruto_usd).toBe(50)   // 30 + 20
    expect(l.total_neto_usd).toBe(40)    // 50 − 10
  })
})
// ─── Cierre y reapertura ─────────────────────────────────────────────────────
describe('cierre y reapertura de período', () => {
  it('no cierra un período sin líneas calculadas', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ id: IDS.periodo, nombre: 'P', estado: 'abierto' }] },
      { match: '/nomina_lineas',   respond: [] },
    ])
    const res = await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/calcula la nómina/i)
  })
  it('no cierra un período que ya está cerrado', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ id: IDS.periodo, nombre: 'P', estado: 'cerrado' }] },
    ])
    const res = await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/ya está cerrado/i)
  })
  it('cierra correctamente y sella quién y cuándo', async () => {
    let enviado = null
    mock = installFetchMock([
      { match: '/nomina_periodos', method: 'GET',   respond: [{ id: IDS.periodo, nombre: 'P', estado: 'abierto' }] },
      { match: '/nomina_lineas',   respond: [{ id: IDS.linea }] },
      { match: '/nomina_periodos', method: 'PATCH', respond: (url, init) => {
        enviado = JSON.parse(init.body); return []
      }},
    ])
    const res = await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(200)
    expect(enviado.estado).toBe('cerrado')
    expect(enviado.cerrado_por).toBe(OPERADORES.administracion.id)
    expect(enviado.cerrado_en).toBeTruthy()
  })
  it('no reabre un período pagado', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ id: IDS.periodo, nombre: 'P', estado: 'pagado' }] },
    ])
    const res = await H.handleReabrirPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/pagado/i)
  })
  it('no reabre si hay recibos ya pagados', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ id: IDS.periodo, nombre: 'P', estado: 'cerrado' }] },
      { match: '/nomina_lineas',   respond: [{ id: IDS.linea }] },  // hay pagadas
    ])
    const res = await H.handleReabrirPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/revierte los pagos/i)
  })
  it('reabre y limpia los sellos de cierre', async () => {
    let enviado = null
    mock = installFetchMock([
      { match: '/nomina_periodos', method: 'GET',   respond: [{ id: IDS.periodo, nombre: 'P', estado: 'cerrado' }] },
      { match: '/nomina_lineas',   respond: [] },
      { match: '/nomina_periodos', method: 'PATCH', respond: (url, init) => {
        enviado = JSON.parse(init.body); return []
      }},
    ])
    const res = await H.handleReabrirPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(200)
    expect(enviado.estado).toBe('abierto')
    expect(enviado.cerrado_en).toBeNull()
    expect(enviado.cerrado_por).toBeNull()
  })
})

// ─── Eliminación de períodos ──────────────────────────────────────────────────
describe('eliminación de períodos', () => {
  it('no elimina si el período está pagado', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ id: IDS.periodo, nombre: 'P', estado: 'pagado' }] },
    ])
    const res = await H.handleEliminarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/pagado/i)
  })

  it('no elimina si hay recibos pagados', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ id: IDS.periodo, nombre: 'P', estado: 'abierto' }] },
      { match: '/nomina_lineas',   respond: [{ id: IDS.linea }] },
    ])
    const res = await H.handleEliminarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/revierte los pagos/i)
  })

  it('no elimina el período ni anuncia éxito si los recibos conservan historial financiero', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', method: 'GET', respond: [{ id: IDS.periodo, nombre: 'P', estado: 'abierto' }] },
      { match: '/nomina_lineas', method: 'GET', respond: [] },
      { match: '/nomina_lineas', method: 'DELETE', respond: { __raw: { code: '23503' }, ok: false, status: 409 } },
    ])
    const { status, body } = await readResponse(await H.handleEliminarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV))
    expect(status).toBe(409)
    expect(body.error).toMatch(/historial de pago/)
    expect(mock.calls.filter(c => c.method === 'DELETE')).toHaveLength(1)
    expect(mock.calls.some(c => c.method === 'DELETE' && c.url.includes('/nomina_periodos'))).toBe(false)
  })

  it('elimina líneas asociadas y el período', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', method: 'GET',    respond: [{ id: IDS.periodo, nombre: 'P', estado: 'abierto' }] },
      { match: '/nomina_lineas',   method: 'GET',    respond: [] },
      { match: '/nomina_lineas',   method: 'DELETE', respond: [] },
      { match: '/nomina_periodos', method: 'DELETE', respond: [] },
    ])
    const res = await H.handleEliminarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(200)
    const deletes = mock.calls.filter(c => c.method === 'DELETE')
    expect(deletes).toHaveLength(2)
  })
})
// ─── Ajuste de líneas ────────────────────────────────────────────────────────
describe('ajuste de recibos', () => {
  const lineaBase = {
    id: IDS.linea, periodo_id: IDS.periodo, pagado: false,
    monto_normal_usd: 150, monto_extra_usd: 20, monto_sabado_usd: 7.5, monto_feriado_usd: 0,
  }
  it('no ajusta un recibo ya pagado', async () => {
    mock = installFetchMock([
      { match: '/nomina_lineas', respond: [{ ...lineaBase, pagado: true }] },
    ])
    const res = await H.handleAjustarLinea(makeRequest({ lineaId: IDS.linea, bonosUsd: 10 }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/ya pagado/i)
  })
  it('no ajusta si el período no está abierto', async () => {
    mock = installFetchMock([
      { match: '/nomina_lineas',   respond: [lineaBase] },
      { match: '/nomina_periodos', respond: [{ estado: 'cerrado', nombre: 'P' }] },
    ])
    const res = await H.handleAjustarLinea(makeRequest({ lineaId: IDS.linea, bonosUsd: 10 }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/cerrado/i)
  })
  it('recalcula bruto y neto sobre la base calculada', async () => {
    let enviado = null
    mock = installFetchMock([
      { match: '/nomina_lineas',   method: 'GET',   respond: [lineaBase] },
      { match: '/nomina_periodos', respond: [{ estado: 'abierto', nombre: 'P' }] },
      { match: '/nomina_lineas',   method: 'PATCH', respond: (url, init) => {
        enviado = JSON.parse(init.body); return [{ id: IDS.linea }]
      }},
    ])
    const res = await H.handleAjustarLinea(
      makeRequest({ lineaId: IDS.linea, bonosUsd: 25, deduccionesUsd: 50 }), ENV
    )
    const { status } = await readResponse(res)
    expect(status).toBe(200)
    // base = 150 + 20 + 7.5 = 177.5
    expect(enviado.total_bruto_usd).toBe(202.5)  // 177.5 + 25
    expect(enviado.total_neto_usd).toBe(152.5)   // 202.5 − 50
  })
  it('el neto nunca queda negativo', async () => {
    let enviado = null
    mock = installFetchMock([
      { match: '/nomina_lineas',   method: 'GET',   respond: [lineaBase] },
      { match: '/nomina_periodos', respond: [{ estado: 'abierto', nombre: 'P' }] },
      { match: '/nomina_lineas',   method: 'PATCH', respond: (url, init) => {
        enviado = JSON.parse(init.body); return [{ id: IDS.linea }]
      }},
    ])
    await H.handleAjustarLinea(
      makeRequest({ lineaId: IDS.linea, bonosUsd: 0, deduccionesUsd: 9999 }), ENV
    )
    expect(enviado.total_neto_usd).toBe(0)
  })
  it('convierte montos negativos a 0', async () => {
    let enviado = null
    mock = installFetchMock([
      { match: '/nomina_lineas',   method: 'GET',   respond: [lineaBase] },
      { match: '/nomina_periodos', respond: [{ estado: 'abierto', nombre: 'P' }] },
      { match: '/nomina_lineas',   method: 'PATCH', respond: (url, init) => {
        enviado = JSON.parse(init.body); return [{ id: IDS.linea }]
      }},
    ])
    await H.handleAjustarLinea(
      makeRequest({ lineaId: IDS.linea, bonosUsd: -30, deduccionesUsd: -10 }), ENV
    )
    expect(enviado.bonos_usd).toBe(0)
    expect(enviado.deducciones_usd).toBe(0)
  })
})
// RPC boundary coverage; committed period and receipt effects belong to scripts/test-db.mjs.
describe('receipt payment RPC lifecycle', () => {
  const payment = {
    operationId: IDS.registro, lineaIds: [IDS.linea], cuentaCustodiaId: IDS.config,
    tasaBcv: '400', tasaUsdVes: '400', fuenteTasa: 'BCV', metodoPago: 'Efectivo $',
  }
  const outcome = { recibos_pagados: 2, total_usd: '150.500000', asignacionIds: [IDS.empleado, IDS.empleado2], movimientoIds: [IDS.linea, IDS.linea2] }
  const confirmed = { ok: true, estado: 'confirmada', tipo: 'pagar_nomina', operationId: IDS.periodo,
    idempotencyKey: payment.operationId, resultado: outcome, ...outcome }

  it.each([
    ['open period', 'PT409', 409, 'Receipts must be unpaid and periods closed'],
    ['already-paid receipt', 'PT409', 409, 'Receipt already paid'],
    ['incomplete tenant receipt batch', 'PT404', 404, 'Receipt not found'],
  ])('propagates the transactional rejection for %s', async (_scenario, code, expectedStatus, message) => {
    mock = installFetchMock([{ match: '/rpc/finanzas_operar', method: 'POST',
      respond: { __raw: { code, message }, ok: false, status: expectedStatus } }])
    const { status, body } = await readResponse(await H.handlePagarLineas(
      makeRequest({ ...payment, lineaIds: [IDS.linea, IDS.linea2] }), ENV))
    expect(status).toBe(expectedStatus)
    expect(body).toMatchObject({ code })
    expect(body).not.toHaveProperty('ok', true)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].body).toMatchObject({ p_cuenta_id: OPERADORES.administracion.cuenta_id,
      p_tipo: 'pagar_nomina', p_clave: payment.operationId, p_payload: { lineaIds: [IDS.linea, IDS.linea2] } })
    expect(mock.calls.filter(call => call.method === 'PATCH')).toHaveLength(0)
  })

  it('forwards the payment reference and returns the database decimal total without recalculating', async () => {
    mock = installFetchMock([{ match: '/rpc/finanzas_operar', method: 'POST', respond: confirmed }])
    const result = await readResponse(await H.handlePagarLineas(
      makeRequest({ ...payment, lineaIds: [IDS.linea2, IDS.linea], referencia: 'Transferencia BNC 999', total_usd: 1 }), ENV))
    expect(result).toEqual({ status: 200, body: confirmed })
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].body).toEqual({
      p_cuenta_id: OPERADORES.administracion.cuenta_id, p_operador_id: OPERADORES.administracion.id,
      p_tipo: 'pagar_nomina', p_clave: payment.operationId, p_ip: '127.0.0.1',
      p_payload: { lineaIds: [IDS.linea, IDS.linea2], referencia: 'Transferencia BNC 999', cuentaCustodiaId: IDS.config,
        tasaBcv: '400', tasaUsdVes: '400', fuenteTasa: 'BCV', metodoPago: 'Efectivo $', observacionTasa: null, zonaHoraria: 'America/Caracas' },
    })
    expectSinRedReal(mock.calls)
  })

  it('does not issue a separate period update after a confirmed full-batch payment', async () => {
    mock = installFetchMock([{ match: '/rpc/finanzas_operar', method: 'POST', respond: confirmed }])
    const result = await readResponse(await H.handlePagarLineas(makeRequest({ ...payment, lineaIds: [IDS.linea, IDS.linea2] }), ENV))
    expect(result).toEqual({ status: 200, body: confirmed })
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].url).toBe(`${ENV.SUPABASE_URL}/rest/v1/rpc/finanzas_operar`)
  })

  it('does not fetch pending receipts or close the period independently for a partial batch', async () => {
    const partial = { recibos_pagados: 1, total_usd: '100.000000', asignacionIds: [IDS.empleado], movimientoIds: [IDS.linea] }
    const result = { ...confirmed, resultado: partial, ...partial }
    mock = installFetchMock([{ match: '/rpc/finanzas_operar', method: 'POST', respond: result }])
    expect(await readResponse(await H.handlePagarLineas(makeRequest(payment), ENV))).toEqual({ status: 200, body: result })
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].body.p_payload.lineaIds).toEqual([IDS.linea])
    expect(mock.calls[0].url).toBe(`${ENV.SUPABASE_URL}/rest/v1/rpc/finanzas_operar`)
  })
})
describe('payment reversal RPC lifecycle', () => {
  const reversal = { operationId: IDS.registro, lineaId: IDS.linea, motivo: 'Incorrect payment' }

  it.each([
    ['unpaid receipt', 'PT409', 409],
    ['missing receipt', 'PT404', 404],
    ['legacy receipt requiring reconciliation', 'PT422', 422],
  ])('propagates rejection for %s without another write', async (_scenario, code, expectedStatus) => {
    mock = installFetchMock([{ match: '/rpc/finanzas_operar', method: 'POST',
      respond: { __raw: { code }, ok: false, status: expectedStatus } }])
    const { status, body } = await readResponse(await H.handleRevertirPagoLinea(makeRequest(reversal), ENV))
    expect(status).toBe(expectedStatus)
    expect(body).toMatchObject({ code })
    expect(body).not.toHaveProperty('ok', true)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].body).toMatchObject({ p_tipo: 'revertir_nomina', p_clave: reversal.operationId,
      p_cuenta_id: OPERADORES.administracion.cuenta_id, p_payload: { lineaId: IDS.linea, motivo: reversal.motivo } })
  })

  it('returns the confirmed explicit reversal without clearing receipt or period state separately', async () => {
    const outcome = { lineaId: IDS.linea, asignacionId: IDS.empleado, movimientoId: IDS.linea2, total_usd: '100.000000', reversionContable: true }
    const confirmed = { ok: true, estado: 'confirmada', tipo: 'revertir_nomina', operationId: IDS.periodo,
      idempotencyKey: reversal.operationId, resultado: outcome, ...outcome }
    mock = installFetchMock([{ match: '/rpc/finanzas_operar', method: 'POST', respond: confirmed }])
    expect(await readResponse(await H.handleRevertirPagoLinea(makeRequest(reversal), ENV))).toEqual({ status: 200, body: confirmed })
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].url).toBe(`${ENV.SUPABASE_URL}/rest/v1/rpc/finanzas_operar`)
    expect(mock.calls[0].body.p_payload).toEqual({ lineaId: IDS.linea, motivo: reversal.motivo, zonaHoraria: 'America/Caracas' })
  })
})

// ─── Agregados del listado de períodos ───────────────────────────────────────
describe('totales del listado de períodos', () => {
  it('agrega empleados, bruto, neto y pagados por período', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ id: IDS.periodo, nombre: 'P', estado: 'cerrado' }] },
      { match: '/nomina_lineas',   respond: [
        { periodo_id: IDS.periodo, total_bruto_usd: 100, total_neto_usd: 90,  pagado: true },
        { periodo_id: IDS.periodo, total_bruto_usd: 50,  total_neto_usd: 45.5, pagado: false },
      ]},
    ])
    const res = await H.handleGetPeriodos(makeRequest(), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body[0].total_empleados).toBe(2)
    expect(body[0].total_bruto_usd).toBe(150)
    expect(body[0].total_neto_usd).toBe(135.5)
    expect(body[0].lineas_pagadas).toBe(1)
  })
  it('no consulta líneas si no hay períodos', async () => {
    mock = installFetchMock([{ match: '/nomina_periodos', respond: [] }])
    const res = await H.handleGetPeriodos(makeRequest(), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body).toEqual([])
    expect(mock.calls).toHaveLength(1)
  })
})

