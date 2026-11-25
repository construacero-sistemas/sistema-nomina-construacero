// src/components/nomina/AsistenciaDiariaMovil.jsx
// Registro manual previsto para nómina, separado del marcaje real del reloj.
import { useMemo, useState } from 'react'
import { CalendarClock, Check, ChevronLeft, ChevronRight, Clock3, Search, UserX } from 'lucide-react'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { formatRangoHoras12 } from '../../utils/timeUtils.js'
import { trabajaEseDia } from '../../utils/diasLaborables.js'
import { fechaOperativaHoy } from '../../utils/fechaOperativa.js'
import { esDiaPresentePresunto, horarioEfectivoDelDia } from '../../../server/lib/asistenciaExcepciones.js'

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function esMarcajeReal(registro) {
  return ['entrada', 'completo', 'corregido'].includes(registro?.estado_marcaje)
}

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
}

export default function AsistenciaDiariaMovil({
  empleados = [],
  registrosPorEmpleado,
  feriadoDelDia,
  fechaSeleccionada,
  onCambiarFecha,
  diasSemana = [],
  onMoverSemana,
  onIrHoy,
  esAdmin,
  puedeGestionarNomina = false,
  onAbrirDetalle,
}) {
  const [filtro, setFiltro] = useState('presentes')
  const [busqueda, setBusqueda] = useState('')

  const fechaObj = useMemo(() => new Date(`${fechaSeleccionada}T12:00:00`), [fechaSeleccionada])
  const dow = fechaObj.getDay()
  const esDomingo = dow === 0
  const hoyIso = fechaOperativaHoy()
  const esHoy = fechaSeleccionada === hoyIso
  const feriadoNoLaborable = Boolean(feriadoDelDia && feriadoDelDia.laborable === false)

  const filas = useMemo(() => empleados.map(empleado => {
    const registro = registrosPorEmpleado?.get(`${empleado.empleado_id}|${fechaSeleccionada}`) || null
    const real = esMarcajeReal(registro)
    const falta = Boolean(registro?.es_ausencia)
    const libre = !registro && (feriadoNoLaborable || !trabajaEseDia(empleado, fechaSeleccionada))
    const presunto = esDiaPresentePresunto({ empleado, fecha: fechaSeleccionada, registro, feriado: feriadoDelDia })
    const horario = horarioEfectivoDelDia(empleado, fechaSeleccionada)
    return {
      empleado,
      registro,
      real,
      falta,
      libre,
      presunto,
      horario,
      feriado: feriadoNoLaborable,
      nombre: capitalizarPalabras(empleado.empleado?.nombre) || 'Sin nombre',
    }
  }), [empleados, registrosPorEmpleado, fechaSeleccionada, feriadoNoLaborable, feriadoDelDia])

  const conteos = useMemo(() => filas.reduce((totales, fila) => {
    if (fila.real) totales.reales += 1
    if (fila.libre) totales.libres += 1
    else if (fila.falta) totales.faltas += 1
    else if (fila.registro) {
      totales.registrados += 1
      totales.presentes += 1
    } else if (fila.presunto) {
      totales.presentes += 1
    }
    return totales
  }, { presentes: 0, registrados: 0, faltas: 0, reales: 0, libres: 0 }), [filas])

  const visibles = useMemo(() => {
    const termino = normalizar(busqueda)
    return filas.filter(fila => {
      if (filtro === 'presentes' && (fila.libre || fila.falta || (!fila.presunto && !fila.registro))) return false
      if (filtro === 'registrados' && !fila.registro) return false
      if (filtro === 'faltas' && !fila.falta) return false
      if (filtro === 'libres' && !fila.libre) return false
      return !termino || normalizar(`${fila.nombre} ${fila.empleado.cargo || ''}`).includes(termino)
    })
  }, [filas, filtro, busqueda])

  return (
    <section className="space-y-3" aria-labelledby="asistencia-manual-title">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => onMoverSemana(-1)} aria-label="Semana anterior"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
            style={{ touchAction: 'manipulation' }}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <div className="min-w-0 text-center">
            <h3 id="asistencia-manual-title" className="truncate text-sm font-black capitalize text-slate-900">
              {fechaObj.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
            {esHoy && <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Hoy</span>}
          </div>
          <button type="button" onClick={() => onMoverSemana(1)} aria-label="Semana siguiente"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
            style={{ touchAction: 'manipulation' }}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          {!esHoy && (
            <button type="button" onClick={onIrHoy}
              className="min-h-11 shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-800">
              Hoy
            </button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1" aria-label="Elegir fecha de asistencia">
          {diasSemana.map(d => {
            const fechaDia = iso(d)
            const seleccionado = fechaDia === fechaSeleccionada
            const hoyDia = fechaDia === hoyIso
            const dowDia = d.getDay()
            return (
              <button key={fechaDia} type="button" onClick={() => onCambiarFecha(fechaDia)}
                aria-pressed={seleccionado} aria-label={`${DIAS_CORTOS[dowDia]} ${d.getDate()}${hoyDia ? ', hoy' : ''}`}
                style={{ touchAction: 'manipulation' }}
                className={`flex min-h-11 flex-col items-center justify-center rounded-xl text-center ${seleccionado ? 'bg-primary font-black text-white' : hoyDia ? 'border border-emerald-300 bg-emerald-50 font-bold text-emerald-800' : 'bg-slate-50 text-slate-600'}`}>
                <span className="text-[9px] uppercase leading-none">{DIAS_CORTOS[dowDia]}</span>
                <span className="mt-0.5 text-xs">{d.getDate()}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2.5">
        <div className="flex items-start gap-2 text-xs leading-relaxed text-sky-950">
          <CalendarClock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p><strong>Asistencia por día.</strong> Todo trabajador en día hábil cuenta como presente; registra aquí excepciones o días pasados.</p>
        </div>
        {puedeGestionarNomina && !esDomingo && empleados.length > 0 && (
          <div className="mt-2 border-t border-sky-200 pt-2">
            <p className="text-[11px] font-semibold text-sky-950">
              {conteos.presentes} presentes · {conteos.registrados} con excepción · {conteos.faltas} faltas{conteos.reales ? ` · ${conteos.reales} marcajes reloj` : ''}{conteos.libres ? ` · ${conteos.libres} en día libre` : ''}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="group" aria-label="Filtrar asistencia manual">
        {[
          { id: 'presentes', label: 'Presentes', count: conteos.presentes },
          { id: 'registrados', label: 'Excepciones', count: conteos.registrados + conteos.reales },
          { id: 'faltas', label: 'Faltas', count: conteos.faltas },
          { id: 'libres', label: 'Día libre', count: conteos.libres },
        ].map(item => {
          const seleccionado = filtro === item.id
          return (
            <button key={item.id} type="button" onClick={() => setFiltro(item.id)} aria-pressed={seleccionado}
              className={`min-h-11 rounded-xl border px-1 text-[11px] font-bold ${seleccionado ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
              {item.label} <span className={seleccionado ? 'text-white/70' : 'text-slate-400'}>{item.count}</span>
            </button>
          )
        })}
      </div>

      <label className="relative block">
        <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <span className="sr-only">Buscar empleado por nombre o cargo</span>
        <input type="search" value={busqueda} onChange={event => setBusqueda(event.target.value)}
          placeholder="Buscar empleado o cargo" autoComplete="off"
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-3 text-[16px] text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
      </label>

      {visibles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
          {busqueda
            ? 'No hay personas que coincidan con la búsqueda y el filtro.'
            : filtro === 'presentes'
              ? 'No hay trabajadores presentes para esta fecha.'
              : filtro === 'faltas'
                ? 'No hay faltas registradas para esta fecha.'
                : filtro === 'libres'
                  ? 'Nadie tiene este día libre según su ficha.'
                  : 'No hay registros de asistencia para esta fecha.'}
        </p>
      ) : (
        <div className="space-y-2" role="list" aria-label="Personal y asistencia del día">
          {visibles.map(({ empleado, registro, real, falta, libre, presunto, horario, feriado, nombre }) => {
            const estadoTexto = real
              ? 'Marcaje real del reloj'
              : falta ? (registro?.ausencia_justificada ? 'Falta con justificativo (se paga)' : 'Falta sin justificativo')
                : libre ? (feriado ? 'Feriado no laborable' : 'Día libre')
                  : registro ? 'Excepción / ajuste registrado' : 'Presente por defecto'
            return (
              <article key={empleado.empleado_id} role="listitem"
                className={`rounded-2xl border bg-white p-3 shadow-xs ${falta ? 'border-rose-200' : real ? 'border-violet-200' : libre ? 'border-slate-200' : 'border-emerald-200'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-black text-slate-900">{nombre}</h4>
                    <p className="truncate text-xs text-slate-500">{empleado.cargo || 'Personal'}</p>
                  </div>
                  <span className={`inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-bold ${real ? 'bg-violet-50 text-violet-800' : falta ? 'bg-rose-50 text-rose-800' : libre ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-800'}`}>
                    {real ? <Clock3 size={12} aria-hidden="true" /> : falta ? <UserX size={12} aria-hidden="true" /> : !libre ? <Check size={12} aria-hidden="true" /> : null}
                    {estadoTexto}
                  </span>
                </div>
                {!falta && !libre && (
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600">
                    {registro?.hora_entrada ? (
                      <>
                        <span>Entrada <strong>{formatRangoHoras12(registro.hora_entrada, null)}</strong></span>
                        {registro.hora_salida && <span>Salida <strong>{formatRangoHoras12(null, registro.hora_salida)}</strong></span>}
                        {Number(registro.horas_extra) > 0 && <strong className="text-amber-700">+{Number(registro.horas_extra)} h extra</strong>}
                      </>
                    ) : presunto && (
                      <span>Horario <strong>{formatRangoHoras12(horario.horaInicio, horario.horaFin)}</strong> ({horario.horasJornada}h)</span>
                    )}
                  </div>
                )}
                {real ? (
                  <p className="mt-2 text-xs text-violet-800">Este registro histórico se consulta en el detalle.</p>
                ) : esAdmin && (
                  <button type="button" onClick={() => onAbrirDetalle({ empleado, fecha: fechaSeleccionada, registro, feriado: feriadoDelDia })}
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                    style={{ touchAction: 'manipulation' }}>
                    {registro ? 'Editar excepción' : (libre ? 'Marcar día trabajado' : 'Registrar horas extras / falta')}
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
