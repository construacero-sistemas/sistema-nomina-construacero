// server/handlers/nomina.catalogos.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { normalizarConcepto } from '../lib/nominaConceptos.js'
import { normalizarReglaLegal } from '../lib/nominaLegal.js'
import { normalizarTasa } from '../lib/tasasCambio.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { ROLES_ADMIN, ROLES_NOMINA, fechaNominaValida, svcHeaders, tenantGuard } from './nomina.shared.js'

export async function handleGetConceptos(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_conceptos?activo=eq.true${nominaTenantFilter(operador.cuenta_id)}&select=id,codigo,nombre,tipo,imponible,obligatorio,moneda_default,formula_key,fecha_desde,fecha_hasta&order=codigo.asc&limit=500`, { headers })
  if (!response.ok) return jsonError('Error al leer conceptos', 500, request)
  return json(await response.json() ?? [], 200, request)
}

export async function handleCrearConcepto(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  let concept
  try { concept = normalizarConcepto(body) } catch (error) { return jsonError(error.message || 'Concepto inválido', 400, request) }
  if (!fechaNominaValida(concept.fecha_desde) || (concept.fecha_hasta && !fechaNominaValida(concept.fecha_hasta)) || (concept.fecha_hasta && concept.fecha_hasta < concept.fecha_desde)) return jsonError('Vigencia del concepto inválida', 400, request)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_conceptos`, { method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify({ ...concept, cuenta_id: operador.cuenta_id, creado_por: operador.id }) })
  if (!response.ok) return jsonError('Error al crear concepto', 409, request)
  const [row] = await response.json()
  return json({ ok: true, concepto: row }, 201, request)
}

export async function handleGetTasasSnapshots(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const url = new URL(request.url)
  const desde = url.searchParams.get('desde')
  const hasta = url.searchParams.get('hasta')
  if (!fechaNominaValida(desde) || !fechaNominaValida(hasta)) return jsonError('Rango de fechas inválido', 400, request)
  const range = new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)
  if (range < 0 || range > 31 * 86400000) return jsonError('El rango debe estar entre 0 y 31 días', 400, request)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_tasas_snapshot?fecha=gte.${desde}&fecha=lte.${hasta}${nominaTenantFilter(operador.cuenta_id)}&select=id,fecha,moneda_origen,moneda_destino,valor,fuente,observado_en,aprobado,periodo_id&order=fecha.desc&limit=500`, { headers })
  if (!response.ok) return jsonError('Error al leer snapshots de tasa', 500, request)
  return json(await response.json() ?? [], 200, request)
}

export async function handleCrearTasaSnapshot(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  if (!fechaNominaValida(body?.fecha)) return jsonError('fecha inválida', 400, request)
  if (body.observadoEn && (typeof body.observadoEn !== 'string' || Number.isNaN(Date.parse(body.observadoEn)))) return jsonError('observadoEn inválido', 400, request)
  let rate
  try { rate = normalizarTasa(body) } catch (error) { return jsonError(error.message || 'Tasa inválida', 400, request) }
  if (body.periodoId && !isValidUuid(body.periodoId)) return jsonError('periodoId inválido', 400, request)
  if (body.periodoId) {
    const periodResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${body.periodoId}${nominaTenantFilter(operador.cuenta_id)}&select=id&limit=1`, { headers })
    if (!periodResponse.ok) return jsonError('No se pudo verificar el período de la tasa', 500, request)
    const [period] = await periodResponse.json()
    if (!period) return jsonError('Período no encontrado', 404, request)
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_tasas_snapshot`, { method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify({ fecha: body.fecha, ...rate, observado_en: body.observadoEn || new Date().toISOString(), aprobado: false, periodo_id: body.periodoId || null, cuenta_id: operador.cuenta_id }) })
  if (!response.ok) return jsonError('Error al crear snapshot de tasa', 409, request)
  const [snapshot] = await response.json()
  return json({ ok: true, snapshot, requiere_aprobacion: true }, 201, request)
}

export async function handleGetReglasLegales(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_reglas_legal?order=codigo.asc,fecha_desde.desc${nominaTenantFilter(operador.cuenta_id)}&select=id,codigo,nombre,tipo,valor,unidad,formula_key,base_key,fecha_desde,fecha_hasta,version,fuente,aprobado_por,aprobado_en,activo&limit=500`, { headers })
  if (!response.ok) return jsonError('Error al leer reglas legales', 500, request)
  return json(await response.json() ?? [], 200, request)
}

export async function handleCrearReglaLegal(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  let rule
  try { rule = normalizarReglaLegal(body) } catch (error) { return jsonError(error.message || 'Regla legal inválida', 400, request) }
  if (!fechaNominaValida(rule.fecha_desde) || (rule.fecha_hasta && !fechaNominaValida(rule.fecha_hasta)) || (rule.fecha_hasta && rule.fecha_hasta < rule.fecha_desde)) return jsonError('Vigencia legal inválida', 400, request)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_reglas_legal`, { method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify({ ...rule, cuenta_id: operador.cuenta_id, creado_por: operador.id }) })
  if (!response.ok) return jsonError('Error al crear regla legal', 409, request)
  const [row] = await response.json()
  return json({ ok: true, regla: row, requiere_aprobacion: true }, 201, request)
}
