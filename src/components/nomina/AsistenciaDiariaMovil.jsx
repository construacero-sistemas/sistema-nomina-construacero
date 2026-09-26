// src/components/nomina/AsistenciaDiariaMovil.jsx
// Registro manual previsto para nómina, separado del marcaje real del reloj.
import { useMemo, useState } from 'react'
import { CalendarClock, Check, ChevronLeft, ChevronRight, Clock3, Search, Sparkles, UserX } from 'lucide-react'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { formatRangoHoras12 } from '../../utils/timeUtils.js'
import { trabajaEseDia } from '../../utils/diasLaborables.js'
import { fechaOperativaHoy } from '../../utils/fechaOperativa.js'

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
  // La carga masiva (POST /nomina/asistencia/registrar-masivo) exige
  // `gestionarUsuarios` en el servidor; `esAdmin` (administrarNomina) basta para
  // registrar o editar un día a la vez, que es lo que sí puede el rol `nomina`.
  puedeGestionarNomina = false,
  onAbrirDetalle,
  onAbrirMasivo,
}) {
  const [filtro, setFiltro] = useState('pendientes')
  const [busqueda, setBusqueda] = useState('')

  const fechaObj = useMemo(() => new Date(`${fechaSeleccionada}T12:00:00`), [fechaSeleccionada])
  const dow = fechaObj.getDay()
  const esSabado = dow === 6
  const esDomingo = dow === 0
  // Fecha operativa (America/Caracas), no la del navegador: es la misma que usa el
  // servidor para decidir la fecha del marcaje (F-13).
  const hoyIso = fechaOperativaHoy()
  const esHoy = fechaSeleccionada === hoyIso

  // Feriado NO laborable: nadie está obligado a asistir, así que se comporta como el
  // día libre y no pide registro (F-6). Un feriado laborable sí es un día pendiente.
  const feriadoNoLaborable = Boolean(feriadoDelDia && feriadoDelDia.laborable === false)

  const filas = useMemo(() => empleados.map(empleado => {
    const registro = registrosPorEmpleado?.get(`${empleado.empleado_id}|${fechaSeleccionada}`) || null
    const real = esMarcajeReal(registro)
    const falta = Boolean(registro?.es_ausencia)
    // Sin registro en un día que no le toca (p. ej. el sábado de quien no viene)
    // no es un pendiente: es su día libre.
    const libre = !registro && (feriadoNoLaborable || !trabajaEseDia(empleado, fechaSeleccionada))
    return {
      empleado,
      registro,
      real,
      falta,
      libre,
      feriado: feriadoNoLaborable,
      pendiente: !libre && (!registro || real),
      nombre: capitalizarPalabras(empleado.empleado?.nombre) || 'Sin nombre',
    }
  }), [empleados, registrosPorEmpleado, fechaSeleccionada, feriadoNoLaborable])

  const conteos = useMemo(() => filas.reduce((totales, fila) => {
    if (fila.real) totales.reales += 1
    if (fila.libre) totales.libres += 1
    else if (fila.pendiente && !fila.real) totales.pendientes += 1
    else if (fila.falta) totales.faltas += 1
    else if (!fila.real) totales.registrados += 1
    return totales
  }, { pendientes: 0, registrados: 0, faltas: 0, reales: 0, libres: 0 }), [filas])

  const visibles = useMemo(() => {
    const termino = normalizar(busqueda)
    return filas.filter(fila => {
      if (filtro === 'pendientes' && !fila.pendiente) return false
      // «Registrados» es un día con registro (manual o del reloj): el día libre de
      // quien no trabaja esa fecha tiene su propio filtro y no debe aparecer aquí.
      if (filtro === 'registrados' && (fila.libre || fila.pendiente || fila.falta) && !fila.real) return false
      if (filtro === 'faltas' && !fila.falta) return false
      if (filtro === 'libres' && !fila.libre) return false
      return !termino || normalizar(`${fila.nombre} ${fila.empleado.cargo || ''}`).includes(termino)
    })
  }, [filas, filtro, busqueda])

  const idsMasivos = filas.filter(fila => fila.pendiente && !fila.real).map(fila => fila.empleado.empleado_id)

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
          <p><strong>Asistencia manual para nómina.</strong> Registra horario previsto; la hora real se marca en “Marcaje real”.</p>
        </div>
        {puedeGestionarNomina && !esDomingo && empleados.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-sky-200 pt-2">
            <p className="text-[11px] font-semibold text-sky-950">
              {conteos.pendientes} pendientes · {conteos.registrados} manuales · {conteos.faltas} faltas{conteos.reales ? ` · ${conteos.reales} marcajes reales` : ''}{conteos.libres ? ` · ${conteos.libres} en día libre` : ''}
            </p>
            <button type="button" onClick={() => onAbrirMasivo?.({ fecha: fechaSeleccionada, empleadoIds: idsMasivos })}
              disabled={!idsMasivos.length}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-sky-900 px-3 text-xs font-black text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ touchAction: 'manipulation' }}>
              <Sparkles size={14} aria-hidden="true" />
              Aplicar a {idsMasivos.length} pendientes
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="group" aria-label="Filtrar asistencia manual">
        {[
          { id: 'pendientes', label: 'Pendientes', count: conteos.pendientes },
          { id: 'registrados', label: 'Registrados', count: conteos.registrados + conteos.reales },
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
            : filtro === 'pendientes'
              ? 'No hay asistencias pendientes para esta fecha.'
              : filtro === 'faltas'
                ? 'No hay faltas registradas para esta fecha.'
                : filtro === 'libres'
                  ? 'Nadie tiene este día libre según su ficha.'
                  : 'No hay registros de asistencia para esta fecha.'}
        </p>
      ) : (
        <div className="space-y-2" role="list" aria-label="Personal y asistencia manual del día">
          {visibles.map(({ empleado, registro, real, falta, libre, feriado, pendiente, nombre }) => {
            const estadoTexto = real
              ? 'Marcaje real del reloj'
              : falta ? 'Falta registrada'
                : libre ? (feriado ? 'Feriado no laborable' : 'Día libre')
                  : pendiente ? 'Pendiente' : 'Horario manual registrado'
            return (
              <article key={empleado.empleado_id} role="listitem"
                className={`rounded-2xl border bg-white p-3 shadow-xs ${falta ? 'border-rose-200' : real ? 'border-violet-200' : libre ? 'border-slate-200' : pendiente ? 'border-amber-200' : 'border-emerald-200'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-black text-slate-900">{nombre}</h4>
                    <p className="truncate text-xs text-slate-500">{empleado.cargo || 'Personal'}</p>
                  </div>
                  <span className={`inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-bold ${real ? 'bg-violet-50 text-violet-800' : falta ? 'bg-rose-50 text-rose-800' : libre ? 'bg-slate-100 text-slate-600' : pendiente ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
                    {real ? <Clock3 size={12} aria-hidden="true" /> : falta ? <UserX size={12} aria-hidden="true" /> : !pendiente && !libre ? <Check size={12} aria-hidden="true" /> : null}
                    {estadoTexto}
                  </span>
                </div>
                {registro && !falta && (registro.hora_entrada || registro.hora_salida) && (
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600">
                    {registro.hora_entrada && <span>Entrada <strong>{formatRangoHoras12(registro.hora_entrada, null)}</strong></span>}
                    {registro.hora_salida && <span>Salida <strong>{formatRangoHoras12(null, registro.hora_salida)}</strong></span>}
                    {Number(registro.horas_trabajadas) > 0 && <span>{Number(registro.horas_trabajadas).toFixed(1)} h efectivas</span>}
                  </div>
                )}
                {real ? (
                  <p className="mt-2 text-xs text-violet-800">Este registro se consulta y corrige desde la vista “Marcaje real”; no se sobrescribe como horario manual.</p>
                ) : esAdmin && (
                  <button type="button" onClick={() => onAbrirDetalle({ empleado, fecha: fechaSeleccionada, registro, feriado: feriadoDelDia })}
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                    style={{ touchAction: 'manipulation' }}>
                    {pendiente ? 'Registrar asistencia' : 'Editar asistencia'}
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
