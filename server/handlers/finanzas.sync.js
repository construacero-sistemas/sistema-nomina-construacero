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
  'motivo_anulacion', 'metodo_pago', 'cuenta_origen', 'tasa_usd_ves', 'tasa_registrada_en',
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
  const rows = await response.json().catch(() => null)
  if (!Array.isArray(rows)) return { error: true, row: null }
  return { error: false, row: rows[0] || null }
}

async function saveSyncMovement(env, cuentaId, operadorId, movementData) {
  const existing = await readExistingByKey(env, cuentaId, movementData.idempotency_key)
  if (existing.error) return { ok: false, error: 'No se pudo comprobar la operación previa. No se escribió otro movimiento.' }
  if (existing.row && (existing.row.estado !== 'activo' || existing.row.moneda !== movementData.moneda)) {
    return { ok: false, error: 'El movimiento previo requiere conciliación. No se cambió su estado ni moneda.' }
  }
  const fields = {
    monto: movementData.monto, tasa_ves: movementData.tasa_ves, tasa_usd_ves: movementData.tasa_usd_ves,
    concepto: movementData.concepto, referencia: movementData.referencia,
    observaciones: movementData.observaciones, fuente_tasa: movementData.fuente_tasa,
    ...(movementData.metodo_pago ? { metodo_pago: movementData.metodo_pago } : {}),
    ...(movementData.cuenta_origen ? { cuenta_origen: movementData.cuenta_origen } : {}),
  }
  const payload = existing.row ? fields : {
    ...fields, cuenta_id: cuentaId, fecha: movementData.fecha, tipo: movementData.tipo,
    categoria: movementData.categoria, moneda: movementData.moneda,
    idempotency_key: movementData.idempotency_key, creado_por: operadorId,
  }
  const suffix = existing.row ? `?id=eq.${queryValue(existing.row.id)}&${accountFilter(cuentaId)}&estado=eq.activo` : ''
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_movimientos${suffix}`, {
    method: existing.row ? 'PATCH' : 'POST', headers: serviceHeaders(env), body: JSON.stringify(payload),
  })
  // Never degrade an accounting write by removing metadata to bypass a failure.
  if (!response.ok) return { ok: false, error: 'No se confirmó la escritura completa. Conserva las fechas y revisa el estado antes de reintentar.' }
  const rows = await response.json().catch(() => null)
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null
  if (!row || !isValidUuid(row.id) || row.estado !== 'activo' || row.moneda !== movementData.moneda
    || Number(row.monto) !== movementData.monto || Number(row.tasa_ves) !== movementData.tasa_ves
    || Number(row.tasa_usd_ves) !== movementData.tasa_usd_ves
    || (existing.row && row.id !== existing.row.id)) {
    return { ok: false, error: 'La respuesta no confirma el movimiento y sus tasas. No se fabricó un resultado exitoso.' }
  }
  return { ok: true, accion: existing.row ? 'actualizado' : 'creado', movimiento: movementResponse(row) }
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
    tasa_bcv: null,
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

  // Validate every selected day before the first write. A rate from another
  // day (or an invented 1:1 quote) must never become a recorded snapshot.
  for (const { fecha, posData } of consolidated.dias) {
    const desglose = posData.desglose_pagos || {}
    const selected = Object.entries(desglose).some(([key, amount]) => Number(amount) > 0 && distribucion?.[key]?.activo !== false)
    const cxcSelected = Number(posData.cobros_cxc_usd) > 0 && (distribucion?.cxc || distribucion?.cobros_cxc)?.activo !== false
    const fallbackSelected = !Object.values(desglose).some(amount => Number(amount) > 0)
      && Number(posData.ventas_contado_usd) > 0 && distribucion?.efectivo_usd?.activo !== false
    if (!selected && !cxcSelected && !fallbackSelected) continue
    if (Number(desglose.usdt_usd) > 0 && distribucion?.usdt_usd?.activo !== false) {
      return jsonError(`El cierre ${fecha} no distingue unidades USDT de su equivalente USD. Se requiere importe nativo y tasas explícitas antes de importar; no se asumió paridad.`, 422, request)
    }
    const rate = posData.tasa_bcv
    if (!['number', 'string'].includes(typeof rate) || String(rate).trim() === ''
      || !Number.isFinite(Number(rate)) || Number(rate) <= 0 || Number(rate) > 1000000) {
      return jsonError(`Falta una tasa USD/VES válida del cierre ${fecha}. No se inició la escritura de este lote.`, 422, request)
    }
  }
  const resultados = []

  for (const { fecha, posData } of consolidated.dias) {
    const desglose = posData.desglose_pagos || {}
    const tasaBcv = Number(posData.tasa_bcv)

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
  let movimientosSinUsd = 0
  for (const { movimiento: m } of resultados) {
    const rate = Number(m?.tasa_usd_ves)
    const recorded = typeof m?.tasa_registrada_en === 'string' && Number.isFinite(Date.parse(m.tasa_registrada_en))
    const mUsd = m?.moneda === 'USD' && m.monto != null ? Number(m.monto)
      : m?.moneda === 'VES' && m.monto != null && recorded && Number.isFinite(rate) && rate > 0 ? Number(m.monto) / rate : null
    if (mUsd == null || !Number.isFinite(mUsd)) movimientosSinUsd++
    else totalSincronizadoUsd += mUsd
  }
  totalSincronizadoUsd = movimientosSinUsd ? null : round2(totalSincronizadoUsd)

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
      total_ingresos_usd: totalSincronizadoUsd,
      movimientos_sin_usd: movimientosSinUsd,
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
    total_ingresos_usd: totalSincronizadoUsd,
      movimientos_sin_usd: movimientosSinUsd,
    resultados,
    posData: consolidated,
  }, 200, request)
}
