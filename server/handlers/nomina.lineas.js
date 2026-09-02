// server/handlers/nomina.lineas.js
// Recibos y pagos: las mutaciones son administrativas y tenant-scoped.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import {
  ROLES_ADMIN,
  ROLES_NOMINA,
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
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
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
      'deducciones_usd,total_bruto_usd,total_neto_usd,nota_bonos,nota_deducciones,pagado,' +
      'pagado_en,pagado_por_nombre,referencia_pago,empleado:clientes!empleado_id(id,nombre,rif)' +
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
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { lineaId, bonosUsd, deduccionesUsd, notaBonos, notaDeducciones } = body || {}
  if (!lineaId || !isValidUuid(lineaId)) return jsonError('lineaId inválido', 400, request)

  const lineResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=eq.${lineaId}` +
      `${nominaTenantFilter(operador.cuenta_id)}` +
      '&select=id,periodo_id,pagado,monto_normal_usd,monto_extra_usd,monto_sabado_usd,monto_feriado_usd&limit=1',
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
  const base = Number(line.monto_normal_usd || 0) + Number(line.monto_extra_usd || 0) +
    Number(line.monto_sabado_usd || 0) + Number(line.monto_feriado_usd || 0)
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

export async function handlePagarLineas(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { lineaIds, referencia } = body || {}
  const ids = Array.isArray(lineaIds) ? [...new Set(lineaIds.filter(isValidUuid))] : []
  if (!ids.length) return jsonError('No hay recibos seleccionados', 400, request)
  if (!textoNominaValido(referencia, 160)) return jsonError('Referencia de pago inválida', 400, request)

  const lineResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=in.(${ids.join(',')})` +
      `${nominaTenantFilter(operador.cuenta_id)}&select=id,periodo_id,pagado,total_neto_usd`,
    { headers },
  )
  if (!lineResponse.ok) return jsonError('Error al leer recibos', 500, request)
  const lines = await lineResponse.json()
  if (!lines.length) return jsonError('Recibos no encontrados', 404, request)
  if (lines.length !== ids.length) return jsonError('Uno o más recibos no existen en esta cuenta', 404, request)
  if (lines.some(line => line.pagado)) return jsonError('Alguno de los recibos ya está pagado', 400, request)

  const periodIds = [...new Set(lines.map(line => line.periodo_id))]
  const periodResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=in.(${periodIds.join(',')})` +
      `${nominaTenantFilter(operador.cuenta_id)}&select=id,nombre,estado`,
    { headers },
  )
  if (!periodResponse.ok) return jsonError('Error al leer períodos', 500, request)
  const periods = await periodResponse.json()
  if (periodIds.some(id => !periods.some(period => period.id === id))) return jsonError('Uno de los períodos no existe', 404, request)
  const open = periods.find(period => period.estado === 'abierto')
  if (open) return jsonError(`Cierra el período "${open.nombre}" antes de pagar`, 400, request)

  const now = new Date().toISOString()
  const update = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=in.(${ids.join(',')})${nominaTenantFilter(operador.cuenta_id)}&pagado=eq.false&select=id`,
    {
      method: 'PATCH',
      headers: svcHeaders(env, 'return=representation'),
      body: JSON.stringify({ pagado: true, pagado_en: now, pagado_por: operador.id, pagado_por_nombre: operador.nombre, referencia_pago: referencia || null }),
    },
  )
  if (!update.ok) return jsonError('No se pudo registrar el pago', 500, request)
  const updated = await update.json()
  if (!Array.isArray(updated) || updated.length !== ids.length) return jsonError('El estado de algún recibo cambió; vuelve a cargar e intenta de nuevo', 409, request)

  for (const periodId of periodIds) {
    const pendingResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodId}${nominaTenantFilter(operador.cuenta_id)}&pagado=eq.false&select=id&limit=1`,
      { headers },
    )
    if (!pendingResponse.ok) return jsonError('No se pudo confirmar el estado del período', 500, request)
    if (!(await pendingResponse.json()).length) {
      const periodUpdate = await fetch(
        `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodId}${nominaTenantFilter(operador.cuenta_id)}&estado=eq.cerrado`,
        { method: 'PATCH', headers: svcHeaders(env, 'return=minimal'), body: JSON.stringify({ estado: 'pagado' }) },
      )
      if (!periodUpdate.ok) return jsonError('No se pudo cerrar el estado de pago del período', 500, request)
    }
  }

  const total = r4(lines.reduce((sum, line) => sum + Number(line.total_neto_usd || 0), 0))

  // ── Sincronización Contable Automática: Registrar Egreso en Finanzas ──
  if (total > 0) {
    try {
      const periodNames = periods.map(p => p.nombre).join(', ')
      const concepto = `Pago de Nómina: ${periodNames} (${ids.length} recibos)`.slice(0, 180)
      const idempotencyKey = `nomina_pago_${ids.slice().sort().join('_').slice(0, 70)}_${now.slice(0, 10)}`.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 128)
      const tasaNum = Number(body?.tasaBcv) > 0 ? Number(body.tasaBcv) : 1
      const fuenteTasa = ['BCV', 'EURO', 'USDT', 'MANUAL'].includes(body?.fuenteTasa) ? body.fuenteTasa : 'BCV'

      // Asegurar categoría "Nómina" en finanzas_categorias
      await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_categorias`, {
        method: 'POST',
        headers: svcHeaders(env, 'resolution=ignore-duplicates'),
        body: JSON.stringify({
          cuenta_id: operador.cuenta_id,
          nombre: 'Nómina',
          tipo: 'egreso',
          activo: true,
          creado_por: operador.id,
        }),
      })

      // Insertar movimiento de egreso en finanzas_movimientos
      await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_movimientos`, {
        method: 'POST',
        headers: svcHeaders(env, 'return=representation'),
        body: JSON.stringify({
          cuenta_id: operador.cuenta_id,
          fecha: now.slice(0, 10),
          tipo: 'egreso',
          categoria: 'Nómina',
          concepto,
          monto: total,
          moneda: 'USD',
          tasa_ves: tasaNum,
          fuente_tasa: fuenteTasa,
          observacion_tasa: fuenteTasa === 'MANUAL' ? 'Tasa manual fijada en pago de nómina' : null,
          referencia: referencia || null,
          observaciones: `Liquidación de ${ids.length} recibo(s) de nómina autorizada por ${operador.nombre}`,
          idempotency_key: idempotencyKey,
          estado: 'activo',
          creado_por: operador.id,
        }),
      })
    } catch (syncError) {
      // Falla no bloqueante en asiento de finanzas, pero debe ser trazable:
      // sin esto, un descuadre nómina↔finanzas sería invisible.
      registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        cuentaId: operador.cuenta_id, categoria: 'FINANZAS', accion: 'SYNC_NOMINA_FALLIDA',
        entidadTipo: 'nomina_linea', entidadId: ids[0],
        meta: { recibos: ids.length, total_usd: total, periodIds, error: String(syncError) }, ip,
      }).catch(() => {})
    }
  }

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'PAGAR_NOMINA',
    entidadTipo: 'nomina_linea', entidadId: ids[0],
    meta: { recibos: ids.length, total_usd: total, referencia: referencia || null }, ip,
  }).catch(() => {})
  return json({ ok: true, recibos_pagados: ids.length, total_usd: total }, 200, request)
}

export async function handleRevertirPagoLinea(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { lineaId } = body || {}
  if (!lineaId || !isValidUuid(lineaId)) return jsonError('lineaId inválido', 400, request)

  const lineResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=eq.${lineaId}${nominaTenantFilter(operador.cuenta_id)}&select=id,periodo_id,pagado,total_neto_usd&limit=1`,
    { headers },
  )
  const [line] = lineResponse.ok ? await lineResponse.json() : []
  if (!line) return jsonError('Recibo no encontrado', 404, request)
  if (!line.pagado) return jsonError('Este recibo no está pagado', 400, request)

  const update = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=eq.${lineaId}${nominaTenantFilter(operador.cuenta_id)}&pagado=eq.true&select=id`,
    {
      method: 'PATCH',
      headers: svcHeaders(env, 'return=representation'),
      body: JSON.stringify({ pagado: false, pagado_en: null, pagado_por: null, pagado_por_nombre: null, referencia_pago: null }),
    },
  )
  if (!update.ok) return jsonError('Error al revertir el pago', 500, request)
  const reverted = await update.json()
  if (!Array.isArray(reverted) || reverted.length !== 1) return jsonError('El estado del recibo cambió; vuelve a cargar e intenta de nuevo', 409, request)

  const periodUpdate = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${line.periodo_id}${nominaTenantFilter(operador.cuenta_id)}&estado=eq.pagado`,
    { method: 'PATCH', headers: svcHeaders(env, 'return=minimal'), body: JSON.stringify({ estado: 'cerrado' }) },
  )
  if (!periodUpdate.ok) return jsonError('El pago se revirtió, pero no se pudo actualizar el período', 500, request)

  // ── Sincronización Contable: Anular egreso financiero vinculado ──
  try {
    const finRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?cuenta_id=eq.${operador.cuenta_id}` +
        `&idempotency_key=like.nomina_pago_${lineaId}*&estado=eq.activo&select=id`,
      { headers: svcHeaders(env) },
    )
    if (finRes.ok) {
      const rows = await finRes.json()
      for (const r of rows) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?id=eq.${r.id}`, {
          method: 'PATCH',
          headers: svcHeaders(env, 'return=minimal'),
          body: JSON.stringify({
            estado: 'anulado',
            anulado_en: new Date().toISOString(),
            anulado_por: operador.id,
            motivo_anulacion: 'Reversión de pago de nómina',
          }),
        })
      }
    }
  } catch (syncError) {
    // Falla no bloqueante, pero trazable (ver handlePagarLineas).
    registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      cuentaId: operador.cuenta_id, categoria: 'FINANZAS', accion: 'SYNC_NOMINA_FALLIDA',
      entidadTipo: 'nomina_linea', entidadId: lineaId,
      meta: { fase: 'revertir_pago', error: String(syncError) }, ip,
    }).catch(() => {})
  }

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'REVERTIR_PAGO_NOMINA',
    entidadTipo: 'nomina_linea', entidadId: lineaId,
    meta: { monto_usd: Number(line.total_neto_usd || 0) }, ip,
  }).catch(() => {})
  return json({ ok: true }, 200, request)
}
