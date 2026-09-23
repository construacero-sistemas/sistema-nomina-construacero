import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../../worker.js'
import { cacheResponse, clearEgressCache, egressRequestKey } from '../../lib/egressCache.js'
import { validateOperator } from '../../lib/auth.js'

const account = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const operator = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const env = { SUPABASE_URL: 'https://authorization.test.invalid', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_KEY: 'test-service' }
const expiredToken = () => `e30.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 1 }))}.test`
afterEach(() => { clearEgressCache(); vi.unstubAllGlobals() })

describe('autorización incluso con caché caliente', () => {
  it('rechaza un token vencido aunque exista la respuesta protegida en caché', async () => {
    const request = new Request('https://worker.test/api/nomina/empleados', { headers: { Authorization: `Bearer ${expiredToken()}` } })
    await cacheResponse(await egressRequestKey(request), new Response(JSON.stringify([{ nombre: 'Privado' }])), 600000)
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('comprueba una revocación de operador en la siguiente solicitud con el mismo token', async () => {
    let active = true
    const fetchMock = vi.fn(async url => {
      if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: account, app_metadata: { operator_id: operator } }))
      if (String(url).includes('/usuarios?')) return new Response(JSON.stringify(active ? [{ id: operator, cuenta_id: account, nombre: 'Test', rol: 'jefe' }] : []))
      throw new Error('Unexpected upstream')
    })
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://worker.test/api/nomina/empleados', { headers: { Authorization: 'Bearer revocation-test-only' } })
    expect((await validateOperator(request, env)).operador.id).toBe(operator)
    active = false
    const revoked = await validateOperator(request, env)
    expect(revoked.error.status).toBe(403)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/usuarios?'))).toHaveLength(2)
  })
})
