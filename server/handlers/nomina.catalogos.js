// server/handlers/nomina.catalogos.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { normalizarConcepto } from '../lib/nominaConceptos.js'
import { normalizarReglaLegal } from '../lib/nominaLegal.js'
import { normalizarTasa } from '../lib/tasasCambio.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { requireCapacidad, tieneCapacidad } from '../lib/permissions.js'
import { registrarAuditoria } from '../lib/audit.js'
import { fechaNominaValida, fechaOperativaNomina, svcHeaders, tenantGuard, textoNominaValido } from './nomina.shared.js'

export async function handleGetConceptos(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
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
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
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

const SELECT_TASAS = 'id,fecha,moneda_origen,moneda_destino,valor,fuente,observado_en,aprobado,aprobado_por,periodo_id,motivo,fijada_por_nombre'
// Compatibilidad: mientras la migración 249 no esté aplicada, PostgREST responde
// 42703 por las columnas nuevas. Se reintenta sin ellas (patrón de 246) para no
// romper la lectura de snapshots históricos.
const SELECT_TASAS_LEGADO = 'id,fecha,moneda_origen,moneda_destino,valor,fuente,observado_en,aprobado,periodo_id'

async function fetchTasasSnapshot(env, headers, filtro) {
  const url = select => `${env.SUPABASE_URL}/rest/v1/nomina_tasas_snapshot?${filtro}&select=${select}&order=fecha.desc,observado_en.desc&limit=500`
  let response = await fetch(url(SELECT_TASAS), { headers })
  if (response.status === 400) {
    const detalle = await response.text().catch(() => '')
    if (detalle.includes('motivo') || detalle.includes('fijada_por_nombre')) {
      response = await fetch(url(SELECT_TASAS_LEGADO), { headers })
    }
  }
  return response
}

export async function handleGetTasasSnapshots(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const url = new URL(request.url)
  const desde = url.searchParams.get('desde')
  const hasta = url.searchParams.get('hasta')
  const periodoId = url.searchParams.get('periodoId')
  let filtro
  if (periodoId) {
    if (!isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)
    filtro = `periodo_id=eq.${periodoId}`
  } else {
    if (!fechaNominaValida(desde) || !fechaNominaValida(hasta)) return jsonError('Rango de fechas inválido', 400, request)
    const range = new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)
    if (range < 0 || range > 31 * 86400000) return jsonError('El rango debe estar entre 0 y 31 días', 400, request)
    filtro = `fecha=gte.${desde}&fecha=lte.${hasta}`
  }
  const response = await fetchTasasSnapshot(env, headers, `${filtro}${nominaTenantFilter(operador.cuenta_id)}`)
  if (!response.ok) return jsonError('Error al leer snapshots de tasa', 500, request)
  return json(await response.json() ?? [], 200, request)
}

// ── Tasa manual trazable ──────────────────────────────────────────────────────
// La tasa manual del selector (BCV $, €, USDT o manual) era local a cada
// navegador. Ahora vive en nomina_tasas_snapshot (fuente = 'MANUAL') con quién,
// cuándo y por qué, y todos los navegadores leen el mismo valor.

export async function handleGetTasaManual(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  // La tasa manual alimenta equivalencias en Bs de Nómina y Finanzas: basta con
  // operar cualquiera de los dos módulos para leerla.
  if (!tieneCapacidad(operador, 'verNomina') && !tieneCapacidad(operador, 'verFinanzas')) {
    return requireCapacidad(operador, 'verNomina', request)
  }
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const filtro = `fuente=eq.MANUAL&periodo_id=is.null${nominaTenantFilter(operador.cuenta_id)}`
  let response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_tasas_snapshot?${filtro}&select=valor,motivo,fijada_por_nombre,observado_en&order=observado_en.desc&limit=1`, { headers })
  if (response.status === 400) {
    const detalle = await response.text().catch(() => '')
    if (detalle.includes('motivo') || detalle.includes('fijada_por_nombre')) {
      response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_tasas_snapshot?${filtro}&select=valor,observado_en&order=observado_en.desc&limit=1`, { headers })
    }
  }
  if (!response.ok) return jsonError('No se pudo leer la tasa manual', 500, request)
  const [tasa] = await response.json()
  return json({ tasa: tasa || null }, 200, request)
}

export async function handleFijarTasaManual(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  // Fijar la tasa manual la afecta tanto en Nómina como en Finanzas: la autoriza
  // cualquiera que administre nómina u opere finanzas (jefe/desarrollador, ambos).
  if (!tieneCapacidad(operador, 'administrarNomina') && !tieneCapacidad(operador, 'operarFinanzas')) {
    return requireCapacidad(operador, 'administrarNomina', request)
  }
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const valorTexto = String(body?.valor ?? '').trim().replace(',', '.')
  if (!/^\d+(\.\d{1,8})?$/.test(valorTexto) || !(Number(valorTexto) > 0) || Number(valorTexto) > 1000000) {
    return jsonError('valor de tasa inválido', 400, request)
  }
  const motivo = typeof body?.motivo === 'string' ? body.motivo.trim() : ''
  if (motivo.length < 3 || motivo.length > 300) {
    return jsonError('El motivo es obligatorio (entre 3 y 300 caracteres)', 400, request)
  }
  if (!textoNominaValido(motivo, 300)) return jsonError('Motivo demasiado largo', 400, request)
  const fila = {
    fecha: fechaOperativaNomina(env),
    moneda_origen: 'USD',
    moneda_destino: 'VES',
    valor: valorTexto,
    fuente: 'MANUAL',
    observado_en: new Date().toISOString(),
    // Quien tiene permiso para fijarla la aprueba en el mismo acto.
    aprobado: true,
    aprobado_por: operador.id,
    motivo,
    fijada_por_nombre: operador.nombre || null,
    periodo_id: null,
    cuenta_id: operador.cuenta_id,
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_tasas_snapshot`, { method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify(fila) })
  if (!response.ok) {
    const detalle = await response.text().catch(() => '')
    if (detalle.includes('motivo') || detalle.includes('fijada_por_nombre')) {
      return jsonError('La base aún no admite tasa manual trazable; aplica la migración 249', 503, request)
    }
    return jsonError('No se pudo guardar la tasa manual', 409, request)
  }
  const [tasa] = await response.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'FIJAR_TASA_MANUAL', entidadTipo: 'nomina_tasas_snapshot', entidadId: tasa?.id || null, meta: { valor: valorTexto, motivo }, ip }).catch(() => {})
  return json({ ok: true, tasa }, 201, request)
}

export async function handleCrearTasaSnapshot(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
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
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
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
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
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
