// server/handlers/__tests__/config.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ENV, OPERADORES, IDS, makeRequest, readResponse, installFetchMock } from './_harness'

const CUENTA_ID = OPERADORES.administracion.cuenta_id

vi.mock('../../lib/auth.js', () => ({
  verifyAuth: vi.fn(async () => ({ id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', email: 'admin@construacero.com' })),
  supaServiceHeaders: () => ({
    apikey: 'test-key',
    Authorization: 'Bearer test-key',
    'Content-Type': 'application/json',
  }),
  invalidateOperatorCache: vi.fn(),
  validateOperator: vi.fn(async () => ({ id: OPERADORES.administracion.id, rol: 'jefe', cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' })),
}))

const { handleGetConfig, handleUpdateConfig } = await import('../config.js')
let mock

afterEach(() => {
  mock?.restore()
  vi.clearAllMocks()
})

describe('config handler', () => {
  it('obtiene la configuración existente', async () => {
    mock = installFetchMock([
      {
        match: '/configuracion_negocio',
        respond: [{
          id: IDS.config,
          cuenta_id: CUENTA_ID,
          nomina_factor_hora_extra: 1.5,
          nomina_tipo_periodo: 'semanal',
          nomina_monto_hora_extra_usd: 4.0,
        }],
      },
    ])

    const res = await handleGetConfig(makeRequest(), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.nomina_tipo_periodo).toBe('semanal')
    expect(body.nomina_monto_hora_extra_usd).toBe(4.0)
  })

  it('actualiza el tipo de período y montos fijos en USD', async () => {
    mock = installFetchMock([
      {
        match: '/configuracion_negocio',
        method: 'PATCH',
        respond: [{
          nomina_tipo_periodo: 'quincenal',
          nomina_monto_hora_extra_usd: 5.0,
          nomina_monto_sabado_usd: 35.0,
          nomina_monto_feriado_usd: 40.0,
        }],
      },
    ])

    const res = await handleUpdateConfig(
      makeRequest({
        nomina_tipo_periodo: 'quincenal',
        nomina_monto_hora_extra_usd: 5.0,
        nomina_monto_sabado_usd: 35.0,
        nomina_monto_feriado_usd: 40.0,
      }),
      ENV
    )

    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.nomina_tipo_periodo).toBe('quincenal')
    expect(body.nomina_monto_hora_extra_usd).toBe(5.0)
  })

  it('valida tipo de período inválido', async () => {
    const res = await handleUpdateConfig(
      makeRequest({ nomina_tipo_periodo: 'invalido' }),
      ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/nomina_tipo_periodo/i)
  })

  it('actualiza el horario general estándar de la empresa', async () => {
    mock = installFetchMock([
      {
        match: '/configuracion_negocio',
        method: 'PATCH',
        respond: [{
          nomina_hora_inicio: '07:30',
          nomina_hora_fin: '16:30',
          nomina_horas_jornada: 8.0,
          nomina_horas_descanso: 1.0,
        }],
      },
    ])

    const res = await handleUpdateConfig(
      makeRequest({
        nomina_hora_inicio: '07:30',
        nomina_hora_fin: '16:30',
        nomina_horas_jornada: 8,
        nomina_horas_descanso: 1,
      }),
      ENV
    )

    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.nomina_hora_inicio).toBe('07:30')
    expect(body.nomina_hora_fin).toBe('16:30')
    expect(body.nomina_horas_jornada).toBe(8.0)
    expect(body.nomina_horas_descanso).toBe(1.0)
  })

  it('valida formato de horas y jornada inválida', async () => {
    const res1 = await handleUpdateConfig(
      makeRequest({ nomina_hora_inicio: 'hora-invalida' }),
      ENV
    )
    const { status: s1, body: b1 } = await readResponse(res1)
    expect(s1).toBe(400)
    expect(String(b1.error)).toMatch(/nomina_hora_inicio/i)

    const res2 = await handleUpdateConfig(
      makeRequest({ nomina_horas_jornada: 25 }),
      ENV
    )
    const { status: s2, body: b2 } = await readResponse(res2)
    expect(s2).toBe(400)
    expect(String(b2.error)).toMatch(/nomina_horas_jornada/i)
  })
})
