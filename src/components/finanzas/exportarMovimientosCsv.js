// src/components/finanzas/exportarMovimientosCsv.js
// Exportación CSV de movimientos financieros filtrados. Extraída de
// FinanzasView para mantener el componente dentro del guardrail de líneas.
import { clasificarMovimientoEnCartera } from '../../utils/carterasHelper.js'

function getLocalIsoDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function exportarCsv(rows) {
  if (!rows.length || typeof window === 'undefined') return
  const headers = [
    'Fecha',
    'Tipo',
    'Categoría',
    'Cartera',
    'Subcuenta / Método',
    'Concepto',
    'Monto',
    'Moneda',
    'Tasa de Cambio (Bs/$)',
    'Monto en Bs',
    'Referencia',
    'Estado',
    'Observaciones',
  ]

  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`

  const rowsData = rows.map(row => {
    const { carteraId, subcuentaNombre } = clasificarMovimientoEnCartera(row)
    const monto = Number(row.monto) || 0
    const tasa = Number(row.tasa_usd_ves || row.tasa_ves || 1)
    const montoVes = row.moneda === 'VES'
      ? (Number(row.monto_ves) || monto)
      : (Number(row.monto_ves) || (monto * tasa))

    return [
      row.fecha || '',
      row.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
      row.categoria || 'Sin categoría',
      carteraId === 'USD' ? 'Cartera Dólares (USD)' : 'Cartera Bolívares (VES)',
      subcuentaNombre || '',
      row.concepto || '',
      monto.toFixed(2),
      row.moneda || 'USD',
      tasa > 1 ? tasa.toFixed(2) : '1.00',
      montoVes.toFixed(2),
      row.referencia || '',
      row.estado === 'anulado' ? 'Anulado' : 'Activo',
      row.observaciones || '',
    ]
  })

  const csv = [headers, ...rowsData]
    .map(row => row.map(escape).join(';'))
    .join('\n')

  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `finanzas-construacero-${getLocalIsoDate()}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
