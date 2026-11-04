// src/components/finanzas/PeriodoMensualFinanzas.jsx
// Panel "Cierre del mes": una sola tarjeta dice en qué estado está el mes y qué toca
// hacer (abrirlo o cerrarlo), con un único botón. El cierre y la apertura son asistentes
// guiados; la tabla de saldos es solo de consulta.
import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, LockKeyhole, RefreshCw } from 'lucide-react'
import { formatNumber } from './formatos.js'
import { mesSiguienteIso } from './fechasRapidas.js'
import PeriodoMensualWizardModal from './PeriodoMensualWizardModal.jsx'
import CierreMesWizard from './CierreMesWizard.jsx'

const tasa = value => Number(value) > 0 ? Number(value) : 0
const money = value => value == null ? '—' : formatNumber(value)
const walletKey = row => row.cuentaCustodiaId

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const formatPeriodoMes = (mesIso) => {
  if (!mesIso || typeof mesIso !== 'string') return '—'
  const [year, month] = mesIso.split('-')
  const monthIdx = Number(month) - 1
  return monthIdx >= 0 && monthIdx < 12 ? `${MESES[monthIdx]} ${year}` : mesIso
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
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-50 text-sky-900 border border-sky-200">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
          Sin abrir
        </span>
      )
    case 'abierto':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-900 border border-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Abierto
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

export default function PeriodoMensualFinanzas({ periodo, cuentas, loading, error, pending, rates, onRefresh, onOpen, onClose, onConfirmClose, cierrePendiente }) {
  const cierreHabilitado = cierrePendiente ?? true
  const [wizardOpen, setWizardOpen] = useState(false)
  // El asistente de cierre conserva el mes que se cierra aunque, al terminar, la vista pase al siguiente.
  const [periodoCierre, setPeriodoCierre] = useState(null)
  const [message, setMessage] = useState('')
  const wallets = periodo?.cuentas || []
  const missing = periodo?.cuentasPendientes || []
  // Con el mes sin abrir no hay saldos que mostrar: la tabla se reduce al padrón de cuentas.
  const tieneSaldos = wallets.some(row => row.saldoApertura != null || row.saldoAperturaUsd != null || row.saldoCalculado != null || row.diferenciaCierre != null)
  const canUseRates = tasa(rates.usd) > 0 && tasa(rates.usdt) > 0
  const activeWallets = useMemo(() => (cuentas || []).filter(item => item.activo), [cuentas])
  const nombreMes = formatPeriodoMes(periodo?.mes)
  const nombreSiguiente = periodo?.mes ? formatPeriodoMes(mesSiguienteIso(periodo.mes)) : ''
  // Una sola línea de equivalente por saldo (nada si es 0): Bs y USDT en dólares, dólares en Bs.
  // Al empezar el mes se usa el valor en dólares fijado ese día; el saldo actual, la tasa de hoy.
  const equivalenteDe = (monto, moneda, usdFijado = null) => {
    const valor = Number(monto)
    if (monto == null || !Number.isFinite(valor) || valor === 0) return null
    const usdHoy = tasa(rates.usd)
    if (moneda === 'USD') return usdHoy > 0 ? `≈ ${money(valor * usdHoy)} Bs` : null
    if (usdFijado != null && Number.isFinite(Number(usdFijado))) return `≈ $${money(usdFijado)}`
    if (!(usdHoy > 0)) return null
    if (moneda === 'VES') return `≈ $${money(valor / usdHoy)}`
    return tasa(rates.usdt) > 0 ? `≈ $${money(valor * tasa(rates.usdt) / usdHoy)}` : null
  }
  const renderEquivalente = (texto, className) => texto ? <span className={className}>{texto}</span> : null

  const openWizard = () => {
    setMessage('')
    setWizardOpen(true)
  }
  const abrirSiguienteTrasCierre = () => {
    setPeriodoCierre(null)
    openWizard()
  }
  const puedeCerrar = periodo?.estado === 'abierto' && cierreHabilitado
  const motivoBloqueoCierre = !canUseRates ? 'Falta la tasa del día (USD y USDT) para valorar los saldos.'
    : missing.length > 0 ? `Hay ${missing.length} cuenta(s) nueva(s) sin saldo inicial; regístralas antes de cerrar.`
      : !wallets.length ? 'No hay cuentas en este mes.' : ''
  const botonPrincipal = 'inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold text-white shadow-xs transition-colors disabled:opacity-50 sm:w-auto'

  return (
    <section aria-label="Control mensual de tesorería" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-base font-black text-slate-900 tracking-tight">Cierre del mes</h2>
            {renderEstadoBadge(periodo?.estado)}
          </div>
          <p className="text-xs text-slate-500 font-medium mt-0.5">{nombreMes}</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Actualizar"
          className="min-h-11 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm shadow-xs transition-colors flex items-center justify-center gap-1.5"
        >
          <RefreshCw size={15} className={`text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800 font-medium">
          {error}
        </p>
      )}

      {puedeCerrar && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2.5 leading-relaxed">
            <LockKeyhole size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <span>
              <strong>{nombreMes} está listo para cerrar.</strong> Cuenta el dinero de cada cuenta y ciérralo; después podrás abrir {nombreSiguiente}.
              {motivoBloqueoCierre && <span className="mt-1 block font-semibold text-amber-800">{motivoBloqueoCierre}</span>}
            </span>
          </span>
          <button
            type="button"
            onClick={() => { setMessage(''); setPeriodoCierre(periodo) }}
            disabled={pending || loading || Boolean(motivoBloqueoCierre)}
            className={`${botonPrincipal} bg-amber-700 hover:bg-amber-800`}
          >
            <LockKeyhole size={15} />
            Empezar cierre
          </button>
        </div>
      )}

      {periodo?.estado === 'abierto' && !cierreHabilitado && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-sm leading-relaxed text-emerald-950">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
          <span>
            <strong>{nombreMes} está abierto.</strong> Puedes registrar movimientos; el cierre se habilita el primer día de {nombreSiguiente}.
            {missing.length > 0 && <span className="mt-1 block font-semibold text-amber-900">Hay {missing.length} cuenta(s) nueva(s) sin saldo inicial; regístralas para usarlas este mes.</span>}
          </span>
        </div>
      )}

      {periodo?.estado === 'sin_apertura' && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3.5 text-sm text-sky-950 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2.5 leading-relaxed">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-sky-600" />
            <span>
              <strong>{nombreMes} todavía no está abierto.</strong> Ábrelo para empezar el mes: cada cuenta arranca con el saldo con que cerró el mes anterior.
              {!canUseRates && <span className="mt-1 block font-semibold text-amber-800">Falta la tasa del día (USD y USDT) para valorar los saldos.</span>}
            </span>
          </span>
          <button
            type="button"
            onClick={openWizard}
            disabled={pending || loading || !canUseRates || activeWallets.length === 0}
            className={`${botonPrincipal} bg-primary hover:bg-primary-hover`}
          >
            Abrir {nombreMes}
          </button>
        </div>
      )}

      {periodo?.estado === 'cerrado' && (
        <p className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-800">
          <LockKeyhole size={16} className="mt-0.5 shrink-0 text-slate-500" />
          <span><strong>{nombreMes} está cerrado</strong>{periodo.cerradoEn ? ` desde el ${new Date(periodo.cerradoEn).toLocaleString('es-VE')}` : ''}. Su PDF está en el historial de cierres.</span>
        </p>
      )}

      {message && <p role="status" className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">{message}</p>}

      {wallets.length > 0 && (
        <>
          {/* Vista desktop: tabla de consulta */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
            <table className={`w-full ${tieneSaldos ? 'min-w-[560px]' : 'min-w-[300px]'} text-left text-sm`}>
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-50/80">
                  <th className="py-2.5 px-3.5 text-left">Cuenta</th>
                  <th className="py-2.5 px-3 text-center">Moneda</th>
                  {tieneSaldos && <th className="py-2.5 px-3.5 text-right">Al empezar el mes</th>}
                  {tieneSaldos && <th className="py-2.5 px-3.5 text-right">Ahora (según movimientos)</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {wallets.map(row => (
                  <tr key={walletKey(row)} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3.5 font-semibold text-slate-900">{row.nombre}</td>
                    <td className="py-2.5 px-3 text-center">{renderMonedaBadge(row.moneda)}</td>
                    {tieneSaldos && (
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                        {row.saldoApertura != null ? (
                          <span className="font-semibold text-slate-900">{money(row.saldoApertura)} <span className="text-xs text-slate-500 font-normal">{row.moneda}</span></span>
                        ) : (
                          <span className="text-slate-400 font-normal">— {row.moneda}</span>
                        )}
                        {renderEquivalente(equivalenteDe(row.saldoApertura, row.moneda, row.saldoAperturaUsd), 'block text-xs font-medium text-slate-500 mt-0.5')}
                      </td>
                    )}
                    {tieneSaldos && (
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                        {row.saldoCalculado != null ? (
                          <span className="font-semibold text-slate-900">{money(row.saldoCalculado)} <span className="text-xs text-slate-500 font-normal">{row.moneda}</span></span>
                        ) : (
                          <span className="text-slate-400 font-normal">— {row.moneda}</span>
                        )}
                        {renderEquivalente(equivalenteDe(row.saldoCalculado, row.moneda), 'block text-xs font-medium text-slate-500 mt-0.5')}
                        {row.diferenciaCierre != null && (
                          <span className={`block text-xs font-bold mt-0.5 ${Number(row.diferenciaCierre) === 0 ? 'text-slate-500' : 'text-amber-700'}`}>
                            Diferencia al cerrar: {money(row.diferenciaCierre)} {row.moneda}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Vista móvil: tarjetas sin scroll horizontal ni recortes */}
          <div className="block md:hidden space-y-2.5">
            {wallets.map(row => (
              <article key={walletKey(row)} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 text-sm truncate">{row.nombre}</span>
                  {renderMonedaBadge(row.moneda)}
                </div>
                {tieneSaldos && (
                  <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-2.5 border border-slate-100 text-xs min-[380px]:grid-cols-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Al empezar el mes</span>
                      <span className="font-mono font-bold text-slate-900 block mt-0.5 break-words">
                        {row.saldoApertura != null ? `${money(row.saldoApertura)} ${row.moneda}` : '—'}
                      </span>
                      {renderEquivalente(equivalenteDe(row.saldoApertura, row.moneda, row.saldoAperturaUsd), 'font-mono text-[11px] text-slate-500 block mt-0.5')}
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Ahora</span>
                      <span className="font-mono font-bold text-slate-900 block mt-0.5 break-words">
                        {row.saldoCalculado != null ? `${money(row.saldoCalculado)} ${row.moneda}` : '—'}
                      </span>
                      {renderEquivalente(equivalenteDe(row.saldoCalculado, row.moneda), 'font-mono text-[11px] text-slate-500 block mt-0.5')}
                      {row.diferenciaCierre != null && (
                        <span className={`font-mono text-[11px] font-bold block mt-0.5 ${Number(row.diferenciaCierre) === 0 ? 'text-slate-500' : 'text-amber-700'}`}>
                          Diferencia al cerrar: {money(row.diferenciaCierre)} {row.moneda}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
          {!tieneSaldos && (
            <p className="text-xs text-slate-500">Al abrir el mes verás aquí con cuánto empezó cada cuenta y su saldo según los movimientos.</p>
          )}
        </>
      )}

      {periodoCierre && (
        <CierreMesWizard
          periodo={periodoCierre}
          mesNombre={formatPeriodoMes(periodoCierre.mes)}
          mesSiguienteNombre={formatPeriodoMes(mesSiguienteIso(periodoCierre.mes))}
          rates={rates}
          pending={pending}
          onConfirmClose={onConfirmClose || onClose}
          onRefresh={onRefresh}
          onClose={() => setPeriodoCierre(null)}
          onAbrirSiguiente={onOpen ? abrirSiguienteTrasCierre : null}
        />
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
