import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import { isoToday } from './fechasRapidas.js'
import { formatNumber, normalizarMontoInput } from './formatos.js'
import { conteoValido } from '../../utils/montoUtils.js'

const tasa = value => Number(value) > 0 ? Number(value) : 0
const money = value => value == null ? '—' : formatNumber(value)
const netoMesDe = (periodo, walletId) => Number((periodo?.cuentas || []).find(row => row.cuentaCustodiaId === walletId)?.movimientosMes ?? 0)
const saldoAnteriorDe = (periodo, walletId) => {
  const previous = (periodo?.cierreAnterior || []).find(row => row.cuentaCustodiaId === walletId)
  if (previous?.saldo != null) return { saldo: Number(previous.saldo), origen: 'cierre anterior' }
  const estado = (periodo?.cuentas || []).find(row => row.cuentaCustodiaId === walletId)
  return estado?.saldoHistorico != null
    ? { saldo: Number(estado.saldoHistorico) - Number(estado.movimientosMes ?? 0), origen: 'saldo del libro' }
    : null
}
const herenciaValida = anterior => anterior != null && Number.isFinite(anterior.saldo) && anterior.saldo >= 0
const key = () => crypto.randomUUID()

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

export default function PeriodoMensualWizardModal({
  isOpen,
  onClose,
  periodo,
  activeWallets,
  rates,
  pending,
  canUseRates,
  onOpen,
  onRefresh,
  onSuccessMessage,
}) {
  const [step, setStep] = useState(0)
  const [message, setMessage] = useState('')
  // Una sola clave de idempotencia por sesión del wizard: un reintento tras una
  // respuesta perdida debe reproducirse, no empezar una operación nueva que el
  // servidor rechazaría como "mes ya aperturado con datos distintos".
  const [aperturaKey] = useState(() => key())
  const [opening, setOpening] = useState(() => {
    const previous = new Map((periodo?.cierreAnterior || []).map(row => [row.cuentaCustodiaId, row]))
    return Object.fromEntries((activeWallets || []).map(wallet => {
      const prior = previous.get(wallet.id)
      return [wallet.id, {
        metodo: prior ? 'cierre_anterior' : 'saldo_real',
        saldoReal: prior?.saldo ?? '',
        motivo: '',
      }]
    }))
  })

  // Cuentas dadas de alta con el wizard abierto: reciben la entrada por defecto
  // (conteo físico pendiente) en vez de enviarse sin método al servidor.
  const entryDe = id => opening[id] || { metodo: 'saldo_real', saldoReal: '', motivo: '' }
  const setOpeningValue = (id, field, value) => setOpening(current => ({ ...current, [id]: { ...entryDe(id), ...current[id], [field]: value } }))

  const conteoPendiente = (activeWallets || []).some(wallet => {
    const entry = entryDe(wallet.id)
    return entry.metodo === 'saldo_real' && !conteoValido(entry.saldoReal)
  })
  const aperturaNegativa = (activeWallets || []).some(wallet => {
    const entry = entryDe(wallet.id)
    return entry.metodo === 'saldo_real' && conteoValido(entry.saldoReal)
      && Number(entry.saldoReal) - netoMesDe(periodo, wallet.id) < -0.000001
  })

  async function confirmOpening() {
    const rows = activeWallets.map(wallet => {
      const entry = entryDe(wallet.id)
      const prior = (periodo?.cierreAnterior || []).find(item => item.cuentaCustodiaId === wallet.id)
      const anterior = saldoAnteriorDe(periodo, wallet.id)
      const contado = entry.metodo === 'saldo_libro' && anterior ? anterior.saldo + netoMesDe(periodo, wallet.id) : (conteoValido(entry.saldoReal) ? Number(entry.saldoReal) : NaN)
      const metodo = entry.metodo === 'saldo_libro' ? 'saldo_real' : entry.metodo
      const balance = entry.metodo === 'cierre_anterior' ? prior?.saldo : contado
      return {
        cuentaCustodiaId: wallet.id, metodo,
        ...(metodo === 'saldo_real' ? { saldoReal: contado } : {}),
        ...(metodo === 'saldo_real' && (anterior || entry.motivo?.trim()) ? { motivo: entry.motivo?.trim() || null } : {}),
        tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt),
        ...(wallet.moneda === 'VES' ? { tasaUsdVes: String(rates.usd) } : {}),
        ...(wallet.moneda === 'USDT' ? { tasaUsdtVes: String(rates.usdt) } : {}),
        ...(balance !== undefined ? { previewSaldo: Number(balance) } : {}),
      }
    })
    const missingRows = rows.filter(row => row.metodo === 'saldo_real' && !Number.isFinite(row.saldoReal))
    if (missingRows.length) { setMessage('Revisa los saldos físicos de todas las cuentas antes de continuar.'); return }
    if (rows.some(row => row.metodo === 'cierre_anterior' && row.previewSaldo == null)) { setMessage('No se pudo recuperar un cierre anterior consistente.'); return }
    // Apertura real: el conteo menos los movimientos ya registrados en el mes.
    const aperturaDe = row => row.metodo === 'cierre_anterior'
      ? Number((periodo?.cierreAnterior || []).find(item => item.cuentaCustodiaId === row.cuentaCustodiaId)?.saldo)
      : Number(row.saldoReal) - netoMesDe(periodo, row.cuentaCustodiaId)
    if (rows.some(row => row.metodo === 'saldo_real' && aperturaDe(row) < -0.000001)) {
      setMessage('El conteo físico no cubre los movimientos del mes en alguna cuenta; la apertura no puede quedar en negativo.'); return
    }
    // Regla dura del servidor, anticipada: la apertura nunca reduce los fondos
    // confirmados del cierre anterior, haya motivo o no.
    if (rows.some(row => {
      const previous = (periodo?.cierreAnterior || []).find(item => item.cuentaCustodiaId === row.cuentaCustodiaId)
      return previous?.saldo != null && aperturaDe(row) < Number(previous.saldo) - 0.000001
    })) { setMessage('La apertura no puede quedar por debajo del cierre anterior; el servidor protege los fondos confirmados.'); return }
    // Misma exigencia que el servidor: el motivo es obligatorio solo frente al
    // CIERRE ANTERIOR. Sin cierres previos, el saldo del libro es referencia
    // informativa y el motivo queda opcional.
    if (rows.some(row => {
      const previous = (periodo?.cierreAnterior || []).find(item => item.cuentaCustodiaId === row.cuentaCustodiaId)
      return row.metodo === 'saldo_real' && previous?.saldo != null
        && Math.abs(aperturaDe(row) - Number(previous.saldo)) > 0.000001
        && String(row.motivo || '').trim().length < 8
    })) { setMessage('Justifica con al menos 8 caracteres cada diferencia frente al cierre anterior.'); return }
    rows.forEach(row => { delete row.previewSaldo })
    try {
      await onOpen({ accion: 'aperturar', mesInicio: periodo.mes, idempotencyKey: aperturaKey, payload: { cuentas: rows, tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt) } })
      onClose()
      onSuccessMessage('Apertura mensual confirmada. Saldos y tasas quedaron congelados.')
      await onRefresh()
    } catch (cause) { setMessage(cause.message || 'No se confirmó la apertura; conserva los datos y reintenta.') }
  }

  if (!isOpen) return null

  return (
    <Modal
      isOpen
      onClose={() => !pending && onClose()}
      title="Apertura mensual de tesorería"
      className="sm:max-w-3xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => step ? setStep(step - 1) : onClose()}
            disabled={pending}
            className="min-h-11 px-5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm shadow-xs transition-colors disabled:opacity-50"
          >
            {step ? 'Anterior' : 'Cancelar'}
          </button>
          {step < 1 ? (
            <div className="flex items-center gap-3">
              {(conteoPendiente || aperturaNegativa) && (
                <span className="text-xs text-amber-700 font-medium hidden sm:inline">
                  {conteoPendiente ? 'Completa los saldos para continuar' : 'Hay aperturas en negativo: ajusta el conteo'}
                </span>
              )}
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={pending || (step === 0 && (conteoPendiente || aperturaNegativa))}
                className="min-h-11 px-5 rounded-xl bg-primary hover:bg-primary-hover active:bg-primary-dark text-white font-bold text-sm shadow-sm transition-colors disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={confirmOpening}
              disabled={pending || !canUseRates || conteoPendiente || aperturaNegativa}
              className="min-h-11 px-5 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-bold text-sm shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {pending && <RefreshCw size={15} className="animate-spin" />}
              {pending ? 'Confirmando…' : 'Confirmar apertura'}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <ol className="flex items-center gap-3 text-xs font-bold border-b border-slate-100 pb-3">
          {[
            { label: 'Cuentas y saldos', desc: 'Conteo físico verificado' },
            { label: 'Revisión', desc: 'Tasas congeladas y balance' }
          ].map((item, index) => {
            const isActive = step === index
            const isCompleted = step > index
            return (
              <li
                key={item.label}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all ${
                  isActive
                    ? 'bg-primary text-white shadow-xs'
                    : isCompleted
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-black ${
                    isActive
                      ? 'bg-white text-primary'
                      : isCompleted
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isCompleted ? '✓' : index + 1}
                </span>
                <span>{item.label}</span>
              </li>
            )
          })}
        </ol>

        {step === 0 && (
          <div className="flex items-center gap-2.5 rounded-xl bg-blue-50/80 border border-blue-200 p-3 text-xs text-blue-950 font-medium">
            <Info size={16} className="text-blue-600 shrink-0" />
            <span>Fecha de apertura {isoToday()}. Las tasas se fijan ahora y no se actualizan en este período.</span>
          </div>
        )}

        {step === 0 && (
          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {activeWallets.map(wallet => {
              const entry = entryDe(wallet.id)
              const previous = (periodo?.cierreAnterior || []).find(row => row.cuentaCustodiaId === wallet.id)
              const anterior = saldoAnteriorDe(periodo, wallet.id)
              const isManual = entry.metodo === 'saldo_real'
              const saldoContadoNum = isManual && conteoValido(entry.saldoReal) ? Number(entry.saldoReal) : null
              const netoMes = netoMesDe(periodo, wallet.id)
              const saldoAperturaReal = saldoContadoNum != null ? saldoContadoNum - netoMes : null
              const difiereAnterior = anterior && saldoAperturaReal != null && Math.abs(saldoAperturaReal - Number(anterior.saldo)) > 0.000001
              const difiereValor = difiereAnterior ? saldoAperturaReal - Number(anterior.saldo) : 0
              const motivoValido = String(entry.motivo || '').trim().length >= 8
              // El motivo es obligatorio solo frente al CIERRE ANTERIOR (misma
              // regla del servidor); frente al saldo del libro es opcional.
              const motivoObligatorio = anterior?.origen === 'cierre anterior' && difiereAnterior

              return (
                <div
                  key={wallet.id}
                  className={`rounded-xl border p-3.5 transition-all ${
                    motivoObligatorio && !motivoValido
                      ? 'border-amber-300 bg-amber-50/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="grid gap-3 sm:grid-cols-12 items-center">
                    <div className="min-w-0 sm:col-span-5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-bold text-slate-900">{wallet.nombre}</p>
                        {renderMonedaBadge(wallet.moneda)}
                      </div>
                      <p className="break-words text-xs text-slate-500 mt-1">
                        Saldo anterior: {anterior ? `${money(anterior.saldo)} ${wallet.moneda} (${anterior.origen})` : 'No disponible'}
                      </p>
                      {netoMes !== 0 && (
                        <p className="text-xs text-blue-700 font-medium mt-0.5">
                          Movimientos en mes: {netoMes > 0 ? '+' : ''}{money(netoMes)} {wallet.moneda}
                        </p>
                      )}
                    </div>

                    <div className="sm:col-span-4">
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        Fuente del saldo
                      </label>
                      <CustomSelect
                        aria-label={`Fuente del saldo de ${wallet.nombre}`}
                        value={entry.metodo}
                        disabled={pending}
                        onChange={value => setOpeningValue(wallet.id, 'metodo', value)}
                        showSubInTrigger={false}
                        options={[
                          { value: 'saldo_real', label: 'Conteo físico verificado' },
                          ...(previous ? [{ value: 'cierre_anterior', label: 'Cierre anterior' }] : []),
                          ...(!previous && anterior && herenciaValida(anterior) ? [{ value: 'saldo_libro', label: 'Saldo del libro al inicio del mes' }] : [])
                        ]}
                      />
                    </div>

                    <div className="sm:col-span-3">
                      {entry.metodo === 'saldo_libro' ? (
                        <div>
                          <span className="text-xs font-bold text-slate-500 block mb-1">Saldo aplicado</span>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm font-bold text-slate-800 truncate">
                            Se hereda del libro: {money(anterior?.saldo)} {wallet.moneda}
                          </div>
                        </div>
                      ) : entry.metodo === 'saldo_real' ? (
                        <label className="text-xs font-bold text-slate-700 block">
                          Saldo contado
                          <div className="relative mt-1">
                            <input
                              inputMode="decimal"
                              value={entry.saldoReal}
                              disabled={pending}
                              onChange={event => { const value = normalizarMontoInput(event.target.value); if (value !== null) setOpeningValue(wallet.id, 'saldoReal', value) }}
                              placeholder="0.00"
                              className={`w-full rounded-lg border p-2 pr-12 text-sm font-mono font-semibold text-slate-900 focus:outline-none ${isManual && !conteoValido(entry.saldoReal) ? 'border-rose-400 bg-rose-50/40 focus:ring-2 focus:ring-rose-300' : 'border-slate-300 focus:border-primary focus:ring-2 focus:ring-primary/20'}`}
                            />
                            <span className="absolute right-2.5 top-2.5 text-xs font-bold font-mono text-slate-400 pointer-events-none">
                              {wallet.moneda}
                            </span>
                          </div>
                          {isManual && !conteoValido(entry.saldoReal) && (
                            <p className="mt-1 text-xs font-medium text-rose-600">Ingresa el conteo físico; acepta punto o coma decimal.</p>
                          )}
                          {saldoAperturaReal != null && saldoAperturaReal < 0 && (
                            <p className="mt-1 text-xs font-bold text-rose-700">La apertura quedaría en negativo: el conteo no cubre los movimientos del mes.</p>
                          )}
                        </label>
                      ) : (
                        <div>
                          <span className="text-xs font-bold text-slate-500 block mb-1">Saldo aplicado</span>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm font-bold text-slate-800 truncate">
                            Se hereda: {money(previous?.saldo)} {wallet.moneda}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {anterior && entry.metodo === 'saldo_real' && difiereAnterior && (
                    <div className="mt-2.5 pt-2 border-t border-amber-200">
                      <div className="flex items-center justify-between text-xs font-semibold text-amber-900 mb-1 flex-wrap gap-1">
                        <span className="flex items-center gap-1 font-bold">
                          <AlertTriangle size={13} className="text-amber-600" />
                          Diferencia detectada: {difiereValor > 0 ? '+' : ''}{money(difiereValor)} {wallet.moneda} frente al saldo anterior
                        </span>
                        <span className={motivoValido ? 'text-emerald-700 font-bold' : 'text-amber-700 font-semibold'}>
                          {motivoObligatorio
                            ? `${String(entry.motivo || '').trim().length}/8 caracteres requeridos`
                            : 'Motivo opcional (queda registrado en la apertura)'}
                        </span>
                      </div>
                      <label className="text-xs font-bold text-slate-700 block">
                        Motivo si difiere del saldo anterior
                        <input
                          value={entry.motivo}
                          maxLength={300}
                          disabled={pending}
                          onChange={event => setOpeningValue(wallet.id, 'motivo', event.target.value)}
                          className={`mt-1 w-full rounded-lg border p-2 text-xs focus:outline-none transition-colors ${
                            motivoObligatorio && !motivoValido
                              ? 'border-amber-400 bg-amber-50/40 focus:ring-2 focus:ring-amber-300'
                              : 'border-slate-300 focus:border-primary focus:ring-2 focus:ring-primary/20'
                          }`}
                          placeholder={motivoObligatorio ? 'Obligatorio: explica la diferencia (al menos 8 caracteres)' : 'Al menos 8 caracteres'}
                        />
                      </label>
                    </div>
                  )}

                  {anterior && entry.metodo === 'saldo_real' && !difiereAnterior && saldoContadoNum != null && (
                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-1.5 text-xs text-emerald-700 font-semibold">
                      <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                      <span>Saldo coincide con el saldo anterior (sin diferencias)</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3 border border-slate-200 flex-wrap gap-2">
              <p className="font-medium text-slate-700">
                <strong className="text-slate-900 font-bold">{activeWallets.length}</strong> cuentas se aperturarán para {formatPeriodoMes(periodo.mes)} <span className="text-slate-400 font-normal">({periodo.mes})</span>.
              </p>
              <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-blue-100 text-blue-800">
                Paso final de revisión
              </span>
            </div>

            {conteoPendiente && (
              <p role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-rose-800 font-medium text-sm flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0" />
                Hay cuentas sin conteo físico. Regístralo en el paso anterior antes de confirmar.
              </p>
            )}

            {aperturaNegativa && (
              <p role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-rose-800 font-medium text-sm flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0" />
                Hay cuentas cuya apertura quedaría en negativo (el conteo no cubre los movimientos del mes). Ajusta el conteo en el paso anterior.
              </p>
            )}

            {rates.tasaFallback && (
              <p role="status" className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900 font-medium text-sm flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0" />
                La tasa elegida no tiene dato; se congela la del BCV dólar como respaldo.
              </p>
            )}

            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 shadow-xs space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="rounded-lg bg-white p-2.5 border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase block truncate">Principal ({rates.nombrePrincipal})</span>
                  <span className="font-mono text-base font-black text-primary">{formatNumber(rates.principal)} <span className="text-xs text-slate-500 font-normal">VES</span></span>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase block truncate">USD / VES</span>
                  <span className="font-mono text-base font-black text-slate-900">{formatNumber(rates.usd)} <span className="text-xs text-slate-500 font-normal">VES</span></span>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-500 uppercase block truncate">USDT / VES</span>
                  <span className="font-mono text-base font-black text-slate-900">{formatNumber(rates.usdt)} <span className="text-xs text-slate-500 font-normal">VES</span></span>
                </div>
              </div>
              <p className="text-xs text-slate-600 border-t border-primary/10 pt-2 font-medium">
                Tasa congelada ({rates.nombrePrincipal}): <strong className="text-primary font-bold">{formatNumber(rates.principal)} VES/{rates.unidadPrincipal || 'USD'}</strong> · USD/VES {formatNumber(rates.usd)} · USDT/VES {formatNumber(rates.usdt)}. Origen: {rates.source || 'sin fuente'}.
              </p>
            </div>

            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {activeWallets.map(wallet => {
                const row = entryDe(wallet.id)
                const neto = netoMesDe(periodo, wallet.id)
                const etiqueta = {
                  saldo_real: 'conteo físico',
                  saldo_libro: 'saldo del libro al inicio del mes',
                  cierre_anterior: 'cierre anterior'
                }[row.metodo]
                const sinConteo = row.metodo === 'saldo_real' && !conteoValido(row.saldoReal)
                const amount = sinConteo
                  ? null
                  : row.metodo === 'saldo_real'
                  ? Number(row.saldoReal) - neto
                  : row.metodo === 'saldo_libro'
                  ? Number(saldoAnteriorDe(periodo, wallet.id)?.saldo)
                  : Number((periodo?.cierreAnterior || []).find(item => item.cuentaCustodiaId === wallet.id)?.saldo)
                const usd = amount == null
                  ? null
                  : wallet.moneda === 'USD'
                  ? amount
                  : wallet.moneda === 'VES'
                  ? amount / tasa(rates.usd)
                  : amount * tasa(rates.usdt) / tasa(rates.usd)

                const enNegativo = !sinConteo && amount != null && amount < 0

                return (
                  <div
                    key={wallet.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      sinConteo || enNegativo
                        ? 'border-rose-300 bg-rose-50/60'
                        : 'border-slate-200 bg-white hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <p className={`text-sm font-medium leading-relaxed ${sinConteo || enNegativo ? 'text-rose-800' : 'text-slate-900'}`}>
                      {wallet.nombre}: {sinConteo ? 'falta el conteo físico' : `${money(amount)} ${wallet.moneda} ≈ $${money(usd)} USD`} · saldo de apertura por {etiqueta}{row.metodo === 'saldo_real' && !sinConteo && neto !== 0 ? ` · contado ${money(Number(row.saldoReal))} menos movimientos del mes ${money(neto)}` : ''}{enNegativo ? ' · la apertura quedaría en negativo' : ''}
                    </p>
                    {row.motivo && (
                      <p className="mt-1.5 text-xs text-slate-600 bg-slate-50 rounded-lg p-2 border border-slate-100">
                        <span className="font-bold text-slate-700">Justificación:</span> {row.motivo}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {message && <p role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800 font-medium">{message}</p>}
      </div>
    </Modal>
  )
}
