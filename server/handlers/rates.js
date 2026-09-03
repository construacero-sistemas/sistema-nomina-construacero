import { jsonError, corsHeaders } from '../lib/utils.js'

const BCV_URL = 'https://www.bcv.org.ve/'
const CDN_URL = 'https://rates.dolarvzla.com/bcv/current.json'
const USDT_URL = 'https://criptoya.com/api/binancep2p/USDT/VES/1'
const API_URLS = {
  usd: ['https://ve.dolarapi.com/v1/dolares/oficial', 'https://ve.dolarapi.com/v1/dolares'],
  eur: ['https://ve.dolarapi.com/v1/euros/oficial', 'https://ve.dolarapi.com/v1/euros'],
}
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
const CACHE_MS = 10 * 60 * 1000
let cache = null
let cacheTime = 0

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const clean = value.replace(/[^\d.,]/g, '')
  if (!clean) return 0
  const separator = Math.max(clean.lastIndexOf('.'), clean.lastIndexOf(','))
  if (separator < 0) return Number(clean) || 0
  return Number(`${clean.slice(0, separator).replace(/[.,]/g, '')}.${clean.slice(separator + 1)}`) || 0
}

async function fetchTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response.ok ? response : null
  } finally {
    clearTimeout(timer)
  }
}

function htmlRate(html, id) {
  const match = html.match(new RegExp(`id=["']${id}["'][\\s\\S]{0,5000}?<strong\\b[^>]*>\\s*([\\d.,]+)`, 'i'))
  return number(match?.[1])
}

async function bcvDirect() {
  const response = await fetchTimeout(`${BCV_URL}?_=${Date.now()}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })
  if (!response) throw new Error('BCV no respondió')
  const html = await response.text()
  const usd = htmlRate(html, 'dolar')
  const eur = htmlRate(html, 'euro')
  if (!(usd > 0 && eur > 0)) throw new Error('BCV no publicó USD/EUR')
  return { usd, eur, source: 'BCV Oficial' }
}

async function bcvCdn() {
  const response = await fetchTimeout(`${CDN_URL}?_=${Date.now()}`, { headers: { Accept: 'application/json' } }, 8000)
  if (!response) throw new Error('Respaldo BCV no respondió')
  const data = await response.json()
  const usd = number(data?.current?.usd)
  const eur = number(data?.current?.eur)
  if (!(usd > 0 && eur > 0)) throw new Error('Respaldo BCV sin tasas vigentes')
  return { usd, eur, source: 'BCV (respaldo público)' }
}

async function usdtRate() {
  const response = await fetchTimeout(USDT_URL, { headers: { Accept: 'application/json' } }, 10000)
  if (!response) return 0
  const data = await response.json()
  const ask = typeof data.ask === 'number' ? data.ask : Array.isArray(data.ask) ? data.ask.slice(0, 3).reduce((sum, item) => sum + Number(item.price ?? item), 0) / Math.min(3, data.ask.length) : 0
  const bid = typeof data.bid === 'number' ? data.bid : Array.isArray(data.bid) ? data.bid.slice(0, 3).reduce((sum, item) => sum + Number(item.price ?? item), 0) / Math.min(3, data.bid.length) : 0
  return ask > 0 && bid > 0 ? (ask + bid) / 2 : ask || bid
}

async function dolarApi(currency) {
  for (const url of API_URLS[currency]) {
    try {
      const response = await fetchTimeout(url, {}, 8000)
      if (!response) continue
      const data = await response.json()
      const rows = Array.isArray(data) ? data : [data]
      const official = rows.find(row => row?.fuente === 'oficial' || row?.nombre === 'Oficial') || rows[0]
      const price = number(official?.promedio || official?.precio)
      if (price > 0) return price
    } catch (err) {
      console.warn(`[RATES] DolarAPI error en ${url}: ${err.message}`)
    }
  }
  return 0
}

export async function handleGetRates(request, env) {
  if (request.method !== 'GET') return jsonError('Method not allowed', 405, request)
  if (cache && new URL(request.url).searchParams.get('refresh') !== '1' && Date.now() - cacheTime < CACHE_MS) {
    return new Response(JSON.stringify({ ...cache, cache: 'HIT' }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(request) } })
  }
  let rates = null
  for (const source of [bcvDirect, bcvCdn, async () => ({ usd: await dolarApi('usd'), eur: await dolarApi('eur'), source: 'DolarAPI Oficial' })]) {
    try {
      const candidate = await source()
      if (candidate.usd > 0 && candidate.eur > 0) { rates = candidate; break }
    } catch (error) { console.warn(`[RATES] ${error.message}`) }
  }
  if (!rates) return cache ? new Response(JSON.stringify({ ...cache, stale: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(request) } }) : jsonError('No se pudo obtener la tasa BCV', 503, request)
  const usdt = await usdtRate().catch(() => 0)
  cache = { bcv: { price: rates.usd }, euro: { price: rates.eur }, usdt: { price: usdt }, source: rates.source, lastUpdate: new Date().toISOString() }
  cacheTime = Date.now()
  return new Response(JSON.stringify(cache), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(request) } })
}
