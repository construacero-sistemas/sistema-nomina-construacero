// server/handlers/nomina.comisiones.js
// Gestión e importación de comisiones de vendedores desde el POS a Nómina.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { requireCapacidad } from '../lib/permissions.js'
import { fetchPosVendedores, fetchComisionesLiberadasPos } from '../lib/posSyncHelper.js'
import {
  r4,
  svcHeaders,
  tenantGuard,
} from './nomina.shared.js'

/**
 * GET /api/nomina/pos-vendedores
 * Lista usuarios activos del POS para vincular en el catálogo de empleados.
 */
export async function handleListarPosVendedores(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const result = await fetchPosVendedores(env)
  if (!result.ok) {
    return jsonError(result.error || 'Error consultando vendedores del POS', 502, request)
  }

  return json(result.vendedores || [], 200, request)
}

/**
 * GET /api/nomina/comisiones-pos?periodoId=<uuid>
 * Previsualiza las comisiones liberadas en el POS para los empleados vinculados
 * dentro de las fechas del período de nómina.
 */
export async function handlePreviewComisionesPos(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const periodoId = new URL(request.url).searchParams.get('periodoId')
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)

  // 1. Obtener período
  const periodResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}` +
      `${nominaTenantFilter(operador.cuenta_id)}&select=id,nombre,desde,hasta,estado&limit=1`,
    { headers },
  )
  const [periodo] = periodResponse.ok ? await periodResponse.json() : []
  if (!periodo) return jsonError('Período no encontrado', 404, request)

  // 2. Obtener empleados vinculados a vendedores del POS
  const empResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?activo=eq.true&pos_vendedor_id=not.is.null` +
      `${nominaTenantFilter(operador.cuenta_id)}` +
      '&select=id,empleado_id,pos_vendedor_id,cargo,empleado:clientes!empleado_id(id,nombre)&limit=500',
    { headers },
  )
  const configEmpleados = empResponse.ok ? await empResponse.json() : []
  if (!configEmpleados.length) {
    return json({ periodo, empleados: [], total_comisiones_usd: 0 }, 200, request)
  }

  // 3. Obtener líneas existentes de este período
  const lineResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}` +
      `${nominaTenantFilter(operador.cuenta_id)}` +
      '&select=id,empleado_id,comisiones_pos_usd,comisiones_despachos_ids,pagado&limit=500',
    { headers },
  )
  const lineas = lineResponse.ok ? await lineResponse.json() : []
  const lineaPorEmpleado = new Map(lineas.map(l => [l.empleado_id, l]))

  // 4. Consultar comisiones liberadas en el POS
  const posVendedorIds = [...new Set(configEmpleados.map(e => e.pos_vendedor_id).filter(Boolean))]
  const posResult = await fetchComisionesLiberadasPos(env, {
    posVendedorIds,
    desde: periodo.desde,
    hasta: periodo.hasta,
  })

  if (!posResult.ok) {
    return jsonError(posResult.error || 'Error al consultar comisiones del POS', 502, request)
  }

  // 5. Agrupar liberaciones por vendedor_id
  const liberaciones = posResult.liberaciones || []
  const liberacionesPorVendedor = new Map()
  for (const lib of liberaciones) {
    const list = liberacionesPorVendedor.get(lib.vendedor_id) || []
    list.push(lib)
    liberacionesPorVendedor.set(lib.vendedor_id, list)
  }

  // 6. Construir resumen por empleado
  let totalGeneralUsd = 0
  const empleadosPreview = configEmpleados.map(cfg => {
    const libs = liberacionesPorVendedor.get(cfg.pos_vendedor_id) || []
    const totalEmpleadoUsd = r4(libs.reduce((sum, l) => sum + (Number(l.monto_usd) || 0), 0))
    totalGeneralUsd = r4(totalGeneralUsd + totalEmpleadoUsd)
    const linea = lineaPorEmpleado.get(cfg.empleado_id)
    return {
      empleado_id: cfg.empleado_id,
      nombre: cfg.empleado?.nombre || 'Empleado',
      cargo: cfg.cargo || null,
      pos_vendedor_id: cfg.pos_vendedor_id,
      tiene_linea_nomina: Boolean(linea),
      linea_id: linea?.id || null,
      pagado: Boolean(linea?.pagado),
      comisiones_actuales_usd: r4(Number(linea?.comisiones_pos_usd || 0)),
      despachos_actuales_ids: linea?.comisiones_despachos_ids || [],
      total_liberado_usd: totalEmpleadoUsd,
      despachos_count: libs.length,
      despachos: libs,
    }
  })

  return json({
    periodo,
    empleados: empleadosPreview,
    total_comisiones_usd: totalGeneralUsd,
  }, 200, request)
}

/**
 * POST /api/nomina/aplicar-comisiones-pos
 * Aplica de forma atómica las comisiones seleccionadas a las líneas de nómina correspondientes.
 * Body: {
 *   periodoId: string,
 *   aplicaciones: [
 *     { empleadoId: string, comisionesUsd: number, despachosIds: string[] }
 *   ]
 * }
 */
export async function handleAplicarComisionesPos(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { periodoId, aplicaciones } = body || {}
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)
  if (!Array.isArray(aplicaciones) || aplicaciones.length < 1 || aplicaciones.length > 500) {
    return jsonError('Selecciona entre 1 y 500 aplicaciones de comisión', 400, request)
  }
  const vistos = new Set()
  const limpias = []
  for (const item of aplicaciones) {
    const empleadoId = String(item?.empleadoId || '').toLowerCase()
    if (!isValidUuid(empleadoId) || vistos.has(empleadoId)) {
      return jsonError('Cada empleado debe ser válido y aparecer una sola vez', 400, request)
    }
    vistos.add(empleadoId)
    if (typeof item.comisionesUsd === 'boolean' || item.comisionesUsd == null
      || !Number.isFinite(Number(item.comisionesUsd)) || Number(item.comisionesUsd) < 0
      || Number(item.comisionesUsd) > 99999999.9999) {
      return jsonError(`Monto de comisión inválido para empleado ${empleadoId}`, 400, request)
    }
    if (!Array.isArray(item.despachosIds) || item.despachosIds.length > 5000
      || item.despachosIds.some(id => typeof id !== 'string' || !id.trim())
      || new Set(item.despachosIds).size !== item.despachosIds.length) {
      return jsonError(`Lista de despachos inválida para empleado ${empleadoId}`, 400, request)
    }
    limpias.push({
      empleadoId,
      comisionesUsd: String(item.comisionesUsd),
      despachosIds: item.despachosIds,
    })
  }

  // Never trust amounts or dispatch ids supplied by the browser. Resolve the
  // open period, tenant-owned POS links, and currently released commissions
  // server-side; the atomic RPC below still rechecks period/receipt state.
  const account = nominaTenantFilter(operador.cuenta_id)
  let periodResponse
  try {
    periodResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${account}&select=id,nombre,desde,hasta,estado&limit=1`,
      { headers },
    )
  } catch {
    return jsonError('No se pudo comprobar el período de nómina', 503, request)
  }
  if (!periodResponse.ok) return jsonError('No se pudo comprobar el período de nómina', 503, request)
  const [periodo] = await periodResponse.json().catch(() => [])
  if (!periodo) return jsonError('Período no encontrado', 404, request)
  if (periodo.estado !== 'abierto') return jsonError(`El período "${periodo.nombre}" debe estar abierto para aplicar comisiones.`, 409, request)

  const employeeIds = limpias.map(item => item.empleadoId)
  let configResponse
  try {
    configResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?activo=eq.true&pos_vendedor_id=not.is.null${account}` +
        `&empleado_id=in.(${employeeIds.join(',')})&select=empleado_id,pos_vendedor_id&limit=500`,
      { headers },
    )
  } catch {
    return jsonError('No se pudieron validar los vendedores vinculados al POS', 503, request)
  }
  if (!configResponse.ok) return jsonError('No se pudieron validar los vendedores vinculados al POS', 503, request)
  const configurations = await configResponse.json().catch(() => null)
  if (!Array.isArray(configurations)) return jsonError('No se pudieron validar los vendedores vinculados al POS', 503, request)
  const configByEmployee = new Map(configurations.map(config => [config.empleado_id, config]))
  if (configByEmployee.size !== limpias.length) return jsonError('Algún empleado ya no tiene un vendedor activo vinculado al POS', 409, request)

  if (new Set(configurations.map(config => config.pos_vendedor_id)).size !== configurations.length) {
    return jsonError('Un vendedor del POS está vinculado a más de un empleado. Corrige los vínculos antes de importar.', 409, request)
  }
  const posVendedorIds = [...new Set(configurations.map(config => config.pos_vendedor_id))]
  const posResult = await fetchComisionesLiberadasPos(env, {
    posVendedorIds,
    desde: periodo.desde,
    hasta: periodo.hasta,
  })
  if (!posResult.ok) return jsonError('No se pudieron verificar las comisiones liberadas en el POS', 502, request)
  const liberacionesPorVendedor = new Map()
  for (const liberacion of posResult.liberaciones || []) {
    const grupo = liberacionesPorVendedor.get(liberacion.vendedor_id) || []
    grupo.push(liberacion)
    liberacionesPorVendedor.set(liberacion.vendedor_id, grupo)
  }

  const verificadas = []
  for (const aplicacion of limpias) {
    const config = configByEmployee.get(aplicacion.empleadoId)
    const disponibles = liberacionesPorVendedor.get(config.pos_vendedor_id) || []
    const seleccion = new Set(aplicacion.despachosIds)
    const elegibles = disponibles.filter(liberacion => seleccion.has(liberacion.id))
    if (elegibles.length !== seleccion.size) {
      return jsonError(`Las comisiones seleccionadas para el empleado ${aplicacion.empleadoId} ya no están liberadas en el POS`, 409, request)
    }
    const totalVerificado = r4(elegibles.reduce((total, liberacion) => total + (Number(liberacion.monto_usd) || 0), 0))
    if (Math.abs(totalVerificado - Number(aplicacion.comisionesUsd)) > 0.0001) {
      return jsonError(`El monto de comisión del empleado ${aplicacion.empleadoId} no coincide con el POS`, 409, request)
    }
    verificadas.push({ ...aplicacion, comisionesUsd: String(totalVerificado) })
  }

  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/nomina_aplicar_comisiones_pos`, {
      method: 'POST',
      headers: svcHeaders(env),
      body: JSON.stringify({
        p_cuenta_id: operador.cuenta_id,
        p_operador_id: operador.id,
        p_periodo_id: periodoId,
        p_aplicaciones: verificadas,
        p_ip: ip || null,
      }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      const code = result?.code
      const errors = {
        PT400: [400, 'Las aplicaciones o los montos de comisión no son válidos.'],
        PT403: [403, 'Acceso denegado para aplicar comisiones.'],
        PT404: [404, 'No se encontró el período o alguna línea de nómina.'],
        PT409: [409, 'El período o alguno de los recibos cambió. Actualiza y revisa antes de reintentar.'],
        PGRST202: [503, 'Es necesario actualizar la base antes de aplicar comisiones.'],
      }
      const [status, message] = errors[code] || [503, 'No se confirmó la aplicación. Actualiza y verifica las líneas antes de reintentar.']
      return jsonError(message, status, request)
    }
    const expectedTotal = r4(verificadas.reduce((total, item) => total + Number(item.comisionesUsd), 0))
    const detailsValid = Array.isArray(result?.detalle) && result.detalle.length === verificadas.length
      && verificadas.every(item => result.detalle.some(detail => detail.empleado_id === item.empleadoId
        && Number(detail.comisiones_pos_usd) === Number(item.comisionesUsd)
        && detail.despachos_count === item.despachosIds.length))
    if (result?.ok !== true || result.actualizados !== verificadas.length
      || !Number.isFinite(Number(result.total_comisiones_usd))
      || Math.abs(Number(result.total_comisiones_usd) - expectedTotal) > 0.0001
      || !detailsValid) {
      return jsonError('La respuesta no confirma la aplicación completa de comisiones.', 503, request)
    }
    return json(result, 200, request)
  } catch {
    return jsonError('No se confirmó la aplicación. Actualiza las líneas antes de reintentar.', 503, request)
  }
}
