// server/handlers/finanzas.sync.js
// Sincronización de cierres de ventas desde el POS hacia las Carteras Financieras
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { requireAdmin } from '../lib/permissions.js'
import { movementResponse } from '../lib/finanzasUtils.js'
import { fetchDayPosDataFromDirectDb } from '../lib/posSyncHelper.js'
import {
  validarDistribucionMatematica,
  validarCompatibilidadMonedas,
  reconciliarTramosPrevios,
} from '../lib/posSyncValidation.js'

const MOVEMENT_SELECT = [
  'id', 'fecha', 'tipo', 'categoria', 'concepto', 'monto', 'moneda',
  'tasa_ves', 'monto_ves', 'fuente_tasa', 'observacion_tasa',
  'referencia', 'observaciones', 'estado', 'creado_en', 'anulado_en',
  'motivo_anulacion', 'metodo_pago', 'cuenta_origen',
].join(',')

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100
}

function adminContext(request, env) {
  return validateOperator(request, env).then(result => {
    if (result.error) return result
    const denied = requireAdmin(result.operador, request)
    if (denied) return { error: denied }
    if (!isValidUuid(result.operador.cuenta_id)) {
      return { error: jsonError('Cuenta inválida', 403, request) }
    }
    return result
  })
}

function serviceHeaders(env, prefer = 'return=representation') {
  return { ...supaServiceHeaders(env), Prefer: prefer }
}

function accountFilter(accountId) {
  return `cuenta_id=eq.${encodeURIComponent(accountId)}`
}

function queryValue(value) {
  return encodeURIComponent(String(value))
}

async function readExistingByKey(env, accountId, key) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?${accountFilter(accountId)}` +
      `&idempotency_key=eq.${queryValue(key)}&select=${MOVEMENT_SELECT}&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!response.ok) return { error: true, row: null }
  const rows = await response.json().catch(() => [])
  return { error: false, row: Array.isArray(rows) && rows.length > 0 ? rows[0] : null }
}

async function saveSyncMovement(env, cuentaId, operadorId, movementData) {
  const existing = await readExistingByKey(env, cuentaId, movementData.idempotency_key)
  if (existing.row) {
    const patchBody = {
      monto: movementData.monto,
      tasa_ves: movementData.tasa_ves,
      concepto: movementData.concepto,
      referencia: movementData.referencia,
      observaciones: movementData.observaciones,
      ...(movementData.tasa_usd_ves != null ? { tasa_usd_ves: movementData.tasa_usd_ves } : {}),
      ...(movementData.metodo_pago ? { metodo_pago: movementData.metodo_pago } : {}),
      ...(movementData.cuenta_origen ? { cuenta_origen: movementData.cuenta_origen } : {}),
    }
    const patchRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?id=eq.${queryValue(existing.row.id)}&${accountFilter(cuentaId)}`,
      {
        method: 'PATCH',
        headers: serviceHeaders(env),
        body: JSON.stringify(patchBody),
      }
    )
    if (!patchRes.ok) {
      const fallbackRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?id=eq.${queryValue(existing.row.id)}&${accountFilter(cuentaId)}`,
        {
          method: 'PATCH',
          headers: serviceHeaders(env),
          body: JSON.stringify({
            monto: movementData.monto,
            tasa_ves: movementData.tasa_ves,
            observaciones: movementData.observaciones,
          }),
        }
      )
      if (fallbackRes.ok) {
        const rows = await fallbackRes.json().catch(() => [])
        return { ok: true, accion: 'actualizado', movimiento: movementResponse(rows?.[0] || existing.row) }
      }
      const errText = await patchRes.text().catch(() => '')
      return { ok: false, error: errText }
    }
    const rows = await patchRes.json().catch(() => [])
    return { ok: true, accion: 'actualizado', movimiento: movementResponse(rows?.[0] || existing.row) }
  }

  // Insertar nuevo movimiento
  const basePayload = {
    cuenta_id: cuentaId,
    fecha: movementData.fecha,
    tipo: movementData.tipo,
    categoria: movementData.categoria,
    concepto: movementData.concepto,
    monto: movementData.monto,
    moneda: movementData.moneda,
    tasa_ves: movementData.tasa_ves,
    ...(movementData.tasa_usd_ves != null ? { tasa_usd_ves: movementData.tasa_usd_ves } : {}),
    fuente_tasa: movementData.fuente_tasa || 'BCV',
    referencia: movementData.referencia,
    observaciones: movementData.observaciones,
    idempotency_key: movementData.idempotency_key,
    creado_por: operadorId,
    ...(movementData.metodo_pago ? { metodo_pago: movementData.metodo_pago } : {}),
    ...(movementData.cuenta_origen ? { cuenta_origen: movementData.cuenta_origen } : {}),
  }

  const postRes = await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_movimientos`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify(basePayload),
  })

  if (!postRes.ok) {
    const errText = await postRes.text().catch(() => '')
    const retryPayload = {
      ...basePayload,
      fuente_tasa: 'BCV',
    }
    delete retryPayload.tasa_usd_ves
    delete retryPayload.metodo_pago
    delete retryPayload.cuenta_origen

    const retryRes = await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_movimientos`, {
      method: 'POST',
      headers: serviceHeaders(env),
      body: JSON.stringify(retryPayload),
    })

    if (retryRes.ok) {
      const rows = await retryRes.json().catch(() => [])
      return { ok: true, accion: 'creado', movimiento: movementResponse(rows?.[0] || retryPayload) }
    }

    const retryErrText = await retryRes.text().catch(() => '')
    return { ok: false, error: retryErrText || errText }
  }

  const rows = await postRes.json().catch(() => [])
  return { ok: true, accion: 'creado', movimiento: movementResponse(rows?.[0] || basePayload) }
}

function getDatesArray(startDateStr, endDateStr) {
  const dates = []
  let curr = new Date(`${startDateStr}T00:00:00Z`)
  const end = new Date(`${endDateStr}T00:00:00Z`)
  while (curr <= end) {
    dates.push(curr.toISOString().slice(0, 10))
    curr.setUTCDate(curr.getUTCDate() + 1)
  }
  return dates
}

async function fetchDayPosData(posUrl, syncSecret, fecha, env) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(`${posUrl}/api/finanzas-sync/cierre-diario?fecha=${encodeURIComponent(fecha)}`, {
      method: 'GET',
      headers: {
        'x-sync-secret': syncSecret,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (res.ok) {
      const data = await res.json()
      return { ok: true, data }
    }
  } catch {
    clearTimeout(timeout)
  }

  // Fallback directo a Supabase POS para máxima resiliencia
  return fetchDayPosDataFromDirectDb(env, fecha)
}

export async function handleSyncVentasPos(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error

  let body = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const singleDate = String(body.fecha || '').trim()
  const desde = String(body.desde || singleDate || '').trim() || new Date().toISOString().slice(0, 10)
  const hasta = String(body.hasta || singleDate || desde).trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return jsonError('Formato de fecha inválido (use YYYY-MM-DD)', 400, request)
  }

  if (desde > hasta) {
    return jsonError('La fecha de inicio no puede ser posterior a la fecha fin', 400, request)
  }

  const posUrl = (body.posUrl || env.POS_API_URL || 'https://listo-pos-cotizaciones.pages.dev').replace(/\/$/, '')
  const syncSecret = env.FINANZAS_SYNC_SECRET || env.SYNC_SECRET_KEY || 'construacero-sync-secret-2026'
  const confirm = Boolean(body.confirm)

  const dateList = getDatesArray(desde, hasta)
  if (dateList.length > 31) {
    return jsonError('El rango máximo de sincronización es de 31 días', 400, request)
  }

  // 1. Consultar días en el POS
  const consolidated = {
    total_despachos: 0,
    ventas_netas_usd: 0,
    ventas_contado_usd: 0,
    fletes_foraneos_usd: 0,
    cobros_cxc_usd: 0,
    cxc_otorgado_usd: 0,
    cod_otorgado_usd: 0,
    creditos_pendientes_usd: 0,
    total_ingresos_usd: 0,
    desglose_pagos: {
      efectivo_usd: 0,
      zelle_usd: 0,
      usdt_usd: 0,
      efectivo_ves: 0,
      transferencia_ves: 0,
      pago_movil_ves: 0,
      punto_venta_ves: 0,
      otros_usd: 0,
    },
    tasa_bcv: 1,
    despachos_detalle: [],
    dias: [],
  }

  for (const fecha of dateList) {
    const fetchResult = await fetchDayPosData(posUrl, syncSecret, fecha, env)
    if (!fetchResult.ok) {
      return jsonError(
        fetchResult.error || 'Error al conectar con el servidor POS',
        fetchResult.status === 401 ? 401 : 502,
        request
      )
    }

    const dayData = fetchResult.data
    if (dayData) {
      consolidated.total_despachos += Number(dayData.total_despachos || 0)
      consolidated.ventas_netas_usd += Number(dayData.ventas_netas_usd || dayData.ventas_contado_usd || 0)
      consolidated.ventas_contado_usd += Number(dayData.ventas_netas_usd || dayData.ventas_contado_usd || 0)
      consolidated.fletes_foraneos_usd += Number(dayData.fletes_foraneos_usd || 0)
      consolidated.cobros_cxc_usd += Number(dayData.cobros_cxc_usd || 0)
      consolidated.cxc_otorgado_usd += Number(dayData.cxc_otorgado_usd || 0)
      consolidated.cod_otorgado_usd += Number(dayData.cod_otorgado_usd || 0)
      consolidated.creditos_pendientes_usd += Number(dayData.creditos_pendientes_usd || dayData.creditos_otorgados_usd || 0)
      consolidated.total_ingresos_usd += Number(dayData.total_ingresos_usd || 0)
      if (dayData.tasa_bcv) consolidated.tasa_bcv = Number(dayData.tasa_bcv)

      const dp = dayData.desglose_pagos || {}
      consolidated.desglose_pagos.efectivo_usd += Number(dp.efectivo_usd || 0)
      consolidated.desglose_pagos.zelle_usd += Number(dp.zelle_usd || 0)
      consolidated.desglose_pagos.usdt_usd += Number(dp.usdt_usd || 0)
      consolidated.desglose_pagos.efectivo_ves += Number(dp.efectivo_ves || 0)
      consolidated.desglose_pagos.transferencia_ves += Number(dp.transferencia_ves || 0)
      consolidated.desglose_pagos.pago_movil_ves += Number(dp.pago_movil_ves || 0)
      consolidated.desglose_pagos.punto_venta_ves += Number(dp.punto_venta_ves || 0)
      consolidated.desglose_pagos.otros_usd += Number(dp.otros_usd || 0)

      if (Array.isArray(dayData.despachos_detalle)) {
        consolidated.despachos_detalle.push(...dayData.despachos_detalle)
      }

      consolidated.dias.push({ fecha, posData: dayData })
    }
  }

  // Redondear consolidados
  consolidated.ventas_netas_usd = Number(consolidated.ventas_netas_usd.toFixed(2))
  consolidated.ventas_contado_usd = Number(consolidated.ventas_contado_usd.toFixed(2))
  consolidated.fletes_foraneos_usd = Number(consolidated.fletes_foraneos_usd.toFixed(2))
  consolidated.cobros_cxc_usd = Number(consolidated.cobros_cxc_usd.toFixed(2))
  consolidated.cxc_otorgado_usd = Number(consolidated.cxc_otorgado_usd.toFixed(2))
  consolidated.cod_otorgado_usd = Number(consolidated.cod_otorgado_usd.toFixed(2))
  consolidated.creditos_pendientes_usd = Number(consolidated.creditos_pendientes_usd.toFixed(2))
  consolidated.total_ingresos_usd = Number(consolidated.total_ingresos_usd.toFixed(2))
  for (const k of Object.keys(consolidated.desglose_pagos)) {
    consolidated.desglose_pagos[k] = Number(consolidated.desglose_pagos[k].toFixed(2))
  }

  // 2. Verificar existencia previa
  let tienePrevio = false
  for (const { fecha } of consolidated.dias) {
    const existing = await readExistingByKey(env, context.operador.cuenta_id, `pos-vta-efectivo-usd-${fecha}`)
    if (existing.row) tienePrevio = true
  }

  if (!confirm) {
    return json({
      ok: true,
      preview: true,
      desde,
      hasta,
      posData: consolidated,
      tienePrevio,
    }, 200, request)
  }

  // 3. Registrar o actualizar movimientos para cada día
  const distribucion = body.distribucion && typeof body.distribucion === 'object' ? body.distribucion : null

  // Guardarraíles de validación estricta (Zero-Tolerance Mismatch & Compatibilidad de Moneda)
  if (confirm && distribucion) {
    const mathCheck = validarDistribucionMatematica(distribucion, consolidated.desglose_pagos, consolidated.despachos_detalle)
    if (!mathCheck.ok) {
      return jsonError(mathCheck.error, 400, request)
    }

    let cuentasCustodia = Array.isArray(body.cuentasCustodia) ? body.cuentasCustodia : null
    if (!cuentasCustodia) {
      try {
        const cuentasRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/cuentas_custodia?${accountFilter(context.operador.cuenta_id)}&activo=eq.true&select=id,nombre,moneda`,
          { headers: serviceHeaders(env, 'return=minimal') }
        )
        if (cuentasRes && cuentasRes.ok) {
          cuentasCustodia = await cuentasRes.json().catch(() => [])
        }
      } catch {
        cuentasCustodia = []
      }
    }

    if (cuentasCustodia && cuentasCustodia.length > 0) {
      const monedaCheck = validarCompatibilidadMonedas(distribucion, cuentasCustodia)
      if (!monedaCheck.ok) {
        return jsonError(monedaCheck.error, 400, request)
      }
    }
  }

  const resultados = []

  for (const { fecha, posData } of consolidated.dias) {
    const desglose = posData.desglose_pagos || {}
    const tasaBcv = Number(posData.tasa_bcv || consolidated.tasa_bcv || 1) || 1

    const METODOS_DEF = [
      ['efectivo_usd', 'Efectivo $', 'USD', 'USD', tasaBcv, 'BCV', 'pos-vta-efectivo-usd'],
      ['zelle_usd', 'Zelle', 'USD', 'USD', tasaBcv, 'BCV', 'pos-vta-zelle-usd'],
      ['usdt_usd', 'USDT', 'USD', 'USDT', tasaBcv, 'USDT', 'pos-vta-usdt-usd'],
      ['efectivo_ves', 'Efectivo Bs', 'VES', 'VES', 1, 'BCV', 'pos-vta-efectivo-ves'],
      ['transferencia_ves', 'Transferencia', 'VES', 'VES', 1, 'BCV', 'pos-vta-transferencia-ves'],
      ['pago_movil_ves', 'Pago Móvil', 'VES', 'VES', 1, 'BCV', 'pos-vta-pagomovil-ves'],
      ['punto_venta_ves', 'Punto de Venta', 'VES', 'VES', 1, 'BCV', 'pos-vta-puntoventa-ves'],
      ['otros_usd', 'Otros $', 'USD', 'USD', tasaBcv, 'BCV', 'pos-vta-otros-usd'],
    ]

    const entries = METODOS_DEF.map(([clave, subcuenta, cartera, moneda, tasa_ves, fuente_tasa, prefix]) => ({
      clave, subcuenta, cartera, moneda, tasa_ves, fuente_tasa,
      tasa_usd_ves: tasaBcv,
      monto: Number(desglose[clave] || 0),
      concepto: `Ventas POS en ${subcuenta} - ${fecha}`,
      idempotency_key: `${prefix}-${fecha}`,
    }))

    // Fallback para monto lump-sum si desglose vacío
    const sumaDesglose = entries.reduce((s, e) => s + e.monto, 0)
    const montoVentasTotal = Number(posData.ventas_contado_usd || 0)
    if (sumaDesglose === 0 && montoVentasTotal > 0) {
      entries[0].monto = montoVentasTotal
    }

    for (const entry of entries) {
      if (entry.monto <= 0) continue

      const cfg = distribucion ? distribucion[entry.clave] : null

      // Si el usuario desmarcó este método de pago
      if (cfg && cfg.activo === false) {
        continue
      }

      // Si el método se dividió entre múltiples cuentas bancarias/custodia
      if (cfg && Array.isArray(cfg.partes) && cfg.partes.length > 0) {
        await reconciliarTramosPrevios(env, context.operador.cuenta_id, fecha, entry.clave, serviceHeaders(env), cfg.partes.length)

        let pIdx = 0
        for (const parte of cfg.partes) {
          pIdx += 1
          const parteMonto = round2(parte.monto)
          if (parteMonto <= 0) continue
          const cuentaOrigen = String(parte.cuenta_origen || parte.nombreCuenta || parte.nombre || '').trim() || null
          const conceptoParte = cuentaOrigen
            ? `Ventas POS en ${entry.subcuenta} (${cuentaOrigen}) - ${fecha}`
            : `Ventas POS en ${entry.subcuenta} (Tramo ${pIdx}) - ${fecha}`

          const saveRes = await saveSyncMovement(env, context.operador.cuenta_id, context.operador.id, {
            fecha,
            tipo: 'ingreso',
            categoria: 'Ventas',
            concepto: conceptoParte,
            monto: parteMonto,
            moneda: entry.moneda,
            tasa_ves: entry.tasa_ves,
            tasa_usd_ves: entry.tasa_usd_ves,
            fuente_tasa: entry.fuente_tasa,
            referencia: `${entry.subcuenta} · POS-${fecha}-P${pIdx}`,
            observaciones: `Ingreso automático sincronizado desde POS (${entry.cartera})`,
            idempotency_key: `${entry.idempotency_key}-p${pIdx}`,
            metodo_pago: entry.subcuenta,
            cuenta_origen: cuentaOrigen,
          })

          if (!saveRes.ok) {
            return jsonError(`Error al sincronizar ${entry.subcuenta} tramo ${pIdx} (${fecha}): ${saveRes.error}`, 500, request)
          }

          resultados.push({ fecha, subcuenta: entry.subcuenta, parte: pIdx, accion: saveRes.accion, movimiento: saveRes.movimiento })
        }
        continue
      }

      // Cuenta única o fallback: limpiar tramos previos solo si se revierte desde división
      if (cfg && (cfg.limpiarTramos || (cfg.dividido === false && Array.isArray(cfg.partes)))) {
        await reconciliarTramosPrevios(env, context.operador.cuenta_id, fecha, entry.clave, serviceHeaders(env), 0)
      }

      const cuentaOrigen = cfg ? (String(cfg.cuenta_origen || cfg.nombreCuenta || cfg.nombre || '').trim() || null) : null
      let montoFinal = entry.monto
      if (cfg && Array.isArray(cfg.excluidos) && cfg.excluidos.length > 0) {
        const campoMonto = entry.moneda === 'VES' ? 'monto_ves' : 'monto_usd'
        const sumaExcluidos = (posData.despachos_detalle || [])
          .filter(d => d.metodo_clave === entry.clave && cfg.excluidos.includes(d.id))
          .reduce((s, d) => s + Number(d[campoMonto] || 0), 0)
        montoFinal = round2(Math.max(0, montoFinal - sumaExcluidos))
      } else if (cfg && cfg.monto != null) {
        montoFinal = round2(cfg.monto)
      }
      if (montoFinal <= 0) continue

      const conceptoFinal = cuentaOrigen
        ? `Ventas POS en ${entry.subcuenta} (${cuentaOrigen}) - ${fecha}`
        : entry.concepto

      const saveRes = await saveSyncMovement(env, context.operador.cuenta_id, context.operador.id, {
        fecha,
        tipo: 'ingreso',
        categoria: 'Ventas',
        concepto: conceptoFinal,
        monto: montoFinal,
        moneda: entry.moneda,
        tasa_ves: entry.tasa_ves,
        tasa_usd_ves: entry.tasa_usd_ves,
        fuente_tasa: entry.fuente_tasa,
        referencia: `${entry.subcuenta} · POS-${fecha}`,
        observaciones: `Ingreso automático sincronizado desde POS (${entry.cartera})`,
        idempotency_key: entry.idempotency_key,
        metodo_pago: entry.subcuenta,
        cuenta_origen: cuentaOrigen,
      })

      if (!saveRes.ok) {
        return jsonError(`Error al sincronizar ${entry.subcuenta} (${fecha}): ${saveRes.error}`, 500, request)
      }

      resultados.push({ fecha, subcuenta: entry.subcuenta, accion: saveRes.accion, movimiento: saveRes.movimiento })
    }

    // Cobros CxC adicionales
    const montoCxc = Number(posData.cobros_cxc_usd || 0)
    const cfgCxc = distribucion ? (distribucion.cxc || distribucion.cobros_cxc) : null
    const cxcActivo = cfgCxc ? cfgCxc.activo !== false : true

    if (montoCxc > 0 && cxcActivo) {
      const cuentaCxc = cfgCxc ? (String(cfgCxc.cuenta_origen || cfgCxc.nombreCuenta || '').trim() || null) : null
      const keyCxc = `pos-cxc-${fecha}`
      const saveCxc = await saveSyncMovement(env, context.operador.cuenta_id, context.operador.id, {
        fecha,
        tipo: 'ingreso',
        categoria: 'Cobros de clientes',
        concepto: cuentaCxc
          ? `Cobros CxC (${cuentaCxc}) - ${fecha}`
          : `Cobros CxC (Abonos de Clientes) - ${fecha}`,
        monto: montoCxc,
        moneda: 'USD',
        tasa_ves: tasaBcv,
        tasa_usd_ves: tasaBcv,
        fuente_tasa: 'BCV',
        referencia: `Transferencia · POS-CXC-${fecha}`,
        observaciones: `Abonos de clientes registrados en POS fecha ${fecha}`,
        idempotency_key: keyCxc,
        metodo_pago: 'Transferencia',
        cuenta_origen: cuentaCxc,
      })

      if (!saveCxc.ok) {
        return jsonError(`Error al sincronizar Cobros CxC (${fecha}): ${saveCxc.error}`, 500, request)
      }

      resultados.push({ fecha, subcuenta: 'Transferencia', accion: saveCxc.accion, movimiento: saveCxc.movimiento })
    }
  }

  // 4. Calcular total real sincronizado y Auditoría
  let totalSincronizadoUsd = 0
  for (const r of resultados) {
    const m = r.movimiento
    if (!m) continue
    const mUsd = m.moneda === 'VES'
      ? ((Number(m.monto_ves) || Number(m.monto) || 0) / (Number(m.tasa_ves) || Number(consolidated.tasa_bcv) || 1))
      : (Number(m.monto) || 0)
    totalSincronizadoUsd += mUsd
  }
  totalSincronizadoUsd = round2(totalSincronizadoUsd)

  const despachosExcluidos = []
  if (distribucion) {
    for (const cfg of Object.values(distribucion)) {
      if (Array.isArray(cfg?.excluidos)) {
        despachosExcluidos.push(...cfg.excluidos)
      }
    }
  }

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'SYNC_POS_EJECUTADA',
    entidadTipo: 'finanzas_movimientos',
    entidadId: null,
    meta: {
      desde,
      hasta,
      total_ingresos_usd: totalSincronizadoUsd || consolidated.total_ingresos_usd,
      operaciones: resultados.length,
      ...(despachosExcluidos.length > 0 ? { despachos_excluidos: despachosExcluidos } : {}),
    },
    ip: context.ip,
  }).catch(() => {})

  return json({
    ok: true,
    synced: true,
    desde,
    hasta,
    total_ingresos_usd: totalSincronizadoUsd || consolidated.total_ingresos_usd,
    resultados,
    posData: consolidated,
  }, 200, request)
}
