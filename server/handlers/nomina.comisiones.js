// server/handlers/nomina.comisiones.js
// Gestión e importación de comisiones de vendedores desde el POS a Nómina.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { fetchPosVendedores, fetchComisionesLiberadasPos } from '../lib/posSyncHelper.js'
import {
  ROLES_ADMIN,
  ROLES_NOMINA,
  ROLES_VER,
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
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
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
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
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
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { periodoId, aplicaciones } = body || {}
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)
  if (!Array.isArray(aplicaciones)) return jsonError('aplicaciones debe ser un array', 400, request)

  // 1. Validar período abierto
  const periodResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}` +
      `${nominaTenantFilter(operador.cuenta_id)}&select=id,nombre,estado&limit=1`,
    { headers },
  )
  const [periodo] = periodResponse.ok ? await periodResponse.json() : []
  if (!periodo) return jsonError('Período no encontrado', 404, request)
  if (periodo.estado !== 'abierto') {
    return jsonError(`El período "${periodo.nombre}" está ${periodo.estado}. Debe estar abierto para aplicar comisiones.`, 400, request)
  }

  // 2. Obtener líneas existentes de este período
  const linesResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}` +
      `${nominaTenantFilter(operador.cuenta_id)}` +
      '&select=id,empleado_id,monto_normal_usd,monto_extra_usd,monto_sabado_usd,monto_feriado_usd,bonos_usd,deducciones_usd,comisiones_pos_usd,comisiones_despachos_ids,pagado&limit=500',
    { headers },
  )
  const lineas = linesResponse.ok ? await linesResponse.json() : []
  if (!lineas.length) {
    return jsonError('El período no tiene líneas calculadas. Debes calcular la nómina antes de aplicar comisiones.', 400, request)
  }
  const lineaPorEmpleado = new Map(lineas.map(l => [l.empleado_id, l]))

  // 3. Validar y actualizar cada empleado
  const actualizados = []
  let totalComisionesAplicadas = 0

  for (const item of aplicaciones) {
    const { empleadoId, comisionesUsd, despachosIds } = item || {}
    if (!empleadoId || !isValidUuid(empleadoId)) continue
    if (comisionesUsd !== undefined && comisionesUsd !== null && (typeof comisionesUsd === 'boolean' || !Number.isFinite(Number(comisionesUsd)) || Number(comisionesUsd) < 0)) {
      return jsonError(`Monto de comisión inválido para empleado ${empleadoId}`, 400, request)
    }

    const linea = lineaPorEmpleado.get(empleadoId)
    if (!linea) continue
    if (linea.pagado) {
      return jsonError('No se pueden modificar comisiones de un recibo ya pagado. Revierte el pago primero.', 400, request)
    }

    const nuevaComision = r4(Number(comisionesUsd) || 0)
    const despachosLimpios = Array.isArray(despachosIds) ? despachosIds : []

    const montoNormal = Number(linea.monto_normal_usd || 0)
    const montoExtra = Number(linea.monto_extra_usd || 0)
    const montoSabado = Number(linea.monto_sabado_usd || 0)
    const montoFeriado = Number(linea.monto_feriado_usd || 0)
    const bonos = Number(linea.bonos_usd || 0)
    const deducciones = Number(linea.deducciones_usd || 0)

    const base = montoNormal + montoExtra + montoSabado + montoFeriado + bonos + nuevaComision
    const totalBruto = r4(base)
    const totalNeto = r4(Math.max(0, totalBruto - deducciones))

    const patchRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=eq.${linea.id}${nominaTenantFilter(operador.cuenta_id)}`,
      {
        method: 'PATCH',
        headers: svcHeaders(env),
        body: JSON.stringify({
          comisiones_pos_usd: nuevaComision,
          comisiones_despachos_ids: despachosLimpios,
          total_bruto_usd: totalBruto,
          total_neto_usd: totalNeto,
        }),
      },
    )

    if (!patchRes.ok) {
      return jsonError(`Error actualizando línea de nómina para empleado ${empleadoId}`, 500, request)
    }

    actualizados.push({
      empleado_id: empleadoId,
      linea_id: linea.id,
      comisiones_pos_usd: nuevaComision,
      despachos_count: despachosLimpios.length,
      total_neto_usd: totalNeto,
    })
    totalComisionesAplicadas = r4(totalComisionesAplicadas + nuevaComision)
  }

  // 4. Registro de auditoría
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA',
    accion: 'APLICAR_COMISIONES_POS',
    entidadTipo: 'nomina_periodo',
    entidadId: periodoId,
    meta: {
      periodo: periodo.nombre,
      empleados_actualizados: actualizados.length,
      total_comisiones_usd: totalComisionesAplicadas,
    },
    ip,
  }).catch(() => {})

  return json({
    ok: true,
    actualizados: actualizados.length,
    total_comisiones_usd: totalComisionesAplicadas,
    detalle: actualizados,
  }, 200, request)
}
