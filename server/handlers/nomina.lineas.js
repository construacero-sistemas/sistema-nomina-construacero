// server/handlers/nomina.lineas.js
// Recibos y pagos: las mutaciones son administrativas y tenant-scoped.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { handleFinancialMutation } from './finanzas.operaciones.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { requireCapacidad } from '../lib/permissions.js'
import {
  componerNotaDescuentos,
  totalDescuentosNomina,
  validarDescuentosNomina,
} from '../lib/nominaDescuentos.js'
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

  const selectBase = 'id,empleado_id,cargo_snap,salario_dia_usd_snap,horas_jornada_snap,' +
    'dias_trabajados,horas_normales,horas_extra,dias_sabado,dias_feriado,dias_ausencia,' +
    'monto_normal_usd,monto_extra_usd,monto_sabado_usd,monto_feriado_usd,bonos_usd,' +
    'deducciones_usd,comisiones_pos_usd,comisiones_despachos_ids,total_bruto_usd,total_neto_usd,nota_bonos,nota_deducciones,pagado,' +
    'pagado_en,pagado_por_nombre,referencia_pago,tasa_pago_usd_ves,total_pagado_bs,' +
    'empleado:clientes!empleado_id(id,nombre,rif)'
  // El desglose de descuentos (migración 257) viaja embebido por recibo. Si esa
  // tabla aún no existe, la lectura sigue válida sin desglose y el recibo usa
  // su resumen histórico (nota_deducciones), en vez de tumbar el listado.
  const selectConDescuentos = `${selectBase},descuentos:nomina_descuentos(id,motivo,detalle,monto_usd,creado_en)`
  const urlLineas = select => `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=${select}&order=empleado(nombre).asc&limit=500`
  let response = await fetch(urlLineas(selectConDescuentos), { headers })
  if (response.status === 400) {
    const detalle = await response.text().catch(() => '')
    if (detalle.includes('nomina_descuentos')) response = await fetch(urlLineas(selectBase), { headers })
  }
  if (!response.ok) return jsonError('Error al leer líneas', 500, request)
  const lineas = (await response.json() ?? []).map(linea => ({
    ...linea,
    descuentos: Array.isArray(linea.descuentos)
      ? [...linea.descuentos].sort((a, b) => String(a.creado_en || '').localeCompare(String(b.creado_en || '')))
      : [],
  }))
  return json(lineas, 200, request)
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
  const { lineaId, bonosUsd, notaBonos, descuentos, deduccionesUsd, notaDeducciones } = body || {}
  if (!lineaId || !isValidUuid(lineaId)) return jsonError('lineaId inválido', 400, request)
  // Regla vigente: todo descuento se registra con motivo obligatorio. Los
  // montos sueltos del contrato anterior no se aceptan porque no dejan traza
  // del motivo y burlan la validación de neto no negativo.
  if (deduccionesUsd !== undefined || notaDeducciones !== undefined) {
    return jsonError('Los descuentos se registran con motivo: envía la lista "descuentos" (motivo, monto y detalle), no montos sueltos', 400, request)
  }
  const validacion = validarDescuentosNomina(descuentos)
  if (!validacion.ok) return jsonError(validacion.error, 400, request)
  if (!ajusteNominaValido(bonosUsd)) return jsonError('Bonos inválidos', 400, request)
  if (!textoNominaValido(notaBonos, 500)) return jsonError('Nota de bonos inválida', 400, request)

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

  const bonos = Math.max(0, Number(bonosUsd) || 0)
  const deducciones = totalDescuentosNomina(validacion.descuentos)
  const comisiones = Math.max(0, Number(line.comisiones_pos_usd) || 0)
  const base = Number(line.monto_normal_usd || 0) + Number(line.monto_extra_usd || 0) +
    Number(line.monto_sabado_usd || 0) + Number(line.monto_feriado_usd || 0) + comisiones
  const bruto = r4(base + bonos)
  // Regla: el neto nunca queda en negativo. No se recorta el descuento a
  // escondidas: se rechaza el conjunto para que quien liquida decida cómo
  // repartir la recuperación entre semanas.
  if (deducciones > bruto) {
    return jsonError(`Los descuentos suman $${deducciones} y superan el total bruto ($${bruto}); el neto no puede quedar en negativo`, 400, request)
  }
  const neto = r4(bruto - deducciones)

  // El dinero vive en el recibo (un solo PATCH al final); el desglose es
  // documental. Se inserta primero el conjunto nuevo y después se poda lo que
  // sobra, para que un fallo intermedio nunca deje al recibo sin descuentos.
  const filas = validacion.descuentos.map(d => ({
    linea_id: lineaId,
    periodo_id: line.periodo_id,
    motivo: d.motivo,
    detalle: d.detalle,
    monto_usd: d.monto,
    cuenta_id: operador.cuenta_id,
    creado_por: operador.id,
    creado_por_nombre: operador.nombre,
  }))
  const idsNuevos = []
  if (filas.length) {
    const insert = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_descuentos`, {
      method: 'POST',
      headers: svcHeaders(env),
      body: JSON.stringify(filas),
    })
    if (!insert.ok) return jsonError('No se pudieron registrar los descuentos del recibo', 500, request)
    const creadas = await insert.json()
    for (const fila of creadas ?? []) if (fila?.id) idsNuevos.push(fila.id)
    if (idsNuevos.length !== filas.length) return jsonError('No se pudo confirmar el registro de descuentos', 500, request)
  }
  const poda = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_descuentos?linea_id=eq.${lineaId}${nominaTenantFilter(operador.cuenta_id)}` +
      (idsNuevos.length ? `&id=not.in.(${idsNuevos.join(',')})` : ''),
    { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') },
  )
  if (!poda.ok) return jsonError('No se pudieron actualizar los descuentos del recibo', 500, request)

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
        nota_deducciones: componerNotaDescuentos(validacion.descuentos),
      }),
    },
  )
  if (!response.ok) return jsonError('Error al ajustar línea', 500, request)
  const [updated] = await response.json()
  return json({ ok: true, linea: updated, descuentos: validacion.descuentos }, 200, request)
}

export function handlePagarLineas(request, env) {
  return handleFinancialMutation(request, env, 'pagar_nomina')
}

export function handleRevertirPagoLinea(request, env) {
  return handleFinancialMutation(request, env, 'revertir_nomina')
}
