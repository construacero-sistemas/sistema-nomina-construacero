import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileText, LockKeyhole, RefreshCw } from 'lucide-react'
import { formatNumber, normalizarMontoInput } from './formatos.js'
import { conteoValido } from '../../utils/montoUtils.js'
import PeriodoMensualWizardModal from './PeriodoMensualWizardModal.jsx'
import { generarPeriodoMensualPDF } from '../../services/pdf/periodoMensualPDF.js'

const tasa = value => Number(value) > 0 ? Number(value) : 0
const money = value => value == null ? '—' : formatNumber(value)
const walletKey = row => row.cuentaCustodiaId
const key = () => crypto.randomUUID()
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`
const csvFile = (rows, name) => {
  const blob = new Blob([`\ufeff${rows.map(row => row.map(csvCell).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  URL.revokeObjectURL(url)
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const formatPeriodoMes = (mesIso) => {
  if (!mesIso || typeof mesIso !== 'string') return '—'
  const parts = mesIso.split('-')
  if (parts.length >= 2) {
    const monthIdx = Number(parts[1]) - 1
    const year = parts[0]
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${MESES[monthIdx]} ${year}`
    }
  }
  return mesIso
}

const renderMonedaBadge = (moneda) => {
  switch (moneda) {
    case 'USD':
      return <span className="inline-block px-2 py-0.5 rounded text-xs font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">USD</span>
    case 'USDT':
      return <span className="inline-block px-2 py-0.5 rounded text-xs font-mono font-bold bg-teal-50 text-teal-800 border border-teal-200">USDT</span>
    case 'VES':
    default:
      return <span className="inline-block px-2 py-0.5 rounded text-xs font-mono font-bold bg-sky-50 text-sky-800 border border-sky-200">{moneda || 'VES'}</span>
  }
}

const renderEstadoBadge = (estado) => {
  switch (estado) {
    case 'sin_apertura':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          Sin apertura
        </span>
      )
    case 'abierto':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-900 border border-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Período abierto
        </span>
      )
    case 'cerrado':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
          <LockKeyhole size={11} className="text-slate-500" />
          Cerrado
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
          {estado || 'Consultando'}
        </span>
      )
  }
}

export default function PeriodoMensualFinanzas({ periodo, saldos, cuentas, loading, error, pending, rates, onRefresh, onOpen, onClose, onConfirmClose, cierrePendiente }) {
  const cierreHabilitado = cierrePendiente ?? true
  const [wizardOpen, setWizardOpen] = useState(false)
  const [closing, setClosing] = useState({})
  const [message, setMessage] = useState('')
  const cierreKeyRef = useRef(null)
  const wallets = periodo?.cuentas || []
  const missing = periodo?.cuentasPendientes || []
  const canUseRates = tasa(rates.usd) > 0 && tasa(rates.usdt) > 0
  const activeWallets = useMemo(() => (cuentas || []).filter(item => item.activo), [cuentas])

  const openWizard = () => {
    setMessage('')
    setWizardOpen(true)
  }
  const setClosingValue = (id, field, value) => setClosing(current => ({ ...current, [id]: { ...current[id], [field]: value } }))

  async function confirmClosing() {
    // El conteo prellenado (saldoCalculado) cuenta como saldo contado aunque el
    // usuario no haya tocado el campo; un campo VACÍO o inválido NO es cero.
    const contadoDe = wallet => {
      const entry = closing[walletKey(wallet)] || {}
      if (entry.saldoReal == null) return wallet.saldoCalculado == null ? NaN : Number(wallet.saldoCalculado)
      return conteoValido(entry.saldoReal) ? Number(entry.saldoReal) : NaN
    }
    const rows = wallets.map(wallet => ({
      cuentaCustodiaId: walletKey(wallet), saldoReal: contadoDe(wallet), motivo: closing[walletKey(wallet)]?.motivo || null,
      tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt),
    }))
    if (rows.some(row => !Number.isFinite(row.saldoReal) || row.saldoReal < 0)) { setMessage('Registra el saldo contado de cada cuenta abierta; un campo vacío no es cero.'); return }
    // Regla dura del servidor, anticipada: el cierre nunca reduce los fondos
    // confirmados del libro, haya motivo o no.
    if (wallets.some(wallet => contadoDe(wallet) < Number(wallet.saldoCalculado || 0) - 0.000001)) {
      setMessage('El saldo contado no puede quedar por debajo del saldo del libro; el servidor protege los fondos confirmados.'); return
    }
    if (wallets.some(wallet => Math.abs(contadoDe(wallet) - Number(wallet.saldoCalculado || 0)) > 0.000001
      && String(closing[walletKey(wallet)]?.motivo || '').trim().length < 8)) {
      setMessage('Justifica con al menos 8 caracteres cada diferencia contra el saldo calculado.'); return
    }
    const handleClose = onConfirmClose || onClose
    if (!handleClose) return
    if (!cierreKeyRef.current) cierreKeyRef.current = key()
    try {
      await handleClose({ accion: 'cerrar', mesInicio: periodo.mes, idempotencyKey: cierreKeyRef.current, payload: { cuentas: rows, tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt) } })
      cierreKeyRef.current = null
      setMessage('Cierre mensual confirmado. El libro queda de solo lectura para ese mes.')
      await onRefresh()
    } catch (cause) { setMessage(cause.message || 'No se confirmó el cierre; conserva los datos y reintenta.') }
  }

  const [generatingPdf, setGeneratingPdf] = useState(false)

  async function downloadPeriodPdf() {
    setGeneratingPdf(true)
    try {
      await generarPeriodoMensualPDF({
        periodo,
        rates,
        action: 'download',
      })
    } catch (err) {
      console.error('Error generando PDF de tesorería:', err)
      setMessage('No se pudo generar el reporte PDF de tesorería.')
    } finally {
      setGeneratingPdf(false)
    }
  }

  function downloadPeriod() {
    const headers = ['Mes','Nombre de cuenta','Cuenta ID','Moneda','Método de apertura','Saldo inicial','Saldo inicial USD','Saldo nativo calculado','Saldo contado','Diferencia','Motivo diferencia','Tasa USD/VES apertura','Tasa USDT/VES apertura','Saldo cierre real','Saldo cierre USD','Diferencia cierre','Motivo cierre','Origen saldo']
    const rows = wallets.map(row => [periodo.mes, row.nombre, row.cuentaCustodiaId, row.moneda, row.metodoApertura,
      row.saldoApertura, row.saldoAperturaUsd, row.saldoCalculado, row.saldoContadoApertura, row.diferenciaApertura,
      row.motivoApertura, row.tasaUsdVes, row.tasaUsdtVes, row.saldoCierreReal, row.saldoCierreUsd,
      row.diferenciaCierre, row.motivoCierre, row.origenSaldo])
    csvFile([headers, ...rows], `finanzas-apertura-${periodo.mes}.csv`)
  }

  return (
    <section aria-label="Control mensual de tesorería" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-base font-black text-slate-900 tracking-tight">Apertura y cierre mensual</h2>
            {renderEstadoBadge(periodo?.estado)}
          </div>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            {formatPeriodoMes(periodo?.mes)} <span className="text-slate-400">({periodo?.mes || '—'})</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="min-h-11 px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm shadow-xs transition-colors flex items-center gap-1.5"
          >
            <RefreshCw size={15} className={`text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          {periodo?.estado === 'sin_apertura' && (
            <button
              type="button"
              onClick={openWizard}
              disabled={pending || loading || !canUseRates || activeWallets.length === 0}
              className="min-h-11 px-4 rounded-xl bg-primary hover:bg-primary-hover active:bg-primary-dark text-white font-bold text-sm shadow-sm disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              Iniciar apertura guiada
            </button>
          )}
          {periodo?.estado === 'abierto' && cierreHabilitado && (
            <button
              type="button"
              onClick={confirmClosing}
              disabled={pending || loading || missing.length > 0 || !wallets.length || !canUseRates}
              className="min-h-11 px-4 rounded-xl bg-amber-700 hover:bg-amber-800 active:bg-amber-900 text-white font-bold text-sm shadow-sm disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              <LockKeyhole size={15} />
              Cerrar mes
            </button>
          )}
          {wallets.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={downloadPeriodPdf}
                disabled={loading || generatingPdf}
                title="Descargar reporte oficial de tesorería en PDF"
                className="min-h-11 px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm shadow-xs transition-colors flex items-center gap-1.5"
              >
                <FileText size={15} className={`text-primary ${generatingPdf ? 'animate-pulse' : ''}`} />
                {generatingPdf ? 'Generando PDF…' : 'Reporte PDF'}
              </button>
              <button
                type="button"
                onClick={downloadPeriod}
                disabled={loading}
                title="Descargar CSV crudo de auditoría"
                className="min-h-11 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 font-bold text-xs shadow-xs transition-colors flex items-center gap-1"
              >
                <Download size={13} />
                CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {!canUseRates && (
        <p role="alert" className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 flex items-center gap-2 font-medium">
          <AlertTriangle size={16} className="shrink-0 text-amber-600" />
          No hay tasas USD/VES y USDT/VES confirmadas; no se puede congelar una valoración USD.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800 font-medium">
          {error}
        </p>
      )}

      {periodo?.estado === 'sin_apertura' && (
        <div role="status" className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 text-sm text-amber-950 shadow-xs">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="shrink-0 text-amber-600 mt-0.5" />
            <span className="leading-relaxed">
              El período {periodo.mes} todavía no está aperturado. Registra o egresa solo después de verificar saldos físicos, revisar actividad previa y confirmar la tasa USD congelada.
            </span>
          </div>
          <button
            type="button"
            onClick={openWizard}
            disabled={pending || loading || !canUseRates || activeWallets.length === 0}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs disabled:opacity-50 transition-colors"
          >
            Abrir mes ahora →
          </button>
        </div>
      )}

      {periodo?.estado === 'abierto' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-sm text-emerald-950 leading-relaxed">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            Período abierto. La apertura se conserva en moneda nativa y su contravalor USD usa la tasa congelada; la tasa de mercado posterior no reescribe ese valor.
          </div>
          {missing.length > 0 && (
            <p className="mt-2 font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
              Hay {missing.length} cuenta(s) nueva(s) sin saldo inicial. Ábrelas y registra su saldo para poder operar el mes.
            </p>
          )}
        </div>
      )}

      {periodo?.estado === 'abierto' && !cierreHabilitado && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 font-medium">
          El cierre de {formatPeriodoMes(periodo.mes)} se habilita el primer día del mes siguiente, con el conteo físico de cada cuenta.
        </p>
      )}

      {periodo?.estado === 'abierto' && cierrePendiente === true && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 font-semibold flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0 text-amber-600" />
          Cierre pendiente de {formatPeriodoMes(periodo.mes)}: solo puede cerrarse después de su último día. Cierra este período para poder aperturar el mes siguiente.
        </p>
      )}

      {message && <p role="status" className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">{message}</p>}

      {wallets.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-50/80">
                <th className="py-2.5 px-3.5 text-left">Cuenta</th>
                <th className="py-2.5 px-3 text-center">Moneda</th>
                <th className="py-2.5 px-3.5 text-right">Saldo de apertura</th>
                <th className="py-2.5 px-3.5 text-right">USD congelado</th>
                <th className="py-2.5 px-3.5 text-right">Saldo calculado</th>
                <th className="py-2.5 px-3.5 text-right">Diferencia cierre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {wallets.map(row => (
                <tr key={walletKey(row)} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">{row.nombre}</td>
                  <td className="py-2.5 px-3 text-center">{renderMonedaBadge(row.moneda)}</td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                    {row.saldoApertura != null ? (
                      <span className="font-semibold text-slate-900">{money(row.saldoApertura)} <span className="text-xs text-slate-500 font-normal">{row.moneda}</span></span>
                    ) : (
                      <span className="text-slate-400 font-normal">— {row.moneda}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                    {row.saldoAperturaUsd != null ? (
                      <span className="font-semibold text-emerald-700">${money(row.saldoAperturaUsd)}</span>
                    ) : (
                      <span className="text-slate-400 font-normal">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                    {row.saldoCalculado != null ? (
                      <span className="font-semibold text-slate-900">{money(row.saldoCalculado)} <span className="text-xs text-slate-500 font-normal">{row.moneda}</span></span>
                    ) : (
                      <span className="text-slate-400 font-normal">— {row.moneda}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                    {row.diferenciaCierre != null ? (
                      <span className={`font-semibold ${Number(row.diferenciaCierre) === 0 ? 'text-slate-600' : 'text-amber-700'}`}>
                        {money(row.diferenciaCierre)} <span className="text-xs text-slate-500 font-normal">{row.moneda}</span>
                      </span>
                    ) : (
                      <span className="text-slate-400 font-normal">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {periodo?.estado === 'abierto' && cierreHabilitado && wallets.length > 0 && (
        <div className="space-y-3 border-t border-slate-200 pt-4 mt-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Conteo físico de cierre</h3>
              <p className="text-xs text-slate-500">Verifica el saldo contado físico de cada cuenta antes de consolidar el cierre mensual con el botón superior.</p>
            </div>
          </div>
          <div className="grid gap-3">
            {wallets.map(row => (
              <div key={walletKey(row)} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:grid-cols-3 items-center">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">{row.nombre} · <span className="font-mono text-xs text-slate-600">{row.moneda}</span></p>
                  <p className="break-words text-xs text-slate-500 mt-0.5">
                    Libro calcula <span className="font-mono font-semibold text-slate-700">{money(row.saldoCalculado)} {row.moneda}</span>
                  </p>
                </div>
                <label className="text-xs font-bold text-slate-700 block">
                  Saldo contado
                  <div className="relative mt-1">
                    <input
                      className="w-full rounded-lg border border-slate-300 p-2 pr-12 text-base font-mono font-semibold text-slate-900 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                      inputMode="decimal"
                      value={closing[walletKey(row)]?.saldoReal ?? (row.saldoCalculado ?? '')}
                      disabled={pending}
                      onChange={event => { const value = normalizarMontoInput(event.target.value); if (value !== null) setClosingValue(walletKey(row), 'saldoReal', value) }}
                    />
                    <span className="absolute right-2.5 top-2.5 text-xs font-bold font-mono text-slate-500 pointer-events-none">{row.moneda}</span>
                  </div>
                  {closing[walletKey(row)]?.saldoReal == null && (
                    <p className="mt-1 text-xs font-medium text-slate-500">Sin conteo físico: se cerrará con el saldo del libro.</p>
                  )}
                </label>
                <label className="text-xs font-bold text-slate-700 block">
                  Motivo de diferencia (si aplica)
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                    value={closing[walletKey(row)]?.motivo || ''}
                    disabled={pending}
                    maxLength={300}
                    placeholder="Obligatorio si el contado supera el libro (mín. 8 caracteres)"
                    onChange={event => setClosingValue(walletKey(row), 'motivo', event.target.value)}
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {periodo?.estado === 'cerrado' && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm font-semibold text-slate-800">
          Cierre confirmado {periodo.cerradoEn ? `el ${new Date(periodo.cerradoEn).toLocaleString('es-VE')}` : ''}. Revisa/descarga el CSV para mantener el detalle de auditoría.
        </p>
      )}

      {wizardOpen && (
        <PeriodoMensualWizardModal
          isOpen={wizardOpen}
          onClose={() => setWizardOpen(false)}
          periodo={periodo}
          activeWallets={activeWallets}
          rates={rates}
          pending={pending}
          canUseRates={canUseRates}
          onOpen={onOpen}
          onRefresh={onRefresh}
          onSuccessMessage={setMessage}
        />
      )}
    </section>
  )
}
