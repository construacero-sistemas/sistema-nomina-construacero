import { authFetch } from '../../../compat/services/authFetch.js'
import { historicalUsd, historicalVes } from '../../utils/financialValuation.js'
export { historicalUsd, historicalVes } from '../../utils/financialValuation.js'

// One ledger version across all pages; never export a partial mixed snapshot.
export async function loadFinanceExport(filters, { signal, onProgress, fetchPage } = {}) {
  const read = fetchPage || (async params => {
    const response = await authFetch(`/api/finanzas/movimientos?${params}`, { signal, timeout: 30000 })
    const data = await response.json()
    if (!response.ok) throw new Error(response.status === 409
      ? 'El libro cambi\u00f3 durante la preparaci\u00f3n. Vuelve a generar el reporte.'
      : data.error || 'No se pudo preparar el reporte completo.')
    return data
  })
  const rows = [], ids = new Set()
  let offset = 0, version = null, total = null, corte = null
  do {
    signal?.throwIfAborted()
    const params = new URLSearchParams({ desde: filters.desde, hasta: filters.hasta, limit: '100', offset: String(offset) })
    for (const key of ['tipo', 'categoria', 'moneda', 'cartera']) if (filters[key]) params.set(key, filters[key])
    if (filters.mostrarAnulados) params.set('mostrarAnulados', 'true')
    if (version !== null) params.set('versionLibro', version)
    const page = await read(params)
    signal?.throwIfAborted()
    if (!Array.isArray(page.movimientos) || page.versionLibro == null || !Number.isInteger(page.paginacion?.total) || page.paginacion.total < 0) throw new Error('El servicio no confirm\u00f3 la integridad del reporte.')
    if (version !== null && (String(page.versionLibro) !== version || page.paginacion.total !== total)) throw new Error('El libro cambi\u00f3. Vuelve a generar el reporte.')
    version = String(page.versionLibro); total = page.paginacion.total; corte ||= page.corte
    if (total > 100000) throw new Error('El reporte supera 100.000 registros. Reduce el rango; no se entrega un reporte parcial.')
    for (const row of page.movimientos) {
      if (!row.id || ids.has(row.id)) throw new Error('Se detect\u00f3 una p\u00e1gina duplicada. Actualiza el reporte.')
      ids.add(row.id); rows.push(row)
    }
    onProgress?.({ loaded: rows.length, total })
    const next = page.paginacion.siguiente
    if (next == null) break
    if (!Number.isInteger(next) || next !== offset + page.movimientos.length || next <= offset || next >= total) throw new Error('La paginaci\u00f3n del reporte no pudo verificarse.')
    offset = next
  } while (offset <= 100000)
  if (rows.length !== total) throw new Error('No se recibieron todos los registros. No se genera un reporte parcial.')
  return { rows, version, corte, summary: summarizeExport(rows) }
}
export function summarizeExport(rows) {
  const summary = { ingresos_usd: 0, egresos_usd: 0, balance_usd: 0, balance_ves: 0, movimientos_sin_usd: 0, movimientos_sin_ves: 0 }
  for (const row of rows) {
    if (row.estado === 'anulado' || row.origen_operacion === 'traspaso') continue
    const usd = historicalUsd(row), ves = historicalVes(row)
    const sign = row.tipo === 'ingreso' ? 1 : -1
    if (usd == null) summary.movimientos_sin_usd++
    else summary[row.tipo === 'ingreso' ? 'ingresos_usd' : 'egresos_usd'] += usd
    if (ves == null) summary.movimientos_sin_ves++
    else summary.balance_ves += sign * ves
  }
  summary.balance_usd = summary.ingresos_usd - summary.egresos_usd
  return summary
}
