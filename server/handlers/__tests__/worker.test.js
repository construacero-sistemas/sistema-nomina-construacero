import { describe, expect, it } from 'vitest'
import worker from '../../../worker.js'

const ENV = {
  NOMINA_ALLOWED_ORIGINS: 'https://nomina.example.com',
}

describe('worker HTTP guardrails', () => {
  it('responde ping con headers de seguridad y CORS exacto', async () => {
    const response = await worker.fetch(new Request('https://worker.test/api/ping', {
      headers: { Origin: 'https://nomina.example.com' },
    }), ENV)

    expect(response.status).toBe(200)
    expect((await response.json()).service).toBe('nomina-construacero')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://nomina.example.com')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
  })

  it('no habilita CORS para un origen no configurado', async () => {
    const response = await worker.fetch(new Request('https://worker.test/api/ping', {
      headers: { Origin: 'https://otro.example.com' },
    }), ENV)

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('rechaza bodies mayores al límite aunque la ruta no exista', async () => {
    const body = 'x'.repeat(256 * 1024 + 1)
    const response = await worker.fetch(new Request('https://worker.test/api/no-existe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }), ENV)

    expect(response.status).toBe(413)
    expect((await response.json()).error).toMatch(/demasiado grande/i)
  })

  it('protege las rutas financieras sin sesión en el Worker', async () => {
    const response = await worker.fetch(new Request('https://worker.test/api/finanzas/reportes/resumen?desde=2026-08-01&hasta=2026-08-31'), ENV)
    expect(response.status).toBe(401)
    expect((await response.json()).error).toMatch(/autenticado/i)
  })
})
