import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cacheResponse,
  clearEgressCache,
  egressCacheStats,
  egressRequestKey,
  getEgressCache,
  isEgressCacheMiss,
  responseFromEgressCache,
} from '../egressCache.js'

afterEach(() => {
  clearEgressCache()
  vi.useRealTimers()
})

describe('egress response cache', () => {
  it('reutiliza el body y conserva el status sin guardar headers CORS', async () => {
    const response = new Response(JSON.stringify({ rows: [1, 2] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://a.test' },
    })

    expect(await cacheResponse('k1', response, 60_000)).toBe(true)
    const entry = getEgressCache('k1')
    expect(isEgressCacheMiss(entry)).toBe(false)
    const replay = responseFromEgressCache(entry)

    expect(replay.status).toBe(200)
    expect(replay.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(await replay.json()).toEqual({ rows: [1, 2] })
    expect(egressCacheStats().entries).toBe(1)
  })

  it('expira entradas para no servir asistencia antigua indefinidamente', async () => {
    vi.useFakeTimers()
    const response = new Response('staleable', { status: 200 })
    await cacheResponse('short', response, 1_000)

    vi.advanceTimersByTime(1_001)
    expect(isEgressCacheMiss(getEgressCache('short'))).toBe(true)
    expect(egressCacheStats().entries).toBe(0)
  })

  it('genera fingerprints diferentes por token, operador y origen', async () => {
    const base = { method: 'GET', url: 'https://app.test/api/nomina/lineas?periodoId=p1' }
    const keyA = await egressRequestKey(new Request(base.url, {
      headers: { Authorization: 'Bearer a', 'X-Operator-Id': 'op-a', Origin: 'https://a.test' },
    }))
    const keyB = await egressRequestKey(new Request(base.url, {
      headers: { Authorization: 'Bearer b', 'X-Operator-Id': 'op-b', Origin: 'https://b.test' },
    }))

    expect(keyA).not.toBe(keyB)
    expect(keyA).not.toContain('Bearer')
    expect(keyB).not.toContain('Bearer')
  })

  it('limpia todas las lecturas después de una mutación', async () => {
    await cacheResponse('a', new Response('a'), 60_000)
    await cacheResponse('b', new Response('b'), 60_000)
    expect(egressCacheStats().entries).toBe(2)

    clearEgressCache()
    expect(egressCacheStats()).toEqual({ entries: 0, bytes: 0 })
  })
})
