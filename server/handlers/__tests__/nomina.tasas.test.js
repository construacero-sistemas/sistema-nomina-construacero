import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn(async () => authOk(operadorActual)) }))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))
const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); operadorActual = OPERADORES.administracion; vi.clearAllMocks() })

describe('snapshots de tasas por tenant', () => {
  it('lista snapshots con rango y cuenta', async () => {
    mock = installFetchMock([{ match: '/nomina_tasas_snapshot', respond: [] }])
    const req = makeRequest(undefined, { url: 'http://worker.test/api/nomina/tasas-snapshots?desde=2026-08-01&hasta=2026-08-31' })
    const res = await H.handleGetTasasSnapshots(req, ENV)
    expect((await readResponse(res)).status).toBe(200)
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
    expect(mock.calls[0].url).toContain('limit=500')
  })

  it('crea snapshot no aprobado para no cerrar con una tasa no validada', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', method: 'GET', respond: [{ id: IDS.periodo }] },
      { match: '/nomina_tasas_snapshot', method: 'POST', respond: [{ id: IDS.registro, aprobado: false }] },
    ])
    const res = await H.handleCrearTasaSnapshot(makeRequest({
      fecha: '2026-08-08', monedaOrigen: 'USD', valor: 100, fuente: 'BCV', periodoId: IDS.periodo,
    }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(201)
    expect(body.requiere_aprobacion).toBe(true)
    const post = mock.calls.find(call => call.method === 'POST' && call.url.includes('/nomina_tasas_snapshot'))
    expect(post.body.aprobado).toBe(false)
  })

  it('lista los snapshots congelados de un período por periodoId', async () => {
    mock = installFetchMock([{ match: '/nomina_tasas_snapshot', respond: [] }])
    const req = makeRequest(undefined, { url: `http://worker.test/api/nomina/tasas-snapshots?periodoId=${IDS.periodo}` })
    const res = await H.handleGetTasasSnapshots(req, ENV)
    expect((await readResponse(res)).status).toBe(200)
    expect(mock.calls[0].url).toContain(`periodo_id=eq.${IDS.periodo}`)
    expect(mock.calls[0].url).toContain('motivo')
  })
})

describe('tasa manual trazable (quién, cuándo, por qué)', () => {
  it('lee la última tasa manual de la cuenta', async () => {
    mock = installFetchMock([{ match: '/nomina_tasas_snapshot', respond: [{ valor: 42.5, motivo: 'Acuerdo finanzas', fijada_por_nombre: 'Admin Test', observado_en: '2026-09-27T10:00:00Z' }] }])
    const res = await H.handleGetTasaManual(makeRequest(undefined, { url: 'http://worker.test/api/nomina/tasa-manual' }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.tasa.valor).toBe(42.5)
    expect(body.tasa.fijada_por_nombre).toBe('Admin Test')
    expect(mock.calls[0].url).toContain('fuente=eq.MANUAL')
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
  })

  it('la fija con motivo, quién la puso y auditoría', async () => {
    mock = installFetchMock([
      { match: '/nomina_tasas_snapshot', method: 'POST', respond: [{ id: IDS.registro, valor: 42.5 }] },
    ])
    const res = await H.handleFijarTasaManual(makeRequest({ valor: '42,50', motivo: 'Tasa acordada con finanzas' }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(201)
    expect(body.ok).toBe(true)
    const post = mock.calls.find(call => call.method === 'POST' && call.url.includes('/nomina_tasas_snapshot'))
    expect(post.body.fuente).toBe('MANUAL')
    expect(post.body.valor).toBe('42.50')
    expect(post.body.motivo).toBe('Tasa acordada con finanzas')
    expect(post.body.fijada_por_nombre).toBe('Admin Test')
    expect(post.body.aprobado_por).toBe(OPERADORES.administracion.id)
    expect(post.body.periodo_id).toBeNull()
  })

  it.each([
    ['valor inválido', { valor: 'abc', motivo: 'Motivo válido' }, /valor de tasa/i],
    ['valor cero', { valor: '0', motivo: 'Motivo válido' }, /valor de tasa/i],
    ['motivo demasiado corto', { valor: '42.50', motivo: 'x' }, /motivo/i],
    ['sin motivo', { valor: '42.50' }, /motivo/i],
  ])('rechaza %s sin escribir', async (_caso, payload, esperado) => {
    mock = installFetchMock([])
    const res = await H.handleFijarTasaManual(makeRequest(payload), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(esperado)
    expectSinRed(mock)
  })

  it('un rol sin módulos no fija ni lee la tasa manual', async () => {
    operadorActual = OPERADORES.vendedor
    mock = installFetchMock([])
    const lectura = await readResponse(await H.handleGetTasaManual(makeRequest(undefined, { url: 'http://worker.test/api/nomina/tasa-manual' }), ENV))
    const escritura = await readResponse(await H.handleFijarTasaManual(makeRequest({ valor: '42.50', motivo: 'Motivo válido' }), ENV))
    expect(lectura.status).toBe(403)
    expect(escritura.status).toBe(403)
    expectSinRed(mock)
  })

  it('el rol finanzas puede leer la tasa manual (la usa Finanzas)', async () => {
    operadorActual = OPERADORES.finanzas
    mock = installFetchMock([{ match: '/nomina_tasas_snapshot', respond: [] }])
    const res = await H.handleGetTasaManual(makeRequest(undefined, { url: 'http://worker.test/api/nomina/tasa-manual' }), ENV)
    expect((await readResponse(res)).status).toBe(200)
  })
})

describe('congelado de tasa al cerrar el período', () => {
  const rutasCierre = extra => [
    { match: '/nomina_periodos', method: 'GET', respond: [{ id: IDS.periodo, nombre: 'P', estado: 'abierto' }] },
    { match: '/nomina_lineas', respond: [{ id: IDS.linea }] },
    ...extra,
    { match: '/nomina_periodos', method: 'PATCH', respond: [] },
  ]

  it('congela las tasas del mercado ANTES de cerrar y lo declara en la respuesta', async () => {
    mock = installFetchMock(rutasCierre([
      { match: '/nomina_tasas_snapshot', method: 'POST', respond: [] },
    ]))
    const res = await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo, tasas: { usd: 857.01, eur: 976.9, usdt: 966.54 } }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.tasa_congelada).toBe(true)
    const indicePost = mock.calls.findIndex(call => call.method === 'POST' && call.url.includes('/nomina_tasas_snapshot'))
    const indicePatch = mock.calls.findIndex(call => call.method === 'PATCH' && call.url.includes('/nomina_periodos'))
    expect(indicePost).toBeGreaterThanOrEqual(0)
    expect(indicePost).toBeLessThan(indicePatch) // el snapshot va antes que el cierre
    const post = mock.calls[indicePost]
    expect(post.body).toHaveLength(3)
    expect(post.body.map(row => row.moneda_origen).sort()).toEqual(['EUR', 'USD', 'USDT'])
    for (const row of post.body) {
      expect(row.periodo_id).toBe(IDS.periodo)
      expect(row.cuenta_id).toBe(OPERADORES.administracion.cuenta_id)
      expect(row.aprobado).toBe(true)
      expect(row.aprobado_por).toBe(OPERADORES.administracion.id)
    }
  })

  it('no cierra si el congelado de la tasa falla (fail-closed)', async () => {
    mock = installFetchMock(rutasCierre([
      { match: '/nomina_tasas_snapshot', method: 'POST', respond: { __raw: 'boom', ok: false, status: 500 } },
    ]))
    const res = await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo, tasas: { usd: 857.01 } }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(500)
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
  })

  it('rechaza tasas inválidas sin cerrar', async () => {
    mock = installFetchMock(rutasCierre([]))
    const res = await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo, tasas: { usd: -5 } }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(400)
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
  })

  it('sin tasas cierra como antes y declara que no se congeló nada', async () => {
    mock = installFetchMock(rutasCierre([]))
    const res = await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.tasa_congelada).toBe(false)
    expect(mock.calls.some(call => call.method === 'POST' && call.url.includes('/nomina_tasas_snapshot'))).toBe(false)
  })
})

function expectSinRed(mockLocal) {
  expect(mockLocal.calls).toHaveLength(0)
}
