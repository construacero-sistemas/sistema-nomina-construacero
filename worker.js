import {
  handleGetEmpleados, handleGetConfigEmpleados, handleCrearConfigEmpleado, handleActualizarConfigEmpleado, handleEliminarConfigEmpleado,
  handleGetAsistencia, handleRegistrarAsistencia, handleRegistrarAsistenciaMasivo, handleEliminarAsistencia,
  handleGetMarcajeHoy, handleMarcarEntrada, handleMarcarSalida, handleCorregirMarcaje,
  handleGetFeriados, handleCrearFeriado, handleEliminarFeriado, handleGetHorarios, handleCrearHorario,
  handleGuardarHorarioEmpleado, handleMarcarAusencia, handleAnularEntradaComoAusencia,
  handleGetConceptos, handleCrearConcepto,
  handleGetReglasLegales, handleCrearReglaLegal,
  handleGetTasasSnapshots, handleCrearTasaSnapshot, handleGetTasaManual, handleFijarTasaManual,
  handleGetPeriodos, handleCrearPeriodo, handleCalcularPeriodo, handleCerrarPeriodo, handleReabrirPeriodo, handleEliminarPeriodo,
  handleGetLineas, handleAjustarLinea, handlePagarLineas, handleRevertirPagoLinea,
  handleListarPosVendedores, handlePreviewComisionesPos, handleAplicarComisionesPos,
} from './server/handlers/nomina.js'
import {
  handleSwitchOperator, handleClearOperator, handleGetOperators, handleGetCurrentProfile,
} from './server/handlers/auth-operators.js'
import {
  handleListarOperadores, handleCrearOperador, handleBootstrapOperador, handleCambiarEstadoOperador,
  handleCambiarPinOperador, handleCambiarRolOperador, handleCambiarNombreOperador,
} from './server/handlers/gestionar-operadores.js'
import { handleGetConfig, handleUpdateConfig, handlePing } from './server/handlers/config.js'
import {
  handleGetFinanzasMovimientos,
  handleCrearFinanzasMovimiento,
  handleAnularFinanzasMovimiento,
  handleRevertirAnulacionMovimiento,
  handleActualizarFinanzasMovimiento,
  handleReasignarCuentaMovimientos,
  handlePreviewReconciliacionMovimientos,
  handleGetFinanzasResumen,
  handleGetFinanzasCategorias,
  handleCrearFinanzasCategoria,
  handleEliminarFinanzasCategoria,
  handleRestaurarFinanzasCategoria,
} from './server/handlers/finanzas.js'
import { handleSyncVentasPos } from './server/handlers/finanzas.sync.js'
import { handleCrearTransferencia, handleGetSaldos, handleGetOperacionEstado } from './server/handlers/finanzas.operaciones.js'
import {
  handleGetCuentasCustodia,
  handleCrearCuentaCustodia,
  handleActualizarCuentaCustodia,
  handleEliminarCuentaCustodia,
  handleRestaurarCuentasCustodia,
  handleRestaurarUnaCuentaCustodia,
  handleDescartarCuentaCustodia,
} from './server/handlers/cuentasCustodia.js'
import { handleGetRates } from './server/handlers/rates.js'
import { handleCrearLogs } from './server/handlers/logs.js'
import { supaServiceHeaders } from './server/lib/auth.js'
import {
  handleGetRetencion,
  handleGetRetencionUso,
  handlePurgarRetencion,
  handleConfigurarRetencion,
} from './server/handlers/retencion.js'
import {
  handlePreviewPurga,
  handlePurgarRegistros,
  handleDescargarBackupPurga,
} from './server/handlers/mantenimiento.js'
import {
  cacheResponse,
  clearEgressCache,
  egressRequestKey,
  getEgressCache,
  isEgressCacheMiss,
  responseFromEgressCache,
} from './server/lib/egressCache.js'

const routes = new Map([
  ['GET /api/ping', handlePing],
  ['GET /api/config', handleGetConfig],
  ['POST /api/config', handleUpdateConfig],
  ['GET /api/rates', handleGetRates],
  ['POST /api/logs', handleCrearLogs],
  ['GET /api/auth/me', handleGetCurrentProfile],
  ['GET /api/auth/operators', handleGetOperators],
  ['POST /api/auth/switch-operator', handleSwitchOperator],
  ['POST /api/auth/clear-operator', handleClearOperator],
  ['GET /api/gestion/operadores', handleListarOperadores],
  ['POST /api/gestion/operadores/crear', handleCrearOperador],
  ['POST /api/gestion/operadores/bootstrap', handleBootstrapOperador],
  ['POST /api/gestion/operadores/estado', handleCambiarEstadoOperador],
  ['POST /api/gestion/operadores/pin', handleCambiarPinOperador],
  ['POST /api/gestion/operadores/rol', handleCambiarRolOperador],
  ['POST /api/gestion/operadores/nombre', handleCambiarNombreOperador],
  ['GET /api/finanzas/movimientos', handleGetFinanzasMovimientos],
  ['POST /api/finanzas/movimientos/crear', handleCrearFinanzasMovimiento],
  ['POST /api/finanzas/transferencias/crear', handleCrearTransferencia],
  ['GET /api/finanzas/saldos', handleGetSaldos],
  ['GET /api/operaciones/estado', handleGetOperacionEstado],
  ['POST /api/finanzas/movimientos/anular', handleAnularFinanzasMovimiento],
  ['POST /api/finanzas/movimientos/revertir-anulacion', handleRevertirAnulacionMovimiento],
  ['POST /api/finanzas/movimientos/actualizar', handleActualizarFinanzasMovimiento],
  ['POST /api/finanzas/movimientos/reasignar-cuenta', handleReasignarCuentaMovimientos],
  ['GET /api/finanzas/movimientos/conciliacion-preview', handlePreviewReconciliacionMovimientos],
  ['POST /api/finanzas/sync-pos', handleSyncVentasPos],
  ['GET /api/finanzas/reportes/resumen', handleGetFinanzasResumen],
  ['GET /api/finanzas/categorias', handleGetFinanzasCategorias],
  ['POST /api/finanzas/categorias/crear', handleCrearFinanzasCategoria],
  ['POST /api/finanzas/categorias/eliminar', handleEliminarFinanzasCategoria],
  ['POST /api/finanzas/categorias/restaurar', handleRestaurarFinanzasCategoria],
  ['GET /api/finanzas/cuentas-custodia', handleGetCuentasCustodia],
  ['POST /api/finanzas/cuentas-custodia/crear', handleCrearCuentaCustodia],
  ['POST /api/finanzas/cuentas-custodia/actualizar', handleActualizarCuentaCustodia],
  ['POST /api/finanzas/cuentas-custodia/eliminar', handleEliminarCuentaCustodia],
  ['POST /api/finanzas/cuentas-custodia/restaurar', handleRestaurarCuentasCustodia],
  ['POST /api/finanzas/cuentas-custodia/restaurar-una', handleRestaurarUnaCuentaCustodia],
  ['POST /api/finanzas/cuentas-custodia/descartar', handleDescartarCuentaCustodia],
  ['GET /api/retencion', handleGetRetencion],
  ['GET /api/retencion/uso', handleGetRetencionUso],
  ['POST /api/retencion/purgar', handlePurgarRetencion],
  ['POST /api/retencion/configurar', handleConfigurarRetencion],
  ['GET /api/mantenimiento/purga-preview', handlePreviewPurga],
  ['POST /api/mantenimiento/purgar', handlePurgarRegistros],
  ['GET /api/mantenimiento/purga-backup', handleDescargarBackupPurga],
  ['GET /api/nomina/empleados', handleGetEmpleados],
  ['GET /api/nomina/config-empleados', handleGetConfigEmpleados],
  ['POST /api/nomina/config-empleado/crear', handleCrearConfigEmpleado],
  ['POST /api/nomina/config-empleado/actualizar', handleActualizarConfigEmpleado],
  ['POST /api/nomina/config-empleado/eliminar', handleEliminarConfigEmpleado],
  ['DELETE /api/nomina/config-empleados', handleEliminarConfigEmpleado],
  ['GET /api/nomina/asistencia', handleGetAsistencia],
  ['POST /api/nomina/asistencia/registrar', handleRegistrarAsistencia],
  ['POST /api/nomina/asistencia/registrar-masivo', handleRegistrarAsistenciaMasivo],
  ['POST /api/nomina/asistencia/eliminar', handleEliminarAsistencia],
  ['GET /api/nomina/marcaje/hoy', handleGetMarcajeHoy],
  ['POST /api/nomina/marcaje/entrada', handleMarcarEntrada],
  ['POST /api/nomina/marcaje/salida', handleMarcarSalida],
  ['POST /api/nomina/marcaje/corregir', handleCorregirMarcaje],
  ['POST /api/nomina/marcaje/ausencia', handleMarcarAusencia],
  ['POST /api/nomina/marcaje/anular-entrada-ausencia', handleAnularEntradaComoAusencia],
  ['GET /api/nomina/calendario/feriados', handleGetFeriados],
  ['POST /api/nomina/calendario/feriados/crear', handleCrearFeriado],
  ['POST /api/nomina/calendario/feriados/eliminar', handleEliminarFeriado],
  ['GET /api/nomina/calendario/horarios', handleGetHorarios],
  ['POST /api/nomina/calendario/horarios/crear', handleCrearHorario],
  ['POST /api/nomina/calendario/horarios/empleado', handleGuardarHorarioEmpleado],
  ['GET /api/nomina/conceptos', handleGetConceptos],
  ['POST /api/nomina/conceptos/crear', handleCrearConcepto],
  ['GET /api/nomina/reglas-legales', handleGetReglasLegales],
  ['POST /api/nomina/reglas-legales/crear', handleCrearReglaLegal],
  ['GET /api/nomina/tasas-snapshots', handleGetTasasSnapshots],
  ['POST /api/nomina/tasas-snapshots/crear', handleCrearTasaSnapshot],
  ['GET /api/nomina/tasa-manual', handleGetTasaManual],
  ['POST /api/nomina/tasa-manual', handleFijarTasaManual],
  ['GET /api/nomina/periodos', handleGetPeriodos],
  ['POST /api/nomina/periodos/crear', handleCrearPeriodo],
  ['POST /api/nomina/periodos/calcular', handleCalcularPeriodo],
  ['POST /api/nomina/periodos/cerrar', handleCerrarPeriodo],
  ['POST /api/nomina/periodos/reabrir', handleReabrirPeriodo],
  ['POST /api/nomina/periodos/eliminar', handleEliminarPeriodo],
  ['GET /api/nomina/lineas', handleGetLineas],
  ['POST /api/nomina/lineas/ajustar', handleAjustarLinea],
  ['POST /api/nomina/lineas/pagar', handlePagarLineas],
  ['POST /api/nomina/lineas/revertir-pago', handleRevertirPagoLinea],
  ['GET /api/nomina/pos-vendedores', handleListarPosVendedores],
  ['GET /api/nomina/comisiones-pos', handlePreviewComisionesPos],
  ['POST /api/nomina/aplicar-comisiones-pos', handleAplicarComisionesPos],
])

const MAX_BODY_BYTES = 256 * 1024

function egressCacheTtl(pathname) {
  // Solo datos públicos: una respuesta protegida nunca puede saltarse la
  // validación de sesión/rol, aunque haya sido autorizada en una petición previa.
  // React Query sigue evitando lecturas redundantes dentro de una sesión.
  return pathname === '/api/rates' ? 10 * 60 * 1000 : 0
}

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
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co wss://*.supabase.in; font-src 'self' data:; frame-src 'self' blob:;",
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
      const cacheTtl = request.method === 'GET' ? egressCacheTtl(url.pathname) : 0
      let cacheKey = null
      try {
        if (cacheTtl > 0) {
          cacheKey = await egressRequestKey(request)
          const cached = getEgressCache(cacheKey)
          if (!isEgressCacheMiss(cached)) {
            return withHeaders(responseFromEgressCache(cached), request, env)
          }
        }

        const response = withHeaders(await handler(request, env), request, env)
        // Toda mutación puede invalidar varias lecturas relacionadas; limpiar
        // globalmente es barato y evita servir totales o permisos antiguos.
        if (request.method === 'POST') clearEgressCache()
        if (cacheTtl > 0 && cacheKey) await cacheResponse(cacheKey, response, cacheTtl)
        return response
      } catch (error) {
        if (request.method === 'POST') clearEgressCache()
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

  // Cron: purga global en modo real (dry-run = false) una vez al mes.
  // Solo corre si hay SUPABASE_SERVICE_KEY configurada (evita fallos en local).
  async scheduled(_controller, env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return new Response('ok', { status: 200 })
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/retencion_purga_todos`, {
      method: 'POST',
      headers: { ...supaServiceHeaders(env), Prefer: 'return=minimal' },
      body: JSON.stringify({ p_dry_run: false, p_disparador: 'cron' }),
    })
    if (!response.ok) console.error('[nomina-worker] cron purge failed', response.status, await response.text())
    return new Response('ok', { status: 200 })
  },
}
