// Utilidades de aislamiento para los tests de handlers de Nómina.
// SUPABASE_URL usa .invalid y installFetchMock aborta cualquier URL no declarada.

import { vi, expect } from 'vitest'

export const SUPABASE_URL = 'http://supabase.test.invalid'

export const ENV = {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY: 'test-service-key-no-real',
  SUPABASE_ANON_KEY: 'test-anon-key-no-real',
}

export const OPERADORES = {
  administracion: { id: '11111111-1111-4111-8111-111111111111', nombre: 'Admin Test',      rol: 'administracion', cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  jefe:           { id: '22222222-2222-4222-8222-222222222222', nombre: 'Jefe Test',       rol: 'jefe',           cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  desarrollador:  { id: '33333333-3333-4333-8333-333333333333', nombre: 'Dev Test',        rol: 'desarrollador',  cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  logistica:      { id: '44444444-4444-4444-8444-444444444444', nombre: 'Logistica Test',  rol: 'logistica',      cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  supervisor:     { id: '55555555-5555-4555-8555-555555555555', nombre: 'Supervisor Test', rol: 'supervisor',     cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
  vendedor:       { id: '66666666-6666-4666-8666-666666666666', nombre: 'Vendedor Test',   rol: 'vendedor',       cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
}

export const IDS = {
  empleado:  'e0000000-0000-4000-8000-000000000001',
  empleado2: 'e0000000-0000-4000-8000-000000000002',
  config:    'c0000000-0000-4000-8000-000000000001',
  periodo:   'b0000000-0000-4000-8000-000000000001',
  linea:     '10000000-0000-4000-8000-000000000001',
  linea2:    '10000000-0000-4000-8000-000000000002',
  registro:  'a0000000-0000-4000-8000-000000000001',
  invalido:  'no-es-un-uuid',
}

export function makeRequest(body = undefined, { url = 'http://worker.test/api/nomina/x' } = {}) {
  return {
    url,
    method: 'POST',
    headers: { get: () => null },
    json: async () => {
      if (body === '__INVALID_JSON__') throw new Error('Unexpected token')
      return body
    },
  }
}

function makeResponse(data, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  }
}

export function installFetchMock(routes = []) {
  const calls = []
  const impl = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? safeParse(init.body) : undefined
    calls.push({ url: String(url), method, body, headers: init.headers })

    if (!String(url).startsWith(SUPABASE_URL)) {
      throw new Error(`[harness] Petición fuera del host de prueba: ${url}`)
    }

    for (const route of routes) {
      const okUrl = route.match instanceof RegExp
        ? route.match.test(String(url))
        : String(url).includes(route.match)
      const okMethod = !route.method || route.method.toUpperCase() === method
      if (okUrl && okMethod) {
        const output = typeof route.respond === 'function'
          ? await route.respond(String(url), init)
          : route.respond
        if (output && typeof output === 'object' && '__raw' in output) {
          return makeResponse(output.__raw, output)
        }
        return makeResponse(output)
      }
    }

    throw new Error(
      `[harness] Petición no declarada en el mock:\n  ${method} ${url}\n` +
      `  Rutas declaradas: ${routes.map(route => route.match).join(', ') || '(ninguna)'}`,
    )
  })

  const original = globalThis.fetch
  globalThis.fetch = impl
  return {
    calls,
    fetchMock: impl,
    restore() { globalThis.fetch = original },
  }
}

function safeParse(value) {
  try { return JSON.parse(value) } catch { return value }
}

export async function readResponse(response) {
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

export function authOk(operador) {
  return {
    user: { id: operador.id, operator_id: operador.id },
    operador,
    headers: { apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    ip: '127.0.0.1',
  }
}

export function expectSinRedReal(calls) {
  for (const call of calls) expect(call.url.startsWith(SUPABASE_URL)).toBe(true)
}
