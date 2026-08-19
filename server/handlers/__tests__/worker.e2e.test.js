// server/handlers/__tests__/worker.e2e.test.js
// Smoke E2E del orquestador HTTP: Worker → auth → handler → Supabase mock.
// No usa credenciales, red externa ni datos persistentes.
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../../worker.js'

const ACCOUNT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111'
const SUPABASE_URL = 'https://supabase.e2e.invalid'
const ENV = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: 'anon-e2e-only',
  SUPABASE_SERVICE_KEY: 'service-e2e-only',
  NOMINA_ALLOWED_ORIGINS: 'https://nomina.example.com',
  NOMINA_TIMEZONE: 'America/Caracas',
}

function supabaseResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function request(path, options = {}) {
  return new Request(`https://worker.e2e.test${path}`, options)
}

const movement = {
  id: '10000000-0000-4000-8000-000000000001',
  fecha: '2026-08-18',
  tipo: 'egreso',
  categoria: 'Proveedores',
  concepto: 'Cemento',
  monto: 100,
  moneda: 'USD',
  tasa_ves: 120,
  monto_ves: 12000,
  fuente_tasa: 'MANUAL',
  observacion_tasa: 'Aprobada',
  estado: 'activo',
  creado_en: '2026-08-18T12:00:00.000Z',
}

afterEach(() => vi.unstubAllGlobals())

describe('Worker E2E determinista', () => {
  it.each([
    'GET /api/finanzas/movimientos?desde=2026-08-01&hasta=2026-08-31',
    'GET /api/finanzas/reportes/resumen?desde=2026-08-01&hasta=2026-08-31',
    'GET /api/finanzas/categorias',
    'POST /api/finanzas/movimientos/crear',
    'GET /api/nomina/periodos',
  ])('protege %s sin sesión y no alcanza Supabase', async path => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const [method, url] = path.split(' ')
    const response = await worker.fetch(request(url, { method }), ENV)

    expect(response.status).toBe(401)
    expect((await response.json()).error).toMatch(/autenticado/i)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('orquesta crear → listar → resumir → anular con tenant y rol únicos', async () => {
    const upstream = vi.fn(async (url, init = {}) => {
      const target = String(url)
      const method = (init.method || 'GET').toUpperCase()
      if (target.endsWith('/auth/v1/user')) {
        return supabaseResponse({ id: ACCOUNT_ID, app_metadata: { operator_id: OPERATOR_ID } })
      }
      if (target.includes('/rest/v1/usuarios?')) {
        return supabaseResponse([{ id: OPERATOR_ID, nombre: 'Administración', rol: 'administracion', cuenta_id: ACCOUNT_ID }])
      }
      if (target.includes('/rest/v1/auditoria')) return supabaseResponse([])
      if (target.includes('/rest/v1/finanzas_movimientos') && method === 'GET' && target.includes('idempotency_key=')) {
        return supabaseResponse([])
      }
      if (target.includes('/rest/v1/finanzas_movimientos') && method === 'POST') {
        return supabaseResponse([movement])
      }
      if (target.includes('/rest/v1/finanzas_movimientos') && method === 'GET') {
        return supabaseResponse([movement])
      }
      if (target.includes('/rest/v1/rpc/finanzas_resumen')) {
        return supabaseResponse([{ tipo: 'egreso', categoria: 'Proveedores', total_ves: 12000, movimientos: 1 }])
      }
      if (target.includes('/rest/v1/finanzas_movimientos') && method === 'PATCH') {
        return supabaseResponse([{ ...movement, estado: 'anulado', motivo_anulacion: 'Duplicado', anulado_en: '2026-08-18T13:00:00.000Z' }])
      }
      if (target.includes('/rest/v1/finanzas_categorias')) return supabaseResponse([])
      throw new Error(`Ruta Supabase no declarada en smoke E2E: ${method} ${target}`)
    })
    vi.stubGlobal('fetch', upstream)
    const auth = { Authorization: 'Bearer e2e-finance-token-unique' }
    const createBody = {
      fecha: '2026-08-18', tipo: 'egreso', categoria: 'Proveedores', concepto: 'Cemento',
      monto: 100, moneda: 'USD', tasaVes: 120, fuenteTasa: 'MANUAL',
      observacionTasa: 'Aprobada', idempotencyKey: 'e2e-movimiento-000001',
    }

    const created = await worker.fetch(request('/api/finanzas/movimientos/crear', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(createBody),
    }), ENV)
    expect(created.status).toBe(201)
    expect((await created.json()).movimiento.monto_ves).toBe(12000)

    const listed = await worker.fetch(request('/api/finanzas/movimientos?desde=2026-08-01&hasta=2026-08-31&offset=1', { headers: auth }), ENV)
    expect(listed.status).toBe(200)
    expect((await listed.json()).movimientos[0].concepto).toBe('Cemento')

    const summary = await worker.fetch(request('/api/finanzas/reportes/resumen?desde=2026-08-01&hasta=2026-08-31&moneda=USD&tipo=egreso&categoria=Proveedores', { headers: auth }), ENV)
    expect(summary.status).toBe(200)
    expect((await summary.json()).resumen.balance_ves).toBe(-12000)

    const cancelled = await worker.fetch(request('/api/finanzas/movimientos/anular', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: movement.id, motivo: 'Duplicado', idempotencyKey: 'e2e-anulacion-000001' }),
    }), ENV)
    expect(cancelled.status).toBe(200)
    expect((await cancelled.json()).movimiento.estado).toBe('anulado')

    const databaseCalls = upstream.mock.calls.filter(([url]) => String(url).includes('/rest/v1/'))
    expect(databaseCalls.length).toBeGreaterThan(0)
    for (const [url, init] of databaseCalls) {
      const target = String(url)
      if (target.includes('/rpc/finanzas_resumen')) {
        expect(JSON.parse(init.body).p_cuenta_id).toBe(ACCOUNT_ID)
        expect(JSON.parse(init.body).p_tipo).toBe('egreso')
        expect(JSON.parse(init.body).p_categoria).toBe('Proveedores')
      } else if (target.includes('/usuarios?') || target.includes('/finanzas_')) {
        if ((init.method || 'GET').toUpperCase() === 'POST') {
          expect(JSON.parse(init.body).cuenta_id).toBe(ACCOUNT_ID)
        } else {
          expect(target).toContain(`cuenta_id=eq.${ACCOUNT_ID}`)
        }
      }
    }
  })
})
