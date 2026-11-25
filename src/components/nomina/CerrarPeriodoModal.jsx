// src/components/nomina/CerrarPeriodoModal.jsx
// Modal de resumen y cierre del período: muestra totales y excepciones de la
// semana y exige confirmar la tasa con la que se pagará ese período.
import { useMemo, useState } from 'react'
import { AlertCircle, CalendarCheck2, Clock, Lock, RefreshCw, UserX } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { useCerrarPeriodo, useNominaLineas } from '../../hooks/useNomina'
import useAutoCalculoPeriodo from '../../hooks/useAutoCalculoPeriodo.js'
import useTasaCambioNomina from '../../hooks/useTasaCambioNomina.js'
import useMonedaNomina, { formatBs } from '../../hooks/useMonedaNomina.js'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'

const FUENTES = [
  { id: 'BCV', label: 'BCV $', key: 'usd' },
  { id: 'EURO', label: 'BCV €', key: 'eur' },
  { id: 'USDT', label: 'USDT', key: 'usdt' },
  { id: 'MANUAL', label: 'Manual', key: 'manual' },
]

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtFecha(f) {
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
}

function fuenteInicialDe(tipoTasa) {
  if (tipoTasa === 'bcv_eur') return 'EURO'
  if (tipoTasa === 'usdt') return 'USDT'
  if (tipoTasa === 'manual') return 'MANUAL'
  return 'BCV'
}

export default function CerrarPeriodoModal({ periodo, onClose, onVerHoja = null }) {
  const { data: lineas = [], isLoading } = useNominaLineas(periodo.id)
  const autoCalculo = useAutoCalculoPeriodo(periodo, periodo.estado === 'abierto')
  const cerrar = useCerrarPeriodo()
  const market = useTasaCambioNomina()
  const moneda = useMonedaNomina()

  const [fuente, setFuente] = useState(() => fuenteInicialDe(moneda.tipoTasa))
  const [tasaManualInput, setTasaManualInput] = useState(null)
  const [jornadasAbiertas, setJornadasAbiertas] = useState(null)
  const [error, setError] = useState('')

  const tasasDisponibles = useMemo(() => ({
    BCV: Number(market.usd) || 0,
    EURO: Number(market.eur) || 0,
    USDT: Number(market.usdt) || 0,
    MANUAL: Number(moneda.tasaManual) || Number(moneda.tasaActiva) || Number(market.usd) || 0,
  }), [market.usd, market.eur, market.usdt, moneda.tasaManual, moneda.tasaActiva])

  const tasaTexto = tasaManualInput !== null
    ? tasaManualInput
    : (() => {
        const sugerida = fuente === 'MANUAL'
          ? tasasDisponibles.MANUAL
          : (tasasDisponibles[fuente] || tasasDisponibles.BCV)
        return sugerida > 0 ? String(sugerida) : ''
      })()

  const tasaNumero = useMemo(() => {
    const n = Number(String(tasaTexto || '').trim().replace(',', '.'))
    return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? n : 0
  }, [tasaTexto])

  const resumen = useMemo(() => {
    const r = {
      empleados: lineas.length,
      horasExtra: 0,
      montoExtra: 0,
      ausencias: 0,
      especiales: 0,
      bruto: 0,
      deducciones: 0,
      neto: 0,
    }
    for (const l of lineas) {
      r.horasExtra += Number(l.horas_extra || 0)
      r.montoExtra += Number(l.monto_extra_usd || 0)
      r.ausencias += Number(l.dias_ausencia || 0)
      r.especiales += Number(l.dias_sabado || 0) + Number(l.dias_feriado || 0)
      r.bruto += Number(l.total_bruto_usd || 0)
      r.deducciones += Number(l.deducciones_usd || 0)
      r.neto += Number(l.total_neto_usd || 0)
    }
    return r
  }, [lineas])

  const novedades = useMemo(() => (lineas || []).reduce((acc, l) => {
    const tags = []
    const extras = Number(l.horas_extra || 0)
    const faltas = Number(l.dias_ausencia || 0)
    const especiales = Number(l.dias_sabado || 0) + Number(l.dias_feriado || 0)
    const bonos = Number(l.bonos_usd || 0)
    const deduc = Number(l.deducciones_usd || 0)
    if (extras > 0) tags.push({ id: 'extra', txt: `+${extras} h extra`, cls: 'border-amber-200 bg-amber-100 text-amber-900' })
    if (faltas > 0) tags.push({ id: 'falta', txt: `${faltas} falta${faltas === 1 ? '' : 's'}`, cls: 'border-rose-200 bg-rose-100 text-rose-800' })
    if (especiales > 0) tags.push({ id: 'esp', txt: `${especiales} desc./fer.`, cls: 'border-violet-200 bg-violet-100 text-violet-900' })
    if (bonos > 0) tags.push({ id: 'bono', txt: `+$${fmt(bonos)} bono`, cls: 'border-emerald-200 bg-emerald-100 text-emerald-800' })
    if (deduc > 0) tags.push({ id: 'ded', txt: `-$${fmt(deduc)} desc.`, cls: 'border-rose-200 bg-rose-50 text-rose-700' })
    if (tags.length) {
      acc.push({ id: l.id || l.empleado_id, nombre: capitalizarPalabras(l.empleado?.nombre) || 'Trabajador', tags })
    }
    return acc
  }, []), [lineas])

  function elegirFuente(nuevaFuente) {
    setFuente(nuevaFuente)
    setTasaManualInput(nuevaFuente === 'MANUAL' && !tasasDisponibles.MANUAL ? '' : null)
  }

  async function confirmar(confirmarJornadasAbiertas = false) {
    setError('')
    if (tasaNumero <= 0) {
      setError('Indica una tasa de pago válida (mayor a 0 Bs/$) para cerrar el período.')
      return
    }
    try {
      await cerrar.mutateAsync({
        periodoId: periodo.id,
        tasaPago: tasaNumero,
        fuenteTasaPago: fuente,
        tasas: {
          usd: Number(market.usd) || (fuente === 'BCV' ? tasaNumero : 0),
          eur: Number(market.eur) || 0,
          usdt: Number(market.usdt) || 0,
        },
        ...(confirmarJornadasAbiertas ? { confirmarJornadasAbiertas: true } : {}),
      })
      onClose()
    } catch (err) {
      if (Array.isArray(err?.payload?.jornadas_abiertas)) {
        setJornadasAbiertas({
          total: Number(err.payload.total_jornadas_abiertas) || err.payload.jornadas_abiertas.length,
          detalle: err.payload.jornadas_abiertas,
        })
        return
      }
      setError(err?.message || 'No se pudo cerrar el período.')
    }
  }

  const ocupado = cerrar.isPending || autoCalculo?.calculando

  return (
    <Modal
      isOpen
      onClose={() => !cerrar.isPending && onClose()}
      busy={cerrar.isPending}
      title={`Cerrar ${periodo.nombre}`}
      className="sm:max-w-xl"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={cerrar.isPending}
              onClick={onClose}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            {onVerHoja && (
              <button
                type="button"
                disabled={cerrar.isPending}
                onClick={() => { onClose(); onVerHoja(periodo) }}
                className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Ver hoja semanal
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={ocupado || isLoading || tasaNumero <= 0 || resumen.empleados === 0}
            onClick={() => confirmar(false)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"
          >
            {ocupado ? <RefreshCw size={15} className="animate-spin" aria-hidden="true" /> : <Lock size={15} aria-hidden="true" />}
            {cerrar.isPending ? 'Cerrando período…' : 'Confirmar cierre y pagar'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold text-slate-800">{periodo.nombre}</p>
          <p className="text-[11px] text-slate-500">
            {fmtFecha(periodo.desde)} – {fmtFecha(periodo.hasta)} · {resumen.empleados} trabajador(es)
          </p>
        </div>

        {/* Resumen semanal */}
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
          <DatoResumen label="Bruto USD" value={`$${fmt(resumen.bruto)}`} />
          <DatoResumen label="Deducciones" value={`$${fmt(resumen.deducciones)}`} tone={resumen.deducciones > 0 ? 'rose' : 'slate'} />
          <DatoResumen label="Horas extra" value={`${resumen.horasExtra.toFixed(1)} h`} sub={resumen.montoExtra > 0 ? `+$${fmt(resumen.montoExtra)}` : null} tone={resumen.horasExtra > 0 ? 'amber' : 'slate'} icon={Clock} />
          <DatoResumen label="Ausencias" value={resumen.ausencias} sub={resumen.especiales > 0 ? `${resumen.especiales} esp.` : null} tone={resumen.ausencias > 0 ? 'rose' : 'slate'} icon={resumen.ausencias > 0 ? UserX : CalendarCheck2} />
        </div>

        {/* Novedades por trabajador antes de cerrar */}
        {!isLoading && resumen.empleados > 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3" aria-label="Novedades de la semana">
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-600">Novedades de la semana</p>
            {novedades.length === 0 ? (
              <p className="mt-1 text-xs font-semibold text-emerald-800">Semana sin excepciones (asistencia completa de todo el personal).</p>
            ) : (
              <ul className="mt-2 max-h-36 space-y-1.5 overflow-y-auto custom-scrollbar">
                {novedades.map(n => (
                  <li key={n.id} className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 truncate font-bold text-slate-800">{n.nombre}</span>
                    <span className="flex flex-wrap gap-1">
                      {n.tags.map(t => (
                        <span key={t.id} className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${t.cls}`}>{t.txt}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Bloque obligatorio: Tasa con la que se pagará el período */}
        <div className="space-y-3 rounded-2xl border border-primary/25 bg-primary/[0.03] p-3.5">
          <div>
            <p className="text-xs font-black text-slate-900">Tasa de cambio para pagar este período *</p>
            <p className="text-[11px] text-slate-500">Esta tasa quedará congelada para los montos en bolívares de esta semana.</p>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4" role="group" aria-label="Elegir tasa de pago">
            {FUENTES.map(opt => {
              const activa = fuente === opt.id
              const valorSugerido = tasasDisponibles[opt.id]
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => elegirFuente(opt.id)}
                  className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-xl border px-2 py-1.5 text-xs font-bold transition-colors ${
                    activa ? 'border-primary bg-primary text-white shadow-xs' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.id !== 'MANUAL' && valorSugerido > 0 && (
                    <span className={`truncate text-[10px] font-mono ${activa ? 'text-white/85' : 'text-slate-400'}`}>
                      {fmt(valorSugerido)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <label className="block text-xs font-bold text-slate-700">
            Tasa aplicada (Bs por $1 USD)
            <input
              type="text"
              inputMode="decimal"
              value={tasaTexto}
              disabled={cerrar.isPending}
              onChange={e => { setTasaManualInput(e.target.value); setError('') }}
              placeholder="Ej.: 450.50"
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-[16px] font-mono font-black text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 sm:text-sm"
            />
          </label>

          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="min-w-0">
              <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-emerald-700">Total neto a pagar</span>
              <strong className="block truncate text-lg font-black tabular-nums text-emerald-900">${fmt(resumen.neto)} USD</strong>
            </div>
            <div className="min-w-0 text-right">
              <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-emerald-700">Equivalente en Bs</span>
              <strong className="block truncate font-mono text-base font-black tabular-nums text-emerald-800">
                {tasaNumero > 0 ? formatBs(resumen.neto * tasaNumero) : 'Ingresa una tasa'}
              </strong>
            </div>
          </div>
        </div>

        {jornadasAbiertas && (
          <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
            <p className="font-bold">
              Hay {jornadasAbiertas.total} registro(s) con entrada sin salida. Puedes confirmar para cerrar sin pagar esos registros incompletos.
            </p>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => confirmar(true)}
              className="min-h-11 rounded-xl bg-amber-700 px-3.5 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              Cerrar sin pagar registros incompletos
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">
            <AlertCircle size={15} className="shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

function DatoResumen({ label, value, sub = null, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
  }
  return (
    <div className={`min-w-0 rounded-xl border p-2.5 ${tones[tone]}`}>
      <span className="block truncate text-[10px] font-bold uppercase tracking-wide opacity-75">{label}</span>
      <strong className="mt-0.5 block truncate text-sm font-black tabular-nums">{value}</strong>
      {sub && <span className="block truncate text-[10px] font-bold opacity-80">{sub}</span>}
    </div>
  )
}
