// server/handlers/__tests__/nomina.ajuste-descuentos.test.js
// Ajuste de recibos: descuentos por trabajador con motivo obligatorio (regla
// vigente) y neto nunca negativo. Todo contra fetch mockeado: sin red.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ENV, OPERADORES, IDS, makeRequest, readResponse, installFetchMock, authOk } from './_harness'

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
    const res = await H.handleAjustarLinea(makeRequest({ lineaId: IDS.linea, bonosUsd: 10, descuentos: [] }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/ya pagado/i)
  })
  it('no ajusta si el período no está abierto', async () => {
    mock = installFetchMock([
      { match: '/nomina_lineas',   respond: [lineaBase] },
      { match: '/nomina_periodos', respond: [{ estado: 'cerrado', nombre: 'P' }] },
    ])
    const res = await H.handleAjustarLinea(makeRequest({ lineaId: IDS.linea, bonosUsd: 10, descuentos: [] }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/cerrado/i)
  })
  it('exige motivo en cada descuento antes de tocar la red', async () => {
    mock = installFetchMock([])
    const sinLista = await readResponse(await H.handleAjustarLinea(makeRequest({ lineaId: IDS.linea, bonosUsd: 0 }), ENV))
    expect(sinLista.status).toBe(400)
    expect(String(sinLista.body.error)).toMatch(/motivo/i)
    const sinMotivo = await readResponse(await H.handleAjustarLinea(
      makeRequest({ lineaId: IDS.linea, bonosUsd: 0, descuentos: [{ monto: 10 }] }), ENV))
    expect(sinMotivo.status).toBe(400)
    expect(String(sinMotivo.body.error)).toMatch(/motivo/i)
    const motivoAjeno = await readResponse(await H.handleAjustarLinea(
      makeRequest({ lineaId: IDS.linea, bonosUsd: 0, descuentos: [{ motivo: 'vacaciones', monto: 10 }] }), ENV))
    expect(motivoAjeno.status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })
  it('rechaza los montos sueltos del contrato anterior (sin motivo)', async () => {
    mock = installFetchMock([])
    const res = await H.handleAjustarLinea(
      makeRequest({ lineaId: IDS.linea, bonosUsd: 10, deduccionesUsd: 20, notaDeducciones: 'anticipo' }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/motivo/i)
    expect(mock.calls).toHaveLength(0)
  })
  it('recalcula bruto y neto sobre la base calculada', async () => {
    let enviado = null
    const creadas = []
    mock = installFetchMock([
      { match: '/nomina_lineas',   method: 'GET',   respond: [lineaBase] },
      { match: '/nomina_periodos', respond: [{ estado: 'abierto', nombre: 'P' }] },
      { match: '/nomina_descuentos', method: 'POST', respond: (url, init) => {
        const filas = JSON.parse(init.body).map((fila, i) => ({ id: `desc-${i}`, ...fila }))
        creadas.push(...filas)
        return filas
      }},
      { match: '/nomina_descuentos', method: 'DELETE', respond: [] },
      { match: '/nomina_lineas',   method: 'PATCH', respond: (url, init) => {
        enviado = JSON.parse(init.body); return [{ id: IDS.linea }]
      }},
    ])
    const res = await H.handleAjustarLinea(
      makeRequest({ lineaId: IDS.linea, bonosUsd: 25, descuentos: [{ motivo: 'prestamo', monto: 50 }] }), ENV
    )
    const { status } = await readResponse(res)
    expect(status).toBe(200)
    // base = 150 + 20 + 7.5 = 177.5
    expect(enviado.total_bruto_usd).toBe(202.5)  // 177.5 + 25
    expect(enviado.total_neto_usd).toBe(152.5)   // 202.5 − 50
    expect(creadas).toHaveLength(1)
  })
  it('guarda cada descuento con su motivo y actualiza el total del recibo', async () => {
    let enviado = null
    let podaUrl = null
    const creadas = []
    mock = installFetchMock([
      { match: '/nomina_lineas',   method: 'GET',   respond: [lineaBase] },
      { match: '/nomina_periodos', respond: [{ estado: 'abierto', nombre: 'P' }] },
      { match: '/nomina_descuentos', method: 'POST', respond: (url, init) => {
        const filas = JSON.parse(init.body).map((fila, i) => ({ id: `desc-${i}`, ...fila }))
        creadas.push(...filas)
        return filas
      }},
      { match: '/nomina_descuentos', method: 'DELETE', respond: (url) => { podaUrl = url; return [] } },
      { match: '/nomina_lineas',   method: 'PATCH', respond: (url, init) => {
        enviado = JSON.parse(init.body); return [{ id: IDS.linea }]
      }},
    ])
    const res = await H.handleAjustarLinea(makeRequest({
      lineaId: IDS.linea,
      bonosUsd: 0,
      descuentos: [
        { motivo: 'anticipo', detalle: 'Adelanto quincenal', monto: 10 },
        { motivo: 'falta', monto: 6 },
      ],
    }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    // El desglose queda con motivo, autor y monto por fila
    expect(creadas.map(d => [d.motivo, d.monto_usd])).toEqual([['anticipo', 10], ['falta', 6]])
    expect(creadas.every(d => d.linea_id === IDS.linea && d.periodo_id === IDS.periodo)).toBe(true)
    expect(creadas.every(d => d.cuenta_id === OPERADORES.administracion.cuenta_id)).toBe(true)
    // La poda conserva solo el conjunto nuevo
    expect(podaUrl).toContain(`linea_id=eq.${IDS.linea}`)
    expect(podaUrl).toContain('id=not.in.(desc-0,desc-1)')
    // El recibo totaliza el desglose y compone el resumen legible
    expect(enviado.deducciones_usd).toBe(16)
    expect(enviado.nota_deducciones).toBe('Anticipo — Adelanto quincenal · Falta')
    expect(enviado.total_neto_usd).toBe(161.5) // 177.5 − 16
    expect(body.descuentos).toHaveLength(2)
  })
  it('rechaza el conjunto de descuentos que deja el neto en negativo', async () => {
    mock = installFetchMock([
      { match: '/nomina_lineas',   method: 'GET',   respond: [lineaBase] },
      { match: '/nomina_periodos', respond: [{ estado: 'abierto', nombre: 'P' }] },
    ])
    const res = await H.handleAjustarLinea(
      makeRequest({ lineaId: IDS.linea, bonosUsd: 0, descuentos: [{ motivo: 'prestamo', monto: 9999 }] }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/negativo/i)
    // Nada se escribe cuando el neto quedaría en rojo
    expect(mock.calls.some(c => c.method !== 'GET')).toBe(false)
  })
  it('vaciar la lista elimina el desglose y deja el neto en el bruto', async () => {
    let enviado = null
    let podaUrl = null
    mock = installFetchMock([
      { match: '/nomina_lineas',   method: 'GET',   respond: [lineaBase] },
      { match: '/nomina_periodos', respond: [{ estado: 'abierto', nombre: 'P' }] },
      { match: '/nomina_descuentos', method: 'DELETE', respond: (url) => { podaUrl = url; return [] } },
      { match: '/nomina_lineas',   method: 'PATCH', respond: (url, init) => {
        enviado = JSON.parse(init.body); return [{ id: IDS.linea }]
      }},
    ])
    const res = await H.handleAjustarLinea(
      makeRequest({ lineaId: IDS.linea, bonosUsd: -30, descuentos: [] }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(200)
    expect(mock.calls.some(c => c.method === 'POST')).toBe(false)
    expect(podaUrl).toContain(`linea_id=eq.${IDS.linea}`)
    expect(podaUrl).not.toContain('not.in.')
    expect(enviado.bonos_usd).toBe(0)
    expect(enviado.deducciones_usd).toBe(0)
    expect(enviado.nota_deducciones).toBeNull()
    expect(enviado.total_neto_usd).toBe(177.5)
  })
})
