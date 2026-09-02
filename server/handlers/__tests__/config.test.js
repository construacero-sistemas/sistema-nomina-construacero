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
  validateOperator: vi.fn(async () => ({ id: OPERADORES.administracion.id, rol: 'administracion', cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' })),
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
})
