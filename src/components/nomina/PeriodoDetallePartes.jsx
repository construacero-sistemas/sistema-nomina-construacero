// src/components/nomina/PeriodoDetallePartes.jsx
// Piezas del detalle del período (separadas para respetar el límite de 600 líneas):
// formato, tarjeta de recibo en móvil y aviso del cálculo automático.
import { AlertTriangle, CheckCircle2, FileText, RefreshCw, RotateCcw } from 'lucide-react'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import useReglasLey from '../../hooks/useReglasLey.js'
import { VENDEDORES_EN_NOMINA } from '../../config/comisionesVendedores.js'
import { fmt, revertible, textoDias } from './periodoDetalleUtils.js'

export function ResumenDato({ label, value, emphasis = false }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-100 bg-white px-2.5 py-2">
      <span className="block text-[10px] font-semibold text-slate-500">{label}</span>
      <span className={`block truncate tabular-nums ${emphasis ? 'text-sm font-black text-primary' : 'text-xs font-bold text-slate-800'}`}>{value}</span>
    </div>
  )
}

export function ReciboMovilCard({ linea, abierto, puedeGestionarNomina, puedePagarNomina, fmtBs, onDescargar, onAjustar, onPagar, onRevertir }) {
  const nombre = capitalizarPalabras(linea.empleado?.nombre) || '—'
  const recargos = Number(linea.monto_extra_usd || 0) + Number(linea.monto_sabado_usd || 0) + Number(linea.monto_feriado_usd || 0)
  const neto = Number(linea.total_neto_usd || 0)
  const mostrarBsCongelados = linea.pagado && Number(linea.tasa_pago_usd_ves) > 0
  const { divisorMensual } = useReglasLey()

  return (
    <article aria-label={`Recibo de ${nombre}`} className={`rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${linea.pagado ? 'border-l-4 border-l-emerald-500' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-black text-slate-800">{nombre}</h3>
          {linea.cargo_snap && <p className="text-[11px] font-medium text-slate-500">{linea.cargo_snap}</p>}
          <p className="text-[10px] text-slate-500">Sueldo mensual: ${fmt(Number(linea.salario_dia_usd_snap || 0) * divisorMensual)}</p>
        </div>
        {linea.pagado && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-800">Pagado</span>}
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
        <ResumenDato label="Días" value={textoDias(linea)} />
        <ResumenDato label="Horas normales" value={`${Number(linea.horas_normales || 0).toFixed(1)}h`} />
        <ResumenDato label="Base" value={`$${fmt(linea.monto_normal_usd)}`} />
        <div className="min-w-0 rounded-lg border border-primary/20 bg-primary/[0.04] px-2.5 py-2">
          <span className="block text-[10px] font-semibold text-primary/75">Neto · USD</span>
          <span className="block truncate text-sm font-black tabular-nums text-primary">${fmt(neto)}</span>
          <span className="block truncate text-[10px] font-semibold tabular-nums text-slate-600" title={mostrarBsCongelados ? `Tasa congelada al pagar: ${Number(linea.tasa_pago_usd_ves)} Bs/$` : 'Calculado con la tasa activa'}>
            {mostrarBsCongelados
              ? `${Number(linea.total_pagado_bs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`
              : fmtBs(neto)}
          </span>
        </div>
      </div>

      <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2 text-xs">
        <div className="flex justify-between gap-2"><dt className="text-slate-500">H. extra</dt><dd className="font-semibold text-slate-800">{Number(linea.horas_extra) > 0 ? `${Number(linea.horas_extra).toFixed(1)}h` : '—'}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-slate-500">Recargos</dt><dd className="font-semibold text-slate-800">{recargos > 0 ? `$${fmt(recargos)}` : '—'}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-slate-500">Bonos</dt><dd className="font-semibold text-emerald-700">{Number(linea.bonos_usd) > 0 ? `+$${fmt(linea.bonos_usd)}` : '—'}</dd></div>
        {(VENDEDORES_EN_NOMINA || Number(linea.comisiones_pos_usd) > 0) && <div className="flex justify-between gap-2"><dt className="text-slate-500">Comis. POS</dt><dd className="font-semibold text-amber-800">{Number(linea.comisiones_pos_usd) > 0 ? `+$${fmt(linea.comisiones_pos_usd)}` : '—'}</dd></div>}
        <div className="flex justify-between gap-2"><dt className="text-slate-500">Deducciones</dt><dd className="font-semibold text-rose-700">{Number(linea.deducciones_usd) > 0 ? `-$${fmt(linea.deducciones_usd)}` : '—'}</dd></div>
        {Number(linea.dias_ausencia) > 0 && <div className="flex justify-between gap-2"><dt className="text-slate-500">Ausencias</dt><dd className="font-bold text-rose-700">{linea.dias_ausencia}</dd></div>}
      </dl>

      <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t border-slate-100 pt-2">
        <button type="button" onClick={() => onDescargar(linea)} aria-label={`Descargar recibo PDF de ${nombre}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100">
          <FileText size={15} /> Recibo PDF
        </button>
        {puedeGestionarNomina && abierto && !linea.pagado && <button type="button" onClick={() => onAjustar(linea)} className="min-h-11 rounded-lg px-2.5 text-xs font-bold text-sky-800 hover:bg-sky-50">Ajustar</button>}
        {puedePagarNomina && !abierto && !linea.pagado && <button type="button" onClick={() => onPagar(linea)} className="min-h-11 rounded-lg bg-primary px-3 text-xs font-bold text-white">Pagar</button>}
        {puedePagarNomina && revertible(linea) && <button type="button" onClick={() => onRevertir(linea.id)} aria-label={`Revertir pago de ${nombre}`} className="min-h-11 min-w-11 rounded-lg p-2 text-rose-700 hover:bg-rose-50"><RotateCcw size={18} aria-hidden="true" /></button>}
      </div>
    </article>
  )
}

// Aviso del cálculo automático al abrir el período (sin botón: solo informa).
export function EstadoAutoCalculo({ resultado }) {
  const { estado, jornadas } = resultado
  if (estado === 'inactivo') return null
  const textos = {
    comprobando: ['border-slate-200 bg-slate-50 text-slate-600', RefreshCw, 'Poniendo los recibos al día con la asistencia…'],
    'al-dia': ['border-emerald-200 bg-emerald-50 text-emerald-800', CheckCircle2, 'Recibos y hoja al día con la asistencia.'],
    actualizado: ['border-sky-200 bg-sky-50 text-sky-800', RefreshCw, 'Recibos y hoja actualizados con la asistencia más reciente.'],
    'jornadas-abiertas': ['border-amber-200 bg-amber-50 text-amber-900', AlertTriangle, `Hay ${jornadas} jornada(s) con entrada y sin salida: los recibos no se actualizaron. Corrige el marcaje o calcula desde Períodos.`],
    error: ['border-rose-200 bg-rose-50 text-rose-800', AlertTriangle, 'No se pudieron poner al día los recibos. Usa «Calcular» en Períodos.'],
  }
  const [clases, Icono, texto] = textos[estado] || textos.error
  return (
    <p role="status" className={`flex min-w-0 items-start gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${clases}`}>
      <Icono size={14} className={`mt-0.5 shrink-0 ${estado === 'comprobando' ? 'animate-spin' : ''}`} aria-hidden="true" />
      <span className="min-w-0 break-words">{texto}</span>
    </p>
  )
}
