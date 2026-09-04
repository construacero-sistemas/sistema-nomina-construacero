// server/lib/posSyncValidation.js
// Guardarraíles de validación matemática, compatibilidad de monedas e invariantes para sincronización POS

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100
}

const METODOS_MONEDA = {
  efectivo_usd: 'USD',
  zelle_usd: 'USD',
  usdt_usd: 'USDT',
  efectivo_ves: 'VES',
  transferencia_ves: 'VES',
  pago_movil_ves: 'VES',
  punto_venta_ves: 'VES',
  otros_usd: 'USD',
}

/**
 * Valida que la distribución de métodos no contenga montos negativos,
 * NaN, o descuadres matemáticos en métodos divididos.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validarDistribucionMatematica(distribucion, desglose = {}, despachosDetalle = []) {
  if (!distribucion || typeof distribucion !== 'object') return { ok: true }

  for (const [clave, cfg] of Object.entries(distribucion)) {
    if (!cfg || cfg.activo === false) continue

    const montoOriginal = Number(desglose[clave] || 0)

    // Descontar despachos excluidos si los hay
    const excluidos = Array.isArray(cfg.excluidos) ? cfg.excluidos : []
    const monedaMetodo = METODOS_MONEDA[clave] || 'USD'
    const campoMonto = monedaMetodo === 'VES' ? 'monto_ves' : 'monto_usd'
    const despachosMetodo = (despachosDetalle || []).filter(d => d.metodo_clave === clave)
    const sumaExcluidos = despachosMetodo
      .filter(d => excluidos.includes(d.id))
      .reduce((s, d) => s + Number(d[campoMonto] || 0), 0)

    const montoObjetivo = round2(Math.max(0, montoOriginal - sumaExcluidos))

    // Validar partes si está dividido
    if (Array.isArray(cfg.partes) && cfg.partes.length > 0) {
      let sumaPartes = 0
      for (let i = 0; i < cfg.partes.length; i++) {
        const parte = cfg.partes[i]
        const montoParte = Number(parte.monto)
        if (isNaN(montoParte) || montoParte <= 0) {
          return {
            ok: false,
            error: `El tramo ${i + 1} de ${clave} tiene un monto inválido (${parte.monto}). Todos los tramos deben ser mayores a 0.`,
          }
        }
        if (!parte.cuenta_origen || String(parte.cuenta_origen).trim().length === 0) {
          return {
            ok: false,
            error: `El tramo ${i + 1} de ${clave} no tiene una cuenta de custodia asignada.`,
          }
        }
        sumaPartes += montoParte
      }

      sumaPartes = round2(sumaPartes)
      const diferencia = Math.abs(round2(montoObjetivo - sumaPartes))
      if (diferencia > 0.01) {
        return {
          ok: false,
          error: `Descuadre matemático en ${clave}: la suma de los tramos (${sumaPartes}) no coincide con el total a registrar (${montoObjetivo}). Diferencia: ${diferencia}.`,
        }
      }
    }
  }

  return { ok: true }
}

/**
 * Valida que cada cuenta asignada sea compatible con la moneda del método
 * para prevenir mezclas de divisas (anti-poisoning).
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validarCompatibilidadMonedas(distribucion, cuentasCustodia = []) {
  if (!distribucion || typeof distribucion !== 'object' || !Array.isArray(cuentasCustodia) || cuentasCustodia.length === 0) {
    return { ok: true }
  }

  const cuentasMap = new Map()
  for (const c of cuentasCustodia) {
    cuentasMap.set(String(c.nombre || '').toLowerCase(), c)
    cuentasMap.set(String(c.id || '').toLowerCase(), c)
  }

  for (const [clave, cfg] of Object.entries(distribucion)) {
    if (!cfg || cfg.activo === false) continue

    const monedaEsperada = (METODOS_MONEDA[clave] || 'USD').toUpperCase()

    const cuentasAValidar = []
    if (Array.isArray(cfg.partes) && cfg.partes.length > 0) {
      for (const p of cfg.partes) {
        if (p.cuenta_origen) cuentasAValidar.push(p.cuenta_origen)
      }
    } else if (cfg.cuenta_origen) {
      cuentasAValidar.push(cfg.cuenta_origen)
    }

    for (const nomCuenta of cuentasAValidar) {
      const match = cuentasMap.get(String(nomCuenta).toLowerCase())
      if (match) {
        const monedaCuenta = String(match.moneda || '').toUpperCase()
        if (monedaEsperada === 'VES' && monedaCuenta !== 'VES') {
          return {
            ok: false,
            error: `Incompatibilidad de moneda: El método ${clave} (${monedaEsperada}) no se puede asignar a la cuenta "${match.nombre}" (${monedaCuenta}).`,
          }
        }
        if (monedaEsperada === 'USD' && monedaCuenta === 'VES') {
          return {
            ok: false,
            error: `Incompatibilidad de moneda: El método ${clave} (${monedaEsperada}) no se puede asignar a la cuenta en bolívares "${match.nombre}".`,
          }
        }
      }
    }
  }

  return { ok: true }
}

/**
 * Anula tramos huérfanos generados en sincronizaciones previas si ahora se usan menos partes o cuenta única.
 */
export async function reconciliarTramosPrevios(env, cuentaId, fecha, claveMetodo, serviceHeaders, nuevasPartesCount = 0) {
  try {
    const metodoMapeo = {
      efectivo_usd: 'efectivo-usd',
      zelle_usd: 'zelle-usd',
      usdt_usd: 'usdt-usd',
      efectivo_ves: 'efectivo-ves',
      transferencia_ves: 'transferencia-ves',
      pago_movil_ves: 'pagomovil-ves',
      punto_venta_ves: 'puntoventa-ves',
    }
    const subClave = metodoMapeo[claveMetodo] || claveMetodo.replace(/_/g, '-')
    const prefix = `pos-vta-${subClave}`

    const promesas = []

    // Si ahora se divide en partes (> 0), anular el movimiento único base si existía
    if (nuevasPartesCount > 0) {
      const baseKey = `${prefix}-${fecha}`
      const basePatchUrl = `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?cuenta_id=eq.${encodeURIComponent(cuentaId)}&idempotency_key=eq.${encodeURIComponent(baseKey)}&estado=eq.activo`
      promesas.push(
        fetch(basePatchUrl, {
          method: 'PATCH',
          headers: serviceHeaders,
          body: JSON.stringify({
            estado: 'anulado',
            motivo_anulacion: `Movimiento único dividido en ${nuevasPartesCount} tramos al resincronizar POS (${fecha})`,
            anulado_en: new Date().toISOString(),
          }),
        }).catch(() => {})
      )
    }

    // Anular posibles tramos desde nuevasPartesCount + 1 hasta 10
    for (let idx = nuevasPartesCount + 1; idx <= 10; idx++) {
      const key = `${prefix}-${fecha}-p${idx}`
      const url = `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?cuenta_id=eq.${encodeURIComponent(cuentaId)}&idempotency_key=eq.${encodeURIComponent(key)}&estado=eq.activo`
      promesas.push(
        fetch(url, {
          method: 'PATCH',
          headers: serviceHeaders,
          body: JSON.stringify({
            estado: 'anulado',
            motivo_anulacion: `Tramo huérfano reemplazado por resincronización POS (${fecha})`,
            anulado_en: new Date().toISOString(),
          }),
        }).catch(() => {})
      )
    }
    await Promise.all(promesas)
  } catch {
    // Silencioso en caso de fallback
  }
}
