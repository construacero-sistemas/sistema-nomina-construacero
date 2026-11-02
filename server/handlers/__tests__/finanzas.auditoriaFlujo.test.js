// server/handlers/__tests__/finanzas.auditoriaFlujo.test.js
// Correcciones de la auditoría de finanzas (2026-11-01): saldo oculto al rol finanzas,
// mensajes claros de mes cerrado, reabrir cierre, variantes de categoría y sync sin secreto.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion
vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}), auditoriasPendientes: vi.fn(async () => []) }))

const H = await import('../finanzas.js')
const M = await import('../finanzas.periodos.js')
const S = await import('../finanzas.sync.js')
const C = await import('../finanzas.categorias.js')
let mock

afterEach(() => { mock?.restore(); operadorActual = OPERADORES.administracion })

const movementInput = {
  fecha: '2026-08-18', tipo: 'egreso', categoria: 'Proveedores', concepto: 'Cemento',
  monto: 100, moneda: 'USD', tasaVes: 120, fuenteTasa: 'MANUAL',
  observacionTasa: 'Aprobada por administración', idempotencyKey: 'movimiento-test-0001',
}

describe('saldo de la cartera según el rol', () => {
  const instalar = () => {
    mock = installFetchMock([
      { match: `/cuentas_custodia?id=eq.${IDS.config}`, method: 'GET', respond: [{ id: IDS.config, nombre: 'Caja USD', moneda: 'USD' }] },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/rpc/finanzas_saldos', method: 'POST', respond: { schemaVersion: 1, cuentas: [{ cuentaCustodiaId: IDS.config, saldoNativo: '60' }] } },
      { match: '/finanzas_movimientos?cuenta_id=', method: 'GET', respond: [] },
    ])
  }
  const crear = async () => readResponse(await H.handleCrearFinanzasMovimiento(makeRequest({ ...movementInput, cuentaCustodiaId: IDS.config }), ENV))

  it('el rol finanzas recibe el rechazo sin el saldo disponible', async () => {
    operadorActual = OPERADORES.finanzas
    instalar()
    const { status, body } = await crear()
    expect(status).toBe(409)
    expect(body.code).toBe('FINANCIAL_INSUFFICIENT_FUNDS')
    expect(body).not.toHaveProperty('disponible')
    expect(body).not.toHaveProperty('faltante')
    expect(JSON.stringify(body)).not.toMatch(/60/)
  })

  it('el jefe sigue viendo cuánto falta', async () => {
    instalar()
    const { body } = await crear()
    expect(body).toMatchObject({ disponible: 60, faltante: 40 })
  })
})

describe('mes cerrado: mensajes claros', () => {
  it('anular un movimiento de un mes cerrado explica el motivo', async () => {
    const fila = { id: IDS.linea, ...movementInput, estado: 'activo', tasa_ves: 120, monto_ves: 12000 }
    mock = installFetchMock([
      { match: '/finanzas_movimientos?id=eq.', method: 'GET', respond: [fila] },
      { match: '/finanzas_movimientos?id=eq.', method: 'PATCH', respond: { __raw: '{"code":"PT409","message":"Closed monthly ledger is immutable"}', ok: false, status: 409 } },
    ])
    const request = makeRequest({ id: IDS.linea, motivo: 'Error de digitación', idempotencyKey: 'anulacion-test-000001' })
    const { status, body } = await readResponse(await H.handleAnularFinanzasMovimiento(request, ENV))
    expect(status).toBe(409)
    expect(body.error).toMatch(/mes ya está cerrado/i)
  })
})

describe('reabrir un cierre mensual', () => {
  const pedir = body => M.handleReabrirFinanzasPeriodoMensual(makeRequest(body), ENV)

  it('valida mes y motivo antes de consultar y solo lo permite al jefe', async () => {
    mock = installFetchMock([])
    expect((await readResponse(await pedir({ mesInicio: '2026-13-01', motivo: 'Cierre hecho por error' }))).status).toBe(400)
    expect((await readResponse(await pedir({ mesInicio: '2026-10-01', motivo: 'corto' }))).status).toBe(400)
    operadorActual = OPERADORES.finanzas
    expect((await readResponse(await pedir({ mesInicio: '2026-10-01', motivo: 'Cierre hecho por error' }))).status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })

  it('llama a la RPC con el operador y devuelve el estado', async () => {
    mock = installFetchMock([{ match: '/rpc/finanzas_periodo_mensual_reabrir', method: 'POST', respond: { ok: true, estado: 'abierto', mes: '2026-10-01' } }])
    const { status, body } = await readResponse(await pedir({ mesInicio: '2026-10-01', motivo: '  Cierre hecho por error  ' }))
    expect(status).toBe(200)
    expect(body.estado).toBe('abierto')
    expect(mock.calls[0].body).toMatchObject({ p_cuenta_id: OPERADORES.administracion.cuenta_id, p_mes_inicio: '2026-10-01', p_motivo: 'Cierre hecho por error' })
  })

  it('traduce las reglas de la base a un mensaje claro', async () => {
    mock = installFetchMock([{ match: '/rpc/finanzas_periodo_mensual_reabrir', method: 'POST', respond: { __raw: '{"code":"PT409","message":"A later month is already opened"}', ok: false, status: 409 } }])
    const { status, body } = await readResponse(await pedir({ mesInicio: '2026-10-01', motivo: 'Cierre hecho por error' }))
    expect(status).toBe(409)
    expect(body.error).toMatch(/mes siguiente ya está abierto/i)
  })
})

describe('categorías: variantes del mismo nombre', () => {
  it('rechaza una variante por mayúsculas, puntos o plural y no escribe', async () => {
    mock = installFetchMock([{ match: '/finanzas_categorias', method: 'GET', respond: [{ nombre: 'GASTO EMPRESA.' }, { nombre: 'Recargas' }] }])
    const crear = nombre => C.handleCrearFinanzasCategoria(makeRequest({ nombre, tipo: 'egreso' }), ENV).then(readResponse)
    const uno = await crear('Gasto empresa')
    expect(uno.status).toBe(409)
    expect(uno.body).toMatchObject({ code: 'CATEGORIA_PARECIDA', parecida: 'GASTO EMPRESA.' })
    expect((await crear('recarga')).status).toBe(409)
    expect(mock.calls.filter(call => call.method === 'POST')).toHaveLength(0)
  })
})

describe('sincronización con el POS', () => {
  it('ignora posUrl del cuerpo y sin secreto no envía nada por HTTP al POS', async () => {
    mock = installFetchMock([])
    const env = { ...ENV, FINANZAS_SYNC_SECRET: undefined, SYNC_SECRET_KEY: undefined }
    await S.handleSyncVentasPos(makeRequest({ fecha: '2026-10-05', posUrl: 'https://atacante.example' }), env).catch(() => null)
    const destinos = mock.calls.map(call => call.url)
    expect(destinos.some(url => url.includes('atacante.example'))).toBe(false)
    expect(destinos.some(url => url.includes('/api/finanzas-sync/'))).toBe(false)
  })

  it('con secreto configurado lo envía solo a la dirección del servidor', async () => {
    mock = installFetchMock([{ match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: { ok: false } }])
    const env = { ...ENV, FINANZAS_SYNC_SECRET: 'secreto-de-prueba', POS_API_URL: 'https://pos.interno.example' }
    await S.handleSyncVentasPos(makeRequest({ fecha: '2026-10-05', posUrl: 'https://atacante.example' }), env).catch(() => null)
    const llamadas = mock.calls.filter(call => call.url.includes('/api/finanzas-sync/'))
    expect(llamadas.length).toBeGreaterThan(0)
    llamadas.forEach(call => expect(call.url.startsWith('https://pos.interno.example')).toBe(true))
  })

  it('está en pausa por defecto: responde 503 sin tocar la red ni la base', async () => {
    mock = installFetchMock([])
    const env = { ...ENV, FINANZAS_SYNC_ACTIVO: undefined }
    const { status, body } = await readResponse(await S.handleSyncVentasPos(makeRequest({ fecha: '2026-10-05', confirm: true }), env))
    expect(status).toBe(503)
    expect(body.code).toBe('SYNC_POS_PAUSADO')
    expect(mock.calls).toHaveLength(0)
  })
})
