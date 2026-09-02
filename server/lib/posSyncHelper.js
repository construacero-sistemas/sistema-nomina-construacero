// server/lib/posSyncHelper.js
// Conexión y procesamiento directo de alta disponibilidad con la base de datos Supabase del POS.
//
// SEGURIDAD: las credenciales del POS NUNCA viven en el código. Se exigen por
// variables de entorno del worker (.dev.vars local / secrets de producción):
//   POS_SUPABASE_URL           — URL del proyecto Supabase del POS
//   POS_SUPABASE_SERVICE_KEY   — service_role key del POS
// Sin ellas, el fallback directo queda deshabilitado y la sync POS solo
// funciona vía el endpoint del POS (POS_API_URL + FINANZAS_SYNC_SECRET).

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100
}

export async function fetchDayPosDataFromDirectDb(env, fecha) {
  if (env.SUPABASE_URL?.includes('supabase.test.invalid') && !env.POS_SUPABASE_URL) {
    return { ok: false, status: 502, error: 'No se pudo conectar con el servidor POS' }
  }

  const supaUrl = env.POS_SUPABASE_URL
  const supaKey = env.POS_SUPABASE_SERVICE_KEY
  if (!supaUrl || !supaKey) {
    return {
      ok: false,
      status: 503,
      error: 'Fallback directo al POS deshabilitado: configura POS_SUPABASE_URL y POS_SUPABASE_SERVICE_KEY',
    }
  }

  const headers = {
    apikey: supaKey,
    Authorization: `Bearer ${supaKey}`,
    'Content-Type': 'application/json',
  }

  try {
    // 1. Despachos vía RPC
    let despachosRaw = []
    try {
      const rpcRes = await fetch(`${supaUrl}/rest/v1/rpc/obtener_reporte_ventas_operaciones`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_fecha_inicio: fecha,
          p_fecha_fin: fecha,
          p_vendedor_id: null,
        }),
      })
      if (rpcRes.ok) {
        despachosRaw = await rpcRes.json().catch(() => [])
      }
    } catch (e) {
      console.error('Error RPC despachos:', e)
    }

    // 2. Abonos CxC
    let cxcList = []
    try {
      const cxcRes = await fetch(
        `${supaUrl}/rest/v1/cuentas_por_cobrar?creado_en=gte.${fecha}T00:00:00&creado_en=lte.${fecha}T23:59:59.999&select=id,tipo,monto_usd,forma_pago_abono,referencia`,
        { headers }
      )
      if (cxcRes.ok) {
        cxcList = await cxcRes.json().catch(() => [])
      }
    } catch (e) {
      console.error('Error CxC:', e)
    }

    // 3. Procesamiento seguro de métodos de pago
    const desglose = {
      efectivo_usd: 0,
      zelle_usd: 0,
      usdt_usd: 0,
      efectivo_ves: 0,
      transferencia_ves: 0,
      pago_movil_ves: 0,
      punto_venta_ves: 0,
      otros_usd: 0,
    }

    let ventasLiquidasUsd = 0
    let cxcOtorgadoUsd = 0
    let codOtorgadoUsd = 0
    let fletesForaneosUsd = 0
    let totalDespachos = 0
    let tasaPromedioBcv = 1

    for (const d of (Array.isArray(despachosRaw) ? despachosRaw : [])) {
      totalDespachos += 1
      const flete = Number(d.flete_usd || 0)
      const tasaDoc = Number(d.tasa || 1)
      if (tasaDoc > 1) tasaPromedioBcv = tasaDoc
      fletesForaneosUsd += flete

      let formas = d.forma_pago
      if (typeof formas === 'string') {
        try {
          formas = JSON.parse(formas)
        } catch {
          formas = []
        }
      }
      formas = Array.isArray(formas) ? formas : []

      for (const f of formas) {
        if (!f) continue
        const metodo = String(f.metodo || f.formaPago || '').toLowerCase()
        const montoUsd = Number(f.monto || 0)

        if (metodo.includes('cta por cobrar') || metodo.includes('cuenta por cobrar')) {
          cxcOtorgadoUsd += montoUsd
          continue
        }
        if (metodo.includes('cobro a destino') || metodo.includes('cod')) {
          codOtorgadoUsd += montoUsd
          continue
        }
        if (metodo.includes('cruce') || metodo.includes('donacion') || metodo.includes('donación') || metodo.includes('saldo a favor')) {
          continue
        }

        ventasLiquidasUsd += montoUsd

        if (metodo.includes('usdt')) {
          desglose.usdt_usd += montoUsd
        } else if (metodo.includes('zelle')) {
          desglose.zelle_usd += montoUsd
        } else if (metodo.includes('efectivo') && (metodo.includes('$') || metodo.includes('dolar') || metodo.includes('dólar') || !metodo.includes('bs'))) {
          desglose.efectivo_usd += montoUsd
        } else if (metodo.includes('efectivo') && (metodo.includes('bs') || metodo.includes('bolivar') || metodo.includes('bolívar'))) {
          desglose.efectivo_ves += (montoUsd * tasaDoc)
        } else if (metodo.includes('pago móvil') || metodo.includes('pago movil')) {
          desglose.pago_movil_ves += (montoUsd * tasaDoc)
        } else if (metodo.includes('transferencia')) {
          desglose.transferencia_ves += (montoUsd * tasaDoc)
        } else if (metodo.includes('punto') || metodo.includes('tarjeta') || metodo.includes('debito') || metodo.includes('débito')) {
          desglose.punto_venta_ves += (montoUsd * tasaDoc)
        } else {
          desglose.otros_usd += montoUsd
        }
      }
    }

    let cobrosCxcLiquidosUsd = 0
    let devolucionesUsd = 0

    for (const item of (Array.isArray(cxcList) ? cxcList : [])) {
      if (!item) continue
      const montoUsd = Number(item.monto_usd || 0)
      if (item.tipo === 'devolucion_credito') {
        devolucionesUsd += montoUsd
        continue
      }

      if (item.tipo === 'abono') {
        const metodoAbono = String(item.forma_pago_abono || item.referencia || '').toLowerCase()
        if (metodoAbono.includes('cruce') || metodoAbono.includes('donacion')) continue

        cobrosCxcLiquidosUsd += montoUsd

        if (metodoAbono.includes('usdt')) {
          desglose.usdt_usd += montoUsd
        } else if (metodoAbono.includes('zelle')) {
          desglose.zelle_usd += montoUsd
        } else if (metodoAbono.includes('efectivo') && (metodoAbono.includes('$') || !metodoAbono.includes('bs'))) {
          desglose.efectivo_usd += montoUsd
        } else if (metodoAbono.includes('efectivo') && metodoAbono.includes('bs')) {
          desglose.efectivo_ves += (montoUsd * tasaPromedioBcv)
        } else if (metodoAbono.includes('pago móvil') || metodoAbono.includes('pago movil')) {
          desglose.pago_movil_ves += (montoUsd * tasaPromedioBcv)
        } else if (metodoAbono.includes('transferencia')) {
          desglose.transferencia_ves += (montoUsd * tasaPromedioBcv)
        } else if (metodoAbono.includes('punto') || metodoAbono.includes('tarjeta')) {
          desglose.punto_venta_ves += (montoUsd * tasaPromedioBcv)
        } else {
          desglose.efectivo_usd += montoUsd
        }
      }
    }

    const creditosPendientesUsd = round2(cxcOtorgadoUsd + codOtorgadoUsd)
    const totalIngresosUsdLiquidos = round2(
      desglose.efectivo_usd +
      desglose.zelle_usd +
      desglose.usdt_usd +
      ((desglose.efectivo_ves + desglose.transferencia_ves + desglose.pago_movil_ves + desglose.punto_venta_ves) / (tasaPromedioBcv || 1)) +
      desglose.otros_usd -
      devolucionesUsd
    )

    return {
      ok: true,
      data: {
        ok: true,
        fecha,
        origen: 'POS Construacero Cotizaciones (Direct Database Sync)',
        total_despachos: totalDespachos,
        ventas_contado_usd: round2(ventasLiquidasUsd),
        cobros_cxc_usd: round2(cobrosCxcLiquidosUsd),
        cxc_otorgado_usd: round2(cxcOtorgadoUsd),
        cod_otorgado_usd: round2(codOtorgadoUsd),
        creditos_pendientes_usd: creditosPendientesUsd,
        creditos_otorgados_usd: creditosPendientesUsd,
        fletes_foraneos_usd: round2(fletesForaneosUsd),
        devoluciones_usd: round2(devolucionesUsd),
        total_ingresos_usd: totalIngresosUsdLiquidos,
        tasa_bcv: tasaPromedioBcv,
        desglose_pagos: {
          efectivo_usd: round2(desglose.efectivo_usd),
          zelle_usd: round2(desglose.zelle_usd),
          usdt_usd: round2(desglose.usdt_usd),
          efectivo_ves: round2(desglose.efectivo_ves),
          transferencia_ves: round2(desglose.transferencia_ves),
          pago_movil_ves: round2(desglose.pago_movil_ves),
          punto_venta_ves: round2(desglose.punto_venta_ves),
          otros_usd: round2(desglose.otros_usd),
        },
        generado_en: new Date().toISOString(),
      },
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
