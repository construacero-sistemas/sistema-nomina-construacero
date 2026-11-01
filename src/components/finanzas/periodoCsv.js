// src/components/finanzas/periodoCsv.js
// CSV de auditoría de un período mensual (botón CSV del panel de control mensual).
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`

const HEADERS = ['Mes', 'Nombre de cuenta', 'Cuenta ID', 'Moneda', 'Método de apertura', 'Saldo inicial', 'Saldo inicial USD', 'Saldo nativo calculado', 'Saldo contado', 'Diferencia', 'Motivo diferencia', 'Tasa USD/VES apertura', 'Tasa USDT/VES apertura', 'Saldo cierre real', 'Saldo cierre USD', 'Diferencia cierre', 'Motivo cierre', 'Origen saldo']

function guardarCsv(filas, nombre) {
  const blob = new Blob([`\ufeff${filas.map(fila => fila.map(csvCell).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = nombre; link.click()
  URL.revokeObjectURL(url)
}

export function descargarPeriodoCsv(periodo) {
  const rows = (periodo?.cuentas || []).map(row => [periodo.mes, row.nombre, row.cuentaCustodiaId, row.moneda, row.metodoApertura,
    row.saldoApertura, row.saldoAperturaUsd, row.saldoCalculado, row.saldoContadoApertura, row.diferenciaApertura,
    row.motivoApertura, row.tasaUsdVes, row.tasaUsdtVes, row.saldoCierreReal, row.saldoCierreUsd,
    row.diferenciaCierre, row.motivoCierre, row.origenSaldo])
  guardarCsv([HEADERS, ...rows], `finanzas-apertura-${periodo.mes}.csv`)
}
