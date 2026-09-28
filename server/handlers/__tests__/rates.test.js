// server/handlers/__tests__/rates.test.js
// Pruebas deterministas del buscador de tasas de cambio (GET /api/rates):
// fuentes, respaldos, caché y promedio USDT. Sin red real: fetch está stubado
// por URL y el módulo se reimporta limpio en cada prueba (cache del módulo).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BCV_HTML = `
  <html><body>
    <span id="dolar"> <strong>857,01</strong> </span>
    <span id="euro"> <strong>976,90</strong> </span>
  </body></html>
`

const routes = []
let originalFetch

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const target = String(url)
    for (const route of routes) {
      if (target.includes(route.match)) {
        const output = typeof route.respond === 'function' ? await route.respond(target) : route.respond
        return {
          ok: output?.status ? output.status < 400 : true,
          status: output?.status ?? 200,
          json: async () => (typeof output?.json === 'string' ? JSON.parse(output.json) : output?.json ?? output),
          text: async () => (typeof output?.text === 'string' ? output.text : JSON.stringify(output?.json ?? output)),
        }
      }
    }
    throw new Error(`[rates.test] Petición no declarada: ${target}`)
  }))
}

async function loadHandler() {
  vi.resetModules()
  return (await import('../rates.js')).handleGetRates
}

function makeRequest(url = 'http://worker.test/api/rates') {
  return { url, method: 'GET', headers: { get: () => null } }
}

beforeEach(() => {
  routes.length = 0
  originalFetch = globalThis.fetch
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  globalThis.fetch = originalFetch
})

describe('handleGetRates (GET /api/rates)', () => {
  it('responde con el BCV oficial cuando publica USD y EUR', async () => {
    routes.push({ match: 'bcv.org.ve', respond: { text: BCV_HTML } })
    routes.push({ match: 'criptoya.com', respond: { json: { ask: 970, bid: 960 } } })
    const handleGetRates = await loadHandler()
    const res = await handleGetRates(makeRequest(), {})
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.bcv.price).toBe(857.01)
    expect(body.euro.price).toBe(976.9)
    expect(body.usdt.price).toBe(965) // (ask + bid) / 2
    expect(body.source).toBe('BCV Oficial')
  })

  it('usa el respaldo del CDN cuando el sitio del BCV falla', async () => {
    routes.push({ match: 'bcv.org.ve', respond: () => { throw new Error('BCV caído') } })
    routes.push({ match: 'rates.dolarvzla.com', respond: { json: { current: { usd: 850, eur: 970 } } } })
    routes.push({ match: 'criptoya.com', respond: { json: { ask: 970, bid: 960 } } })
    const handleGetRates = await loadHandler()
    const res = await handleGetRates(makeRequest(), {})
    const body = await res.json()
    expect(body.bcv.price).toBe(850)
    expect(body.source).toBe('BCV (respaldo público)')
  })

  it('usa DolarAPI como tercera fuente cuando BCV y respaldo fallan', async () => {
    routes.push({ match: 'bcv.org.ve', respond: () => { throw new Error('BCV caído') } })
    routes.push({ match: 'rates.dolarvzla.com', respond: () => { throw new Error('CDN caído') } })
    routes.push({ match: 've.dolarapi.com/v1/dolares/oficial', respond: { json: [{ fuente: 'oficial', promedio: 845 }] } })
    routes.push({ match: 've.dolarapi.com/v1/euros/oficial', respond: { json: [{ fuente: 'oficial', promedio: 965 }] } })
    routes.push({ match: 'criptoya.com', respond: { json: { ask: 970, bid: 960 } } })
    const handleGetRates = await loadHandler()
    const res = await handleGetRates(makeRequest(), {})
    const body = await res.json()
    expect(body.bcv.price).toBe(845)
    expect(body.euro.price).toBe(965)
    expect(body.source).toBe('DolarAPI Oficial')
  })

  it('sirve la caché en HIT sin volver a consultar las fuentes', async () => {
    routes.push({ match: 'bcv.org.ve', respond: { text: BCV_HTML } })
    routes.push({ match: 'criptoya.com', respond: { json: { ask: 970, bid: 960 } } })
    const handleGetRates = await loadHandler()
    const primero = await (await handleGetRates(makeRequest(), {})).json()
    const llamadasAntes = globalThis.fetch.mock.calls.length
    const segundo = await (await handleGetRates(makeRequest(), {})).json()
    expect(globalThis.fetch.mock.calls.length).toBe(llamadasAntes)
    expect(segundo.cache).toBe('HIT')
    expect(segundo.bcv.price).toBe(primero.bcv.price)
  })

  it('refresh=1 fuerza nueva consulta de las fuentes', async () => {
    routes.push({ match: 'bcv.org.ve', respond: { text: BCV_HTML } })
    routes.push({ match: 'criptoya.com', respond: { json: { ask: 970, bid: 960 } } })
    const handleGetRates = await loadHandler()
    await handleGetRates(makeRequest(), {})
    const llamadasAntes = globalThis.fetch.mock.calls.length
    await handleGetRates(makeRequest('http://worker.test/api/rates?refresh=1'), {})
    expect(globalThis.fetch.mock.calls.length).toBeGreaterThan(llamadasAntes)
  })

  it('cuando todas las fuentes fallan y hay caché, responde stale con lo último conocido', async () => {
    routes.push({ match: 'bcv.org.ve', respond: { text: BCV_HTML } })
    routes.push({ match: 'criptoya.com', respond: { json: { ask: 970, bid: 960 } } })
    const handleGetRates = await loadHandler()
    await handleGetRates(makeRequest(), {})
    routes.length = 0
    routes.push({ match: 'bcv.org.ve', respond: () => { throw new Error('BCV caído') } })
    routes.push({ match: 'rates.dolarvzla.com', respond: () => { throw new Error('CDN caído') } })
    routes.push({ match: 've.dolarapi.com', respond: () => { throw new Error('DolarAPI caído') } })
    routes.push({ match: 'criptoya.com', respond: () => { throw new Error('USDT caído') } })
    const res = await handleGetRates(makeRequest('http://worker.test/api/rates?refresh=1'), {})
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.stale).toBe(true)
    expect(body.bcv.price).toBe(857.01)
  })

  it('sin caché y con todas las fuentes caídas responde 503 sin inventar tasas', async () => {
    routes.push({ match: 'bcv.org.ve', respond: () => { throw new Error('BCV caído') } })
    routes.push({ match: 'rates.dolarvzla.com', respond: () => { throw new Error('CDN caído') } })
    routes.push({ match: 've.dolarapi.com', respond: () => { throw new Error('DolarAPI caído') } })
    const handleGetRates = await loadHandler()
    const res = await handleGetRates(makeRequest(), {})
    expect(res.status).toBe(503)
  })

  it('si el USDT falla, responde 0 sin bloquear las tasas del BCV', async () => {
    routes.push({ match: 'bcv.org.ve', respond: { text: BCV_HTML } })
    routes.push({ match: 'criptoya.com', respond: () => { throw new Error('USDT caído') } })
    const handleGetRates = await loadHandler()
    const body = await (await handleGetRates(makeRequest(), {})).json()
    expect(body.bcv.price).toBe(857.01)
    expect(body.usdt.price).toBe(0)
  })

  it('rechaza métodos que no sean GET', async () => {
    const handleGetRates = await loadHandler()
    const res = await handleGetRates({ ...makeRequest(), method: 'POST' }, {})
    expect(res.status).toBe(405)
  })
})
