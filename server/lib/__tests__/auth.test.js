import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOperatorRole, verifyAuth } from '../auth.js'

const ACCOUNT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OPERATOR_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const ENV = {
  SUPABASE_URL: 'https://supabase.test.invalid',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_KEY: 'service-test-key',
}

function jwtWithExp(exp) {
  const encode = value => btoa(JSON.stringify(value))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp })}.signature`
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('autenticación server-side', () => {
  it('no acepta un JWT expirado ni consulta Supabase', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://worker.test/api/ping', {
      headers: { Authorization: `Bearer ${jwtWithExp(Math.floor(Date.now() / 1000) - 1)}` },
    })

    await expect(verifyAuth(request, ENV)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('usa la service key como respaldo si falta la anon key en el Worker', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: ACCOUNT_ID }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://worker.test/api/auth/select-operator', {
      headers: { Authorization: 'Bearer auth-test-token-without-exp' },
    })

    await expect(verifyAuth(request, { ...ENV, SUPABASE_ANON_KEY: '' })).resolves.toMatchObject({ id: ACCOUNT_ID })
    expect(fetchMock.mock.calls[0][1].headers.apikey).toBe(ENV.SUPABASE_SERVICE_KEY)
  })

  it('la cabecera X-Operator-Id del navegador nunca decide el operador', async () => {
    // F2: el operador SOLO sale de app_metadata (escrita tras validar el PIN).
    // Si la cabecera pudiera sobrescribirlo, cualquiera operaría como otro sin PIN.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: ACCOUNT_ID, app_metadata: { operator_id: OPERATOR_ID, operator_rol: 'jefe' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://worker.test/api/finanzas/movimientos', {
      headers: {
        Authorization: 'Bearer auth-test-token-without-exp',
        'X-Operator-Id': 'bbbbbbbb-2222-4222-8222-999999999999',
      },
    })

    const user = await verifyAuth(request, ENV)
    expect(user.operator_id).toBe(OPERATOR_ID)
    // Ni siquiera consulta la base para "verificar" la cabecera.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('limita la consulta de rol al tenant explícito', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ rol: 'jefe' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getOperatorRole(OPERATOR_ID, ENV, ACCOUNT_ID)).resolves.toBe('jefe')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain(`id=eq.${OPERATOR_ID}`)
    expect(fetchMock.mock.calls[0][0]).toContain(`cuenta_id=eq.${ACCOUNT_ID}`)
  })

  it('rechaza resolver roles sin cuenta', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getOperatorRole(OPERATOR_ID, ENV)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
