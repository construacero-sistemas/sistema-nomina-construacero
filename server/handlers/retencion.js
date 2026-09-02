// server/handlers/retencion.js
// Sistema de retención y purga inteligente para el tier gratuito de Supabase.
// Endpoints solo-admin. La purga real se ejecuta server-side vía RPC
// (retencion_purga) para NO descargar filas al Worker (egress ~ cero).
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { requireAdmin } from '../lib/permissions.js'
import { clearEgressCache } from '../lib/egressCache.js'
import { registrarAuditoria } from '../lib/audit.js'

const DEFAULT_RETENCION_MESES = 3
const MIN_MESES = 1
const MAX_MESES = 36

function svcHeaders(env) {
  return supaServiceHeaders(env)
}

async function adminContext(request, env) {
  const result = await validateOperator(request, env)
  if (result.error) return result
  const denied = requireAdmin(result.operador, request)
  if (denied) return { error: denied }
  if (!isValidUuid(result.operador.cuenta_id)) {
    return { error: jsonError('Cuenta inválida', 403, request) }
  }
  return result
}

// Lee la ventana de retención de la configuración del negocio (default 3).
async function readRetencionMeses(env, cuentaId, headers) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${encodeURIComponent(cuentaId)}&select=retencion_meses&limit=1`,
    { headers },
  )
  if (!response.ok) return DEFAULT_RETENCION_MESES
  const [row] = await response.json()
  const value = Number(row?.retencion_meses)
  return Number.isFinite(value) && value >= MIN_MESES && value <= MAX_MESES ? value : DEFAULT_RETENCION_MESES
}

// GET /api/retencion -> estado de retención + último log de purga.
export async function handleGetRetencion(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const { operador } = context
  const headers = svcHeaders(env)

  const [configRes, logRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${encodeURIComponent(operador.cuenta_id)}&select=retencion_meses&limit=1`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/purga_log?cuenta_id=eq.${encodeURIComponent(operador.cuenta_id)}&order=creado_en.desc&limit=3&select=creado_en,disparador,dry_run,retencion_meses,cutoff,resumen,total_eliminadas`, { headers }),
  ])

  const [configRow] = configRes.ok ? await configRes.json() : []
  const logs = logRes.ok ? await logRes.json() : []
  const retencionMeses = Number(configRow?.retencion_meses) > 0
    ? Number(configRow.retencion_meses)
    : DEFAULT_RETENCION_MESES

  return json({
    retencion_meses: retencionMeses,
    min_meses: MIN_MESES,
    max_meses: MAX_MESES,
    ultimos_logs: logs,
  }, 200, request)
}

// POST /api/retencion/purgar -> ejecuta (o simula) la purga. body: { dry_run, meses? }
async function ejecutarPurga(request, env, disparador) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const { operador, ip } = context

  let body = {}
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }

  const dryRun = body?.dry_run !== false
  let meses = body?.meses !== undefined ? Number(body.meses) : DEFAULT_RETENCION_MESES
  if (!Number.isInteger(meses) || meses < MIN_MESES || meses > MAX_MESES) {
    return jsonError(`meses debe estar entre ${MIN_MESES} y ${MAX_MESES}`, 400, request)
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/retencion_purga`, {
    method: 'POST',
    headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify({
      p_cuenta_id: operador.cuenta_id,
      p_meses: meses,
      p_dry_run: dryRun,
      p_disparador: disparador,
      p_ejecutado_por: operador.id,
      p_ejecutado_nombre: operador.nombre,
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    return jsonError(`No se pudo ejecutar la purga: ${err?.message || response.statusText}`, 500, request)
  }

  const rows = await response.json()
  const total = (rows || []).reduce((sum, row) => sum + Number(row.eliminadas || 0), 0)

  // Registrar en auditoría y limpiar caché de lectura.
  registrarAuditoria(env, svcHeaders(env), {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'SISTEMA',
    accion: dryRun ? 'PURGA_SIMULACION' : 'PURGA_EJECUTADA',
    entidadTipo: 'purga_log',
    entidadId: null,
    meta: { dry_run: dryRun, meses, total_eliminadas: total },
    ip,
  }).catch(() => {})
  clearEgressCache()

  return json({ dry_run: dryRun, meses, total_eliminadas: total, detalle: rows }, 200, request)
}

export function handlePurgarRetencion(request, env) {
  return ejecutarPurga(request, env, 'manual')
}

export function handlePurgarRetencionCron(request, env) {
  return ejecutarPurga(request, env, 'cron')
}

// POST /api/retencion/configurar -> fija la ventana de retención. body: { meses }
export async function handleConfigurarRetencion(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const { operador } = context

  let body = {}
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const meses = Number(body?.meses)
  if (!Number.isInteger(meses) || meses < MIN_MESES || meses > MAX_MESES) {
    return jsonError(`meses debe estar entre ${MIN_MESES} y ${MAX_MESES}`, 400, request)
  }

  const patch = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${encodeURIComponent(operador.cuenta_id)}`, {
    method: 'PATCH',
    headers: { ...svcHeaders(env), Prefer: 'return=minimal' },
    body: JSON.stringify({ retencion_meses: meses, actualizado_en: new Date().toISOString() }),
  })
  if (!patch.ok) return jsonError('No se pudo guardar la retención', 500, request)
  clearEgressCache()
  return json({ ok: true, retencion_meses: meses }, 200, request)
}
