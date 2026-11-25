// src/components/nomina/MarcajeLogisticaPanel.jsx
// Asistencia de hoy (gestión por excepción): todo empleado en día laborable
// aparece Presente por defecto según su horario; solo se marcan horas extras,
// ausencias o días de descanso/feriado trabajados.
import { useMemo, useState } from 'react'
import { CalendarDays, Clock3, Lock, RefreshCw, Search, X } from 'lucide-react'
import useAuthStore from '../../../compat/store/useAuthStore.js'
import { tieneCapacidad } from '../../config/accesoModulos.js'
import {
  useConfigNomina, useMarcajeHoy, useMarcarAusencia, useMarcarDiaTrabajado, useRegistrarHorasExtra,
} from '../../hooks/useNomina'
import TarjetaMarcaje from './marcaje/TarjetaMarcaje.jsx'
import useAccionesMarcaje from './marcaje/useAccionesMarcaje.js'
import useOrdenEstable from './marcaje/useOrdenEstable.js'
import {
  FILTROS, estadoDelRegistro, fechaLegible, nombreEmpleado, normalizarBusqueda,
} from './marcaje/marcajeEstado.js'
import { trabajaEseDia } from '../../utils/diasLaborables.js'
import { fechaOperativaHoy } from '../../utils/fechaOperativa.js'

const ES_NOVEDAD = new Set(['extra', 'ausencia', 'descanso-trabajado'])

export default function MarcajeLogisticaPanel({
  empleados = [],
  feriadosPorFecha = null,
  empleadosCargando = false,
  empleadosError = false,
  empleadosActualizando = false,
  onReintentarEmpleados,
  periodoParaCerrar = null,
  onCerrarPeriodo = null,
}) {
  const perfil = useAuthStore(state => state.perfil)
  const puedeMarcar = tieneCapacidad(perfil, 'administrarNomina')
  const { data, isLoading, isFetching, isError, refetch } = useMarcajeHoy()
  const registrarHorasExtra = useRegistrarHorasExtra()
  const marcarDiaTrabajado = useMarcarDiaTrabajado()
  const marcarAusencia = useMarcarAusencia()
  const { data: configNomina } = useConfigNomina()
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [soloNovedades, setSoloNovedades] = useState(false)
  const [semillaOrden, setSemillaOrden] = useState(0)

  const registros = useMemo(
    () => new Map((data?.registros || []).map(registro => [registro.empleado_id, registro])),
    [data?.registros],
  )

  const fechaMarcaje = data?.fecha ?? null
  const feriadoDeHoy = useMemo(
    () => (fechaMarcaje ? (feriadosPorFecha?.get(fechaMarcaje) || null) : null),
    [feriadosPorFecha, fechaMarcaje],
  )
  const filas = useMemo(() => (empleados || []).map(empleado => {
    const registro = registros.get(empleado.empleado_id) || null
    const libre = Boolean(fechaMarcaje) && !trabajaEseDia(empleado, fechaMarcaje)
    const feriadoNoLaborable = Boolean(feriadoDeHoy && feriadoDeHoy.laborable === false)
    return {
      empleado, registro, libre, feriado: feriadoDeHoy,
      estado: estadoDelRegistro(registro, libre || feriadoNoLaborable),
      nombre: nombreEmpleado(empleado),
    }
  }), [empleados, registros, fechaMarcaje, feriadoDeHoy])

  const conteos = useMemo(() => filas.reduce((totales, fila) => {
    totales[fila.estado] += 1
    return totales
  }, { presente: 0, extra: 0, ausencia: 0, libre: 0, 'descanso-trabajado': 0 }), [filas])

  const filtroActual = filtro ?? 'todos'
  const termino = normalizarBusqueda(busqueda)
  const { ordenar, recientes, marcarReciente } = useOrdenEstable(filas, `${semillaOrden}|${filtroActual}|${termino}|${soloNovedades}`)
  const filtroActivo = FILTROS.find(item => item.id === filtroActual)

  const listaVisible = ordenar(filas
    .filter(fila => {
      if (recientes.has(fila.empleado.empleado_id)) return true
      if (soloNovedades && !ES_NOVEDAD.has(fila.estado)) return false
      if (filtroActivo?.estados) return filtroActivo.estados.includes(fila.estado)
      if (filtroActivo?.estado) return fila.estado === filtroActivo.estado
      return true
    })
    .filter(fila => !termino || normalizarBusqueda(`${fila.nombre} ${fila.empleado.cargo || ''}`).includes(termino)))

  const consultaEnCurso = isLoading || isFetching || empleadosCargando || empleadosActualizando
  const consultaConError = isError || empleadosError
  const bloqueoGlobal = isLoading || empleadosCargando || consultaConError || !data?.fecha || data.fecha !== fechaOperativaHoy()

  const acciones = useAccionesMarcaje({
    filas,
    bloqueoGlobal,
    horasExtraMut: registrarHorasExtra,
    diaTrabajadoMut: marcarDiaTrabajado,
    ausenciaMut: marcarAusencia,
    onExito: marcarReciente,
  })

  if (!puedeMarcar) return null

  function actualizar() {
    acciones.limpiarError()
    setSemillaOrden(valor => valor + 1)
    void refetch()
    if (onReintentarEmpleados) void onReintentarEmpleados()
  }

  return (
    <section aria-labelledby="marcaje-real-title" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 lg:p-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock3 size={19} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 id="marcaje-real-title" className="text-base font-black text-slate-900">Asistencia de hoy</h3>
            <p className="text-xs capitalize text-slate-500">{fechaLegible(data?.fecha)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSoloNovedades(valor => !valor)}
            aria-pressed={soloNovedades}
            title={soloNovedades ? 'Mostrar todo el personal' : 'Mostrar solo horas extras, ausencias y descansos trabajados'}
            className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-xs font-bold ${soloNovedades ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-slate-200 bg-white text-slate-700'}`}
            style={{ touchAction: 'manipulation' }}
          >
            {soloNovedades ? 'Ver todos' : 'Solo novedades'}
          </button>
          <button
            type="button"
            onClick={actualizar}
            disabled={consultaEnCurso}
            aria-label="Actualizar asistencia y empleados"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-wait disabled:opacity-60"
            style={{ touchAction: 'manipulation' }}
          >
            <RefreshCw size={15} className={consultaEnCurso ? 'animate-spin' : ''} aria-hidden="true" />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>
      </div>

      <p className="mt-2 text-sm leading-snug text-slate-600">
        Todos los trabajadores en su día laborable están <strong>presentes por defecto</strong> según su horario. Marca solo excepciones: <strong>horas extras</strong>, <strong>ausencias</strong> o <strong>días de descanso trabajados</strong>.
      </p>

      {periodoParaCerrar && onCerrarPeriodo && (
        <div role="region" aria-label="Cierre del período disponible" className="mt-2.5 flex flex-col gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-bold leading-relaxed text-emerald-950">
            Último día o cierre pendiente de <strong>{periodoParaCerrar.nombre}</strong>. Revisa el resumen semanal y confirma la tasa de pago.
          </p>
          <button
            type="button"
            onClick={() => onCerrarPeriodo(periodoParaCerrar)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 text-xs font-black text-white shadow-xs transition-colors hover:bg-emerald-800"
            style={{ touchAction: 'manipulation' }}
          >
            <Lock size={14} aria-hidden="true" />
            Revisar y cerrar período
          </button>
        </div>
      )}

      {feriadoDeHoy && (
        <p className="mt-2 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-relaxed text-violet-950">
          <CalendarDays size={15} className="mt-0.5 shrink-0 text-violet-700" aria-hidden="true" />
          <span>
            <strong>Feriado{feriadoDeHoy.nombre ? `: ${feriadoDeHoy.nombre}` : ''}</strong>
            {feriadoDeHoy.laborable === false
              ? ' — no es laborable: si alguien vino a trabajar, márcalo como día trabajado.'
              : ' — laborable: asistencia activa por defecto con recargo de feriado.'}
          </span>
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Resumen de asistencia de hoy">
        <ResumenEstado label="Presentes" count={conteos.presente + conteos.extra} color="emerald" />
        <ResumenEstado label="Con extras" count={conteos.extra} color="amber" />
        <ResumenEstado label="Ausencias" count={conteos.ausencia} color="rose" />
        <ResumenEstado label="Descanso" count={conteos.libre} color="slate" />
        <ResumenEstado label="Trab. descanso" count={conteos['descanso-trabajado']} color="violet" />
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-center">
        <label className="relative block min-w-0">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Buscar empleado por nombre o cargo</span>
          <input
            type="search"
            value={busqueda}
            onChange={event => setBusqueda(event.target.value)}
            placeholder="Buscar empleado o cargo"
            autoComplete="off"
            className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-3 text-[16px] text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 sm:text-sm"
          />
        </label>
        {busqueda && (
          <button
            type="button"
            onClick={() => setBusqueda('')}
            className="min-h-11 justify-self-start rounded-xl px-3 text-sm font-bold text-slate-600 hover:bg-slate-100 sm:justify-self-auto"
            style={{ touchAction: 'manipulation' }}
          >
            <X size={14} className="mr-1 inline" aria-hidden="true" />Limpiar búsqueda
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap" role="group" aria-label="Filtrar asistencia por estado">
        {FILTROS.map(item => {
          const count = item.estados
            ? item.estados.reduce((sum, e) => sum + (conteos[e] || 0), 0)
            : item.estado ? (conteos[item.estado] || 0) : filas.length
          const seleccionado = filtroActual === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setFiltro(item.id)}
              aria-pressed={seleccionado}
              className={`inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border px-1.5 text-[11px] font-bold transition-colors sm:w-auto sm:gap-1.5 sm:px-3 sm:text-xs ${
                seleccionado
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              style={{ touchAction: 'manipulation' }}
            >
              <span>{item.label}</span>
              <span className={seleccionado ? 'text-white/75' : 'text-slate-400'}>{count}</span>
            </button>
          )
        })}
      </div>

      {data?.fecha && data.fecha !== fechaOperativaHoy() && !consultaConError && (
        <div role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          La fecha operativa cambió. Actualiza la lista antes de continuar.
          <button type="button" onClick={actualizar} className="ml-2 min-h-11 rounded-lg border border-amber-300 bg-white px-3 font-bold" style={{ touchAction: 'manipulation' }}>
            Actualizar
          </button>
        </div>
      )}

      {consultaConError && (
        <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <p>No se pudieron actualizar los datos de hoy. Para evitar errores, las acciones están pausadas hasta que actualices.</p>
          <button type="button" onClick={actualizar} className="mt-2 min-h-11 rounded-lg border border-rose-300 bg-white px-3 font-bold" style={{ touchAction: 'manipulation' }}>
            Volver a intentar
          </button>
        </div>
      )}

      {acciones.error && (
        <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          {acciones.error}
        </div>
      )}

      {(consultaEnCurso && !filas.length) || (!fechaMarcaje && !consultaConError) ? (
        <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2" aria-label="Cargando empleados y asistencia" aria-busy="true">
          {[0, 1].map(item => <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      ) : !consultaConError && !filas.length ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          No hay empleados activos configurados en Nómina.
        </p>
      ) : !consultaConError && !listaVisible.length ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          {soloNovedades ? 'Hoy no hay novedades registradas (todos siguen su horario habitual).' : 'No hay empleados que coincidan con esta búsqueda y filtro.'}
        </p>
      ) : (
        <div role="list" className="mt-3 grid min-w-0 grid-cols-1 gap-2.5 lg:grid-cols-2" aria-label="Lista de asistencia de hoy" aria-busy={acciones.hayPendientes}>
          {listaVisible.map(fila => (
            <TarjetaMarcaje
              key={fila.empleado.empleado_id}
              fila={fila}
              fecha={fechaMarcaje}
              horasDescansoDefault={configNomina?.nomina_horas_descanso ?? 1}
              {...acciones.estadoTarjeta(fila.empleado.empleado_id)}
              onHorasExtra={acciones.registrarHorasExtra}
              onDiaTrabajado={acciones.marcarDiaTrabajado}
              onAusencia={acciones.marcarAusencia}
            />
          ))}
        </div>
      )}
      <p aria-live="polite" className="sr-only">{acciones.anuncio}</p>
    </section>
  )
}

function ResumenEstado({ label, count, color }) {
  const colors = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
    violet: 'border-violet-200 bg-violet-50 text-violet-900',
  }
  return (
    <div className={`min-w-0 rounded-xl border px-2.5 py-2 ${colors[color]}`}>
      <span className="block truncate text-[11px] font-semibold">{label}</span>
      <strong className="mt-0.5 block text-base leading-tight tabular-nums">{count}</strong>
    </div>
  )
}
