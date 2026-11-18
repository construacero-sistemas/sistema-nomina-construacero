// server/handlers/__tests__/nomina.semana-automatica.test.js
// Período automático de la semana en curso (jueves → miércoles por defecto).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'
import { moverSemana, nombreSemana, rangoSemana, semanaDeConfig, validarSemana } from '../../lib/nominaSemana.js'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../nomina.periodos.js')
let mock
// Martes 17/11/2026 a mediodía en Caracas.
const ENV_HOY = { ...ENV, NOMINA_NOW: '2026-11-17T16:00:00Z' }

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

describe('nominaSemana — cálculo de la semana', () => {
  it('por defecto la semana va de jueves a miércoles', () => {
    expect(rangoSemana('2026-11-05')).toEqual({ desde: '2026-11-05', hasta: '2026-11-11' })
    expect(rangoSemana('2026-11-11')).toEqual({ desde: '2026-11-05', hasta: '2026-11-11' })
    expect(rangoSemana('2026-11-17')).toEqual({ desde: '2026-11-12', hasta: '2026-11-18' })
  })

  it('respeta otro día de inicio y mueve semanas completas', () => {
    expect(rangoSemana('2026-11-17', 1)).toEqual({ desde: '2026-11-16', hasta: '2026-11-22' })
    expect(moverSemana({ desde: '2026-11-12' }, -1)).toEqual({ desde: '2026-11-05', hasta: '2026-11-11' })
  })

  it('usa automático + jueves si la config no trae las columnas', () => {
    expect(semanaDeConfig({})).toEqual({ modo: 'automatico', inicio: 4 })
    expect(semanaDeConfig({ nomina_periodo_modo: 'manual', nomina_semana_inicio: 1 })).toEqual({ modo: 'manual', inicio: 1 })
  })

  it('valida modo y día de inicio', () => {
    expect(validarSemana({ nomina_periodo_modo: 'otro' }).error).toBeTruthy()
    expect(validarSemana({ nomina_semana_inicio: 7 }).error).toBeTruthy()
    expect(validarSemana({ nomina_semana_inicio: 0 }).fields).toEqual({ nomina_semana_inicio: 0 })
  })

  it('arma el nombre con las fechas de la semana', () => {
    expect(nombreSemana('2026-11-12', '2026-11-18')).toMatch(/^Semana 12.*nov.*18.*nov.* 2026$/)
  })
})

describe('POST /api/nomina/periodos/asegurar-semana', () => {
  it('en modo automático crea la semana jueves → miércoles si no existe', async () => {
    mock = installFetchMock([
      { match: 'configuracion_negocio', method: 'GET', respond: [{}] },
      { match: 'nomina_periodos?desde=lte.', method: 'GET', respond: [] },
      { match: /nomina_periodos$/, method: 'POST', respond: (_u, init) => [{ id: 'p-nuevo', ...JSON.parse(init.body) }] },
    ])
    const { status, body } = await readResponse(await H.handleAsegurarSemanaActual(makeRequest({}), ENV_HOY))
    expect(status).toBe(201)
    expect(body.creado).toBe(true)
    const post = mock.calls.find(c => c.method === 'POST')
    expect(post.body).toMatchObject({ desde: '2026-11-12', hasta: '2026-11-18', tipo: 'semanal', estado: 'abierto' })
  })

  it('no duplica si ya hay un período en esas fechas', async () => {
    const existente = { id: 'p-1', nombre: 'Semana 12–18 nov', desde: '2026-11-12', hasta: '2026-11-18', estado: 'abierto' }
    mock = installFetchMock([
      { match: 'configuracion_negocio', method: 'GET', respond: [{ nomina_periodo_modo: 'automatico', nomina_semana_inicio: 4 }] },
      { match: 'nomina_periodos?desde=lte.2026-11-18&hasta=gte.2026-11-12', method: 'GET', respond: [existente] },
    ])
    const { status, body } = await readResponse(await H.handleAsegurarSemanaActual(makeRequest({}), ENV_HOY))
    expect(status).toBe(200)
    expect(body).toMatchObject({ creado: false, periodo: { id: 'p-1' } })
    expect(mock.calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('en modo manual no crea nada', async () => {
    mock = installFetchMock([
      { match: 'configuracion_negocio', method: 'GET', respond: [{ nomina_periodo_modo: 'manual', nomina_semana_inicio: 4 }] },
    ])
    const { status, body } = await readResponse(await H.handleAsegurarSemanaActual(makeRequest({}), ENV_HOY))
    expect(status).toBe(200)
    expect(body).toMatchObject({ modo: 'manual', creado: false })
    expect(mock.calls.some(c => c.url.includes('nomina_periodos'))).toBe(false)
  })
})
