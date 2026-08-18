import {
  handleGetEmpleados, handleGetConfigEmpleados, handleCrearConfigEmpleado, handleActualizarConfigEmpleado,
  handleGetAsistencia, handleRegistrarAsistencia, handleRegistrarAsistenciaMasivo, handleEliminarAsistencia,
  handleGetMarcajeHoy, handleMarcarEntrada, handleMarcarSalida,
  handleGetFeriados, handleCrearFeriado, handleGetHorarios, handleCrearHorario,
  handleGetConceptos, handleCrearConcepto,
  handleGetReglasLegales, handleCrearReglaLegal,
  handleGetTasasSnapshots, handleCrearTasaSnapshot,
  handleGetPeriodos, handleCrearPeriodo, handleCalcularPeriodo, handleCerrarPeriodo, handleReabrirPeriodo,
  handleGetLineas, handleAjustarLinea, handlePagarLineas, handleRevertirPagoLinea,
} from './api/handlers/nomina.js'
import {
  handleSwitchOperator, handleClearOperator, handleGetOperators, handleSuperAdmin,
} from './api/handlers/auth-operators.js'
import { handleGetConfig, handlePing } from './api/handlers/config.js'

const routes = new Map([
  ['GET /api/ping', handlePing],
  ['GET /api/config', handleGetConfig],
  ['GET /api/auth/operators', handleGetOperators],
  ['POST /api/auth/switch-operator', handleSwitchOperator],
  ['POST /api/auth/clear-operator', handleClearOperator],
  ['POST /api/auth/super-admin', handleSuperAdmin],
  ['GET /api/nomina/empleados', handleGetEmpleados],
  ['GET /api/nomina/config-empleados', handleGetConfigEmpleados],
  ['POST /api/nomina/config-empleado/crear', handleCrearConfigEmpleado],
  ['POST /api/nomina/config-empleado/actualizar', handleActualizarConfigEmpleado],
  ['GET /api/nomina/asistencia', handleGetAsistencia],
  ['POST /api/nomina/asistencia/registrar', handleRegistrarAsistencia],
  ['POST /api/nomina/asistencia/registrar-masivo', handleRegistrarAsistenciaMasivo],
  ['POST /api/nomina/asistencia/eliminar', handleEliminarAsistencia],
  ['GET /api/nomina/marcaje/hoy', handleGetMarcajeHoy],
  ['POST /api/nomina/marcaje/entrada', handleMarcarEntrada],
  ['POST /api/nomina/marcaje/salida', handleMarcarSalida],
  ['GET /api/nomina/calendario/feriados', handleGetFeriados],
  ['POST /api/nomina/calendario/feriados/crear', handleCrearFeriado],
  ['GET /api/nomina/calendario/horarios', handleGetHorarios],
  ['POST /api/nomina/calendario/horarios/crear', handleCrearHorario],
  ['GET /api/nomina/conceptos', handleGetConceptos],
  ['POST /api/nomina/conceptos/crear', handleCrearConcepto],
  ['GET /api/nomina/reglas-legales', handleGetReglasLegales],
  ['POST /api/nomina/reglas-legales/crear', handleCrearReglaLegal],
  ['GET /api/nomina/tasas-snapshots', handleGetTasasSnapshots],
  ['POST /api/nomina/tasas-snapshots/crear', handleCrearTasaSnapshot],
  ['GET /api/nomina/periodos', handleGetPeriodos],
  ['POST /api/nomina/periodos/crear', handleCrearPeriodo],
  ['POST /api/nomina/periodos/calcular', handleCalcularPeriodo],
  ['POST /api/nomina/periodos/cerrar', handleCerrarPeriodo],
  ['POST /api/nomina/periodos/reabrir', handleReabrirPeriodo],
  ['GET /api/nomina/lineas', handleGetLineas],
  ['POST /api/nomina/lineas/ajustar', handleAjustarLinea],
  ['POST /api/nomina/lineas/pagar', handlePagarLineas],
  ['POST /api/nomina/lineas/revertir-pago', handleRevertirPagoLinea],
])

const MAX_BODY_BYTES = 256 * 1024

function allowedOrigins(env) {
  const configured = String(env.NOMINA_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
  return new Set(configured)
}

function originFor(request, env) {
  const origin = request.headers.get('Origin') || ''
  return allowedOrigins(env).has(origin) ? origin : null
}

function baseHeaders(request, env) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://*.supabase.co https://*.supabase.in; font-src 'self' data:;",
  }
  if (new URL(request.url).pathname.startsWith('/api/')) headers['Cache-Control'] = 'no-store'
  if (new URL(request.url).protocol === 'https:') {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  }
  const origin = originFor(request, env)
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers.Vary = 'Origin'
  }
  return headers
}

function withHeaders(response, request, env) {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(baseHeaders(request, env))) headers.set(name, value)
  if (!originFor(request, env)) {
    headers.delete('Access-Control-Allow-Origin')
    headers.delete('Access-Control-Allow-Credentials')
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function preflight(request, env) {
  const origin = originFor(request, env)
  const headers = new Headers(baseHeaders(request, env))
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type, Authorization, X-Operator-Id')
  headers.set('Access-Control-Max-Age', '600')
  if (!origin) headers.delete('Access-Control-Allow-Origin')
  return new Response(null, { status: 204, headers })
}

function internalError(request, env, error) {
  console.error('[nomina-worker] unhandled request error', error?.message || error)
  return withHeaders(
    new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }),
    request,
    env,
  )
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return preflight(request, env)
    }

    const declaredLength = Number(request.headers.get('Content-Length') || 0)
    let bodyTooLarge = declaredLength > MAX_BODY_BYTES
    // Content-Length no siempre existe (por ejemplo, transferencias chunked).
    // Clonar permite validar el tamaño sin consumir el stream que leerá el handler.
    if (!bodyTooLarge && request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
      try {
        bodyTooLarge = (await request.clone().arrayBuffer()).byteLength > MAX_BODY_BYTES
      } catch {
        bodyTooLarge = true
      }
    }
    if (bodyTooLarge) {
      return withHeaders(new Response(JSON.stringify({ error: 'Body demasiado grande' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      }), request, env)
    }

    const handler = routes.get(`${request.method} ${url.pathname}`)
    if (handler) {
      try {
        return withHeaders(await handler(request, env), request, env)
      } catch (error) {
        return internalError(request, env, error)
      }
    }

    if (env.ASSETS) {
      try {
        return withHeaders(await env.ASSETS.fetch(request), request, env)
      } catch (error) {
        return internalError(request, env, error)
      }
    }
    return withHeaders(new Response('Not found', { status: 404 }), request, env)
  },
}
