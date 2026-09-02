// server/handlers/logs.js
// Persiste errores/warnings del frontend en la tabla `auditoria`.
// Cualquier usuario autenticado puede reportar (los errores no distinguen rol);
// el tenant queda fijado por el JWT, nunca por el body.
import { verifyAuth, supaServiceHeaders } from '../lib/auth.js'
import { jsonError } from '../lib/utils.js'

const NIVELES = new Set(['error', 'warn', 'info'])
const MAX_ENTRIES = 10
const MAX_MENSAJE = 2000
const MAX_STACK = 5000
const MAX_CATEGORIA = 60

function safeMeta(meta) {
  if (meta == null) return null
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    return { valor: String(meta).slice(0, 500) }
  }
  try {
    return JSON.parse(JSON.stringify(meta))
  } catch {
    return { nota: 'meta no serializable' }
  }
}

function normalizeEntry(raw = {}) {
  const mensaje = String(raw.mensaje ?? raw.message ?? '').trim().slice(0, MAX_MENSAJE)
  if (!mensaje) return null
  const nivel = NIVELES.has(raw.nivel) ? raw.nivel : 'error'
  const categoria = (String(raw.categoria || 'FRONTEND').trim().slice(0, MAX_CATEGORIA)) || 'FRONTEND'
  const stack = raw.stack ? String(raw.stack).slice(0, MAX_STACK) : null
  const origen = String(raw.origen || 'frontend').slice(0, 40)
  return { nivel, categoria, mensaje, stack, origen, meta: safeMeta(raw.meta) }
}

export async function handleCrearLogs(request, env) {
  if (request.method !== 'POST') return jsonError('Method not allowed', 405, request)

  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('Body inválido', 400, request)
  }

  const rawEntries = Array.isArray(body?.entries) ? body.entries : [body]
  if (rawEntries.length > MAX_ENTRIES) return jsonError('Demasiados registros', 413, request)
  const entries = rawEntries.map(normalizeEntry).filter(Boolean)
  if (!entries.length) return jsonError('Sin contenido de log', 400, request)

  const rows = entries.map(entry => ({
    cuenta_id: user.id,
    categoria: entry.categoria,
    accion: `LOG_${entry.nivel.toUpperCase()}`,
    descripcion: entry.mensaje,
    entidad_tipo: 'log_cliente',
    meta: {
      origen: entry.origen,
      ...(entry.stack ? { stack: entry.stack } : {}),
      ...(entry.meta || {}),
    },
  }))

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
    method: 'POST',
    headers: supaServiceHeaders(env, 'return=minimal'),
    body: JSON.stringify(rows),
  })
  if (!response.ok) return jsonError('No se pudo registrar el log', 502, request)
  return new Response(null, { status: 204 })
}
