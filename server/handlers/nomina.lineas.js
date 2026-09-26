// server/handlers/nomina.lineas.js
// Recibos y pagos: las mutaciones son administrativas y tenant-scoped.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { handleFinancialMutation } from './finanzas.operaciones.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { requireCapacidad } from '../lib/permissions.js'
import {
  ajusteNominaValido,
  r4,
  svcHeaders,
  tenantGuard,
  textoNominaValido,
} from './nomina.shared.js'

export async function handleGetLineas(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const periodoId = new URL(request.url).searchParams.get('periodoId')
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}` +
      `${nominaTenantFilter(operador.cuenta_id)}` +
      '&select=id,empleado_id,cargo_snap,salario_dia_usd_snap,horas_jornada_snap,' +
      'dias_trabajados,horas_normales,horas_extra,dias_sabado,dias_feriado,dias_ausencia,' +
      'monto_normal_usd,monto_extra_usd,monto_sabado_usd,monto_feriado_usd,bonos_usd,' +
      'deducciones_usd,comisiones_pos_usd,comisiones_despachos_ids,total_bruto_usd,total_neto_usd,nota_bonos,nota_deducciones,pagado,' +
      'pagado_en,pagado_por_nombre,referencia_pago,tasa_pago_usd_ves,total_pagado_bs,' +
      'empleado:clientes!empleado_id(id,nombre,rif)' +
      '&order=empleado(nombre).asc&limit=500',
    { headers },
  )
  if (!response.ok) return jsonError('Error al leer líneas', 500, request)
  return json(await response.json() ?? [], 200, request)
}

export async function handleAjustarLinea(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { lineaId, bonosUsd, deduccionesUsd, notaBonos, notaDeducciones } = body || {}
  if (!lineaId || !isValidUuid(lineaId)) return jsonError('lineaId inválido', 400, request)

  const lineResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=eq.${lineaId}` +
      `${nominaTenantFilter(operador.cuenta_id)}` +
      '&select=id,periodo_id,pagado,monto_normal_usd,monto_extra_usd,monto_sabado_usd,monto_feriado_usd,comisiones_pos_usd&limit=1',
    { headers },
  )
  const [line] = lineResponse.ok ? await lineResponse.json() : []
  if (!line) return jsonError('Línea no encontrada', 404, request)
  if (line.pagado) return jsonError('No se puede ajustar un recibo ya pagado. Revierte el pago primero.', 400, request)

  const periodResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${line.periodo_id}` +
      `${nominaTenantFilter(operador.cuenta_id)}&select=estado,nombre&limit=1`,
    { headers },
  )
  const [period] = periodResponse.ok ? await periodResponse.json() : []
  if (period && period.estado !== 'abierto') return jsonError(`El período "${period.nombre}" está ${period.estado}`, 400, request)
  if (!ajusteNominaValido(bonosUsd) || !ajusteNominaValido(deduccionesUsd)) return jsonError('Bonos o deducciones inválidos', 400, request)
  if (!textoNominaValido(notaBonos, 500) || !textoNominaValido(notaDeducciones, 500)) return jsonError('Notas de ajuste inválidas', 400, request)

  const bonos = Math.max(0, Number(bonosUsd) || 0)
  const deducciones = Math.max(0, Number(deduccionesUsd) || 0)
  const comisiones = Math.max(0, Number(line.comisiones_pos_usd) || 0)
  const base = Number(line.monto_normal_usd || 0) + Number(line.monto_extra_usd || 0) +
    Number(line.monto_sabado_usd || 0) + Number(line.monto_feriado_usd || 0) + comisiones
  const bruto = r4(base + bonos)
  const neto = r4(Math.max(0, bruto - deducciones))

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=eq.${lineaId}${nominaTenantFilter(operador.cuenta_id)}` +
      '&select=id,bonos_usd,deducciones_usd,total_bruto_usd,total_neto_usd,nota_bonos,nota_deducciones',
    {
      method: 'PATCH',
      headers: svcHeaders(env),
      body: JSON.stringify({
        bonos_usd: r4(bonos),
        deducciones_usd: r4(deducciones),
        total_bruto_usd: bruto,
        total_neto_usd: neto,
        nota_bonos: notaBonos || null,
        nota_deducciones: notaDeducciones || null,
      }),
    },
  )
  if (!response.ok) return jsonError('Error al ajustar línea', 500, request)
  const [updated] = await response.json()
  return json({ ok: true, linea: updated }, 200, request)
}

export function handlePagarLineas(request, env) {
  return handleFinancialMutation(request, env, 'pagar_nomina')
}

export function handleRevertirPagoLinea(request, env) {
  return handleFinancialMutation(request, env, 'revertir_nomina')
}
