import worker from '../worker.js'

const ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'NOMINA_TIMEZONE',
  'NOMINA_ALLOWED_ORIGINS',
  'ENABLE_DEV_MASTER_PIN',
  'DEV_MASTER_PIN_4',
  'DEV_MASTER_PIN_6',
]

function runtimeEnv() {
  return Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key] || '']))
}

function requestUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host || 'localhost'
  const incoming = new URL(req.url || '/', `${protocol}://${host}`)
  const rewrittenPath = incoming.searchParams.get('__route__')

  // Vercel Functions tradicionales solo enrutan un segmento directamente.
  // vercel.json reescribe /api/* hacia /api y conserva el resto en __route__.
  if (rewrittenPath !== null) {
    const route = rewrittenPath.replace(/^\/+/, '')
    incoming.searchParams.delete('__route__')
    const query = incoming.searchParams.toString()
    incoming.pathname = route ? `/api/${route}` : '/api'
    incoming.search = query ? `?${query}` : ''
  }

  return incoming.toString()
}

function requestHeaders(req) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) headers.set(name, value.join(', '))
    else if (value !== undefined) headers.set(name, String(value))
  }
  return headers
}

async function requestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return undefined
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export default async function vercelHandler(req, res) {
  try {
    const request = new Request(requestUrl(req), {
      method: req.method,
      headers: requestHeaders(req),
      body: await requestBody(req),
    })
    const response = await worker.fetch(request, runtimeEnv())

    res.statusCode = response.status
    for (const [name, value] of response.headers) {
      // Node/Vercel calcula estos headers para el buffer que escribimos.
      if (!['content-length', 'transfer-encoding'].includes(name.toLowerCase())) {
        res.setHeader(name, value)
      }
    }
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error('[vercel-nomina] unhandled request error', error?.message || error)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Error interno del servidor' }))
  }
}
