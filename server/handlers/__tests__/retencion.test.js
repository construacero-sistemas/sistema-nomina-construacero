// server/handlers/__tests__/retencion.test.js
// Tests de la purga inteligente (retención) — sin red ni secretos reales.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'
import {
  handleGetRetencion,
  handlePurgarRetencion,
  handleConfigurarRetencion,
} from '../retencion.js'

let operadorActual = OPERADORES.administracion
let mock

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: vi.fn(() => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' })),
}))

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
})

function urlBase() {
  return `${ENV.SUPABASE_URL}/rest/v1`
}

describe('purga inteligente', () => {
  it('GET /api/retencion devuelve la ventana y los últimos logs (admin)', async () => {
    mock = installFetchMock([
      { match: '/configuracion_negocio', respond: [{ retencion_meses: 3 }] },
      { match: '/purga_log', respond: [
        {
          creado_en: '2026-08-01T10:00:00Z', disparador: 'cron', dry_run: false,
          retencion_meses: 3, cutoff: '2026-05-01',
          resumen: { registro_asistencia: 120, nomina_tasas_snapshot: 8, auditoria: 45 },
          total_eliminadas: 173,
        },
      ] },
    ])
    const res = await handleGetRetencion(makeRequest(undefined, { url: `${urlBase()}/retencion` }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.retencion_meses).toBe(3)
    expect(body.min_meses).toBe(1)
    expect(body.max_meses).toBe(36)
    expect(body.ultimos_logs).toHaveLength(1)
    expect(body.ultimos_logs[0].total_eliminadas).toBe(173)
  })

  it('POST /api/retencion/purgar en dry-run NO borra (llama función con p_dry_run=true)', async () => {
    mock = installFetchMock([
      { match: '/rpc/retencion_purga', method: 'POST', respond: (url, init) => {
        expect(JSON.parse(init.body).p_dry_run).toBe(true)
        return [
          { tabla: 'registro_asistencia', eliminadas: 120 },
          { tabla: 'nomina_tasas_snapshot', eliminadas: 8 },
          { tabla: 'auditoria', eliminadas: 45 },
        ]
      } },
      { match: '/auditoria', method: 'POST', respond: [] },
      { match: '/usuarios', respond: [] },
    ])
    const res = await handlePurgarRetencion(makeRequest({ dry_run: true, meses: 3 }, { url: `${urlBase()}/retencion/purgar` }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.dry_run).toBe(true)
    expect(body.total_eliminadas).toBe(173)
    expect(body.detalle).toHaveLength(3)
  })

  it('POST /api/retencion/purgar en modo real borra (p_dry_run=false)', async () => {
    mock = installFetchMock([
      { match: '/rpc/retencion_purga', method: 'POST', respond: (url, init) => {
        expect(JSON.parse(init.body).p_dry_run).toBe(false)
        return [{ tabla: 'registro_asistencia', eliminadas: 240 }]
      } },
      { match: '/auditoria', method: 'POST', respond: [] },
      { match: '/usuarios', respond: [] },
    ])
    const res = await handlePurgarRetencion(makeRequest({ dry_run: false, meses: 3 }, { url: `${urlBase()}/retencion/purgar` }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.dry_run).toBe(false)
    expect(body.total_eliminadas).toBe(240)
  })

  it('valida meses fuera de rango', async () => {
    mock = installFetchMock([])
    for (const meses of [0, 37, 3.5, 'x']) {
      const res = await handlePurgarRetencion(makeRequest({ dry_run: true, meses }, { url: `${urlBase()}/retencion/purgar` }), ENV)
      const { status } = await readResponse(res)
      expect(status).toBe(400)
    }
  })

  it('deniega a un rol no administrador', async () => {
    operadorActual = OPERADORES.supervisor
    mock = installFetchMock([])
    const res = await handlePurgarRetencion(makeRequest({ dry_run: true, meses: 3 }, { url: `${urlBase()}/retencion/purgar` }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(403)
  })

  it('POST /api/retencion/configurar guarda la ventana', async () => {
    mock = installFetchMock([
      { match: '/configuracion_negocio', method: 'PATCH', respond: [{ retencion_meses: 6 }] },
    ])
    const res = await handleConfigurarRetencion(makeRequest({ meses: 6 }, { url: `${urlBase()}/retencion/configurar` }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.retencion_meses).toBe(6)
  })

  it('configurar rechaza meses inválidos', async () => {
    mock = installFetchMock([])
    const res = await handleConfigurarRetencion(makeRequest({ meses: 99 }, { url: `${urlBase()}/retencion/configurar` }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(400)
  })
})
