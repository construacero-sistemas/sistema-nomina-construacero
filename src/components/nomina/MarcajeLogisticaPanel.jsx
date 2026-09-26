// src/components/nomina/MarcajeLogisticaPanel.jsx
// Marcaje real de hoy: una acción contextual por empleado, mobile-first.
import { useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, LogIn, LogOut, PencilLine, RefreshCw, Search, Undo2, UserX, X } from 'lucide-react'
import useAuthStore from '../../../compat/store/useAuthStore.js'
import { tieneCapacidad } from '../../config/accesoModulos.js'
import {
  useAnularEntradaComoAusencia, useConfigNomina, useCorregirMarcaje, useMarcajeHoy, useMarcarAusencia, useMarcarEntrada, useMarcarSalida,
} from '../../hooks/useNomina'
import CorreccionMarcajeModal from './CorreccionMarcajeModal.jsx'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { formatHora12 } from '../../utils/timeUtils'
import { NOMBRE_DIA_CORTO, diaSemanaDeFecha, trabajaEseDia } from '../../utils/diasLaborables.js'
import { fechaOperativaHoy } from '../../utils/fechaOperativa.js'

const FILTROS = [
  { id: 'pendientes', label: 'Pendientes', estado: 'pendiente' },
  { id: 'en-curso', label: 'En jornada', estado: 'en-curso' },
  { id: 'completados', label: 'Completados', estado: 'completado' },
  { id: 'ausencias', label: 'Ausencias', estado: 'ausencia' },
  { id: 'libres', label: 'Día libre', estado: 'libre' },
  { id: 'manuales', label: 'Horarios fijos', estado: 'manual' },
  { id: 'todos', label: 'Todos', estado: null },
]

const PRIORIDAD_ESTADO = {
  pendiente: 0,
  'en-curso': 1,
  completado: 2,
  manual: 3,
  ausencia: 4,
  libre: 5,
}

// `libre`: hoy no le toca según sus días laborables (p. ej. el sábado de quien no
// viene). No es una falta: se muestra aparte y no pide acción.
function estadoDelRegistro(registro, libre = false) {
  if (registro?.es_ausencia) return 'ausencia'
  if (registro?.estado_marcaje === 'manual') return 'manual'
  if (!registro) return libre ? 'libre' : 'pendiente'
  if (!registro.hora_entrada) return 'pendiente'
  if (!registro.hora_salida) return 'en-curso'
  return 'completado'
}

function nombreEmpleado(empleado) {
  return capitalizarPalabras(empleado.empleado?.nombre || empleado.nombre) || 'Empleado sin nombre'
}

function normalizarBusqueda(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
}

function fechaLegible(fecha) {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Fecha operativa de hoy'
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-VE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function formatoHora(hora) {
  return hora ? formatHora12(hora) : '—'
}

function claseEstado(estado) {
  if (estado === 'pendiente') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (estado === 'en-curso') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (estado === 'ausencia') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (estado === 'libre') return 'border-slate-200 bg-slate-50 text-slate-600'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function etiquetaEstado(estado) {
  if (estado === 'pendiente') return 'Sin entrada'
  if (estado === 'en-curso') return 'Jornada en curso'
  if (estado === 'ausencia') return 'Ausencia registrada'
  if (estado === 'libre') return 'Día libre'
  if (estado === 'manual') return 'Horario registrado, no es reloj real'
  return 'Jornada completa'
}

// `feriadosPorFecha`: Map fecha → feriado del calendario laboral (lo entrega la
// pestaña de asistencia, que ya consulta el rango). Un feriado NO laborable se
// comporta como el día libre; uno laborable se trabaja con recargo y sí admite
// ausencia. Sin este dato el reloj real pedía asistencia en un feriado (F-6).
export default function MarcajeLogisticaPanel({
  empleados = [],
  feriadosPorFecha = null,
  empleadosCargando = false,
  empleadosError = false,
  empleadosActualizando = false,
  onReintentarEmpleados,
}) {
  const perfil = useAuthStore(state => state.perfil)
  const puedeMarcar = tieneCapacidad(perfil, 'administrarNomina')
  const { data, isLoading, isFetching, isError, refetch } = useMarcajeHoy()
  const marcarEntrada = useMarcarEntrada()
  const marcarSalida = useMarcarSalida()
  const marcarAusencia = useMarcarAusencia()
  const corregirMarcaje = useCorregirMarcaje()
  const anularEntrada = useAnularEntradaComoAusencia()
  const { data: configNomina } = useConfigNomina()
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [vistaCompacta, setVistaCompacta] = useState(false)
  const [accionPendiente, setAccionPendiente] = useState(null)
  const [registroEnCorreccion, setRegistroEnCorreccion] = useState(null)
  const [registroParaAnular, setRegistroParaAnular] = useState(null)
  const [motivoAnulacion, setMotivoAnulacion] = useState('')
  const [errorAnulacion, setErrorAnulacion] = useState('')
  const [errorAccion, setErrorAccion] = useState('')

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
    // Feriado no laborable: nadie está obligado a asistir, así que no suma pendientes
    // ni ofrece «Marcar ausente»; si alguien vino, se marca igual.
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
  }, { pendiente: 0, 'en-curso': 0, completado: 0, manual: 0, ausencia: 0, libre: 0 }), [filas])

  const listaVisible = useMemo(() => {
    const termino = normalizarBusqueda(busqueda)
    const filtroActivo = FILTROS.find(item => item.id === filtro)
    const filtroParaVista = vistaCompacta && (filtro === 'todos' || filtro === 'manuales') ? null : filtroActivo
    return filas
      .filter(fila => !vistaCompacta || fila.estado === 'pendiente' || fila.estado === 'en-curso')
      .filter(fila => !filtroParaVista?.estado || fila.estado === filtroParaVista.estado)
      .filter(fila => !termino || normalizarBusqueda(`${fila.nombre} ${fila.empleado.cargo || ''}`).includes(termino))
      .sort((a, b) => PRIORIDAD_ESTADO[a.estado] - PRIORIDAD_ESTADO[b.estado]
        || a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  }, [filas, filtro, busqueda, vistaCompacta])

  if (!puedeMarcar) return null

  const consultaEnCurso = isLoading || isFetching || empleadosCargando || empleadosActualizando
  const consultaConError = isError || empleadosError
  const bloqueado = consultaEnCurso || consultaConError || !data?.fecha || data.fecha !== fechaOperativaHoy()
    || Boolean(accionPendiente) || marcarEntrada.isPending || marcarSalida.isPending || marcarAusencia.isPending || corregirMarcaje.isPending || anularEntrada.isPending

  async function registrarMarcaje(empleadoId, tipo) {
    const fila = filas.find(item => item.empleado.empleado_id === empleadoId)
    const estado = fila?.estado ?? estadoDelRegistro(registros.get(empleadoId))
    const puedeEntrada = estado === 'pendiente' || estado === 'libre'
    if (bloqueado || (tipo === 'entrada' && !puedeEntrada) || (tipo === 'salida' && estado !== 'en-curso')) return
    setErrorAccion('')
    setAccionPendiente({ empleadoId, tipo })
    try {
      if (tipo === 'entrada') await marcarEntrada.mutateAsync({ empleadoId })
      else await marcarSalida.mutateAsync({ empleadoId })
    } catch (error) {
      setErrorAccion(error?.message || `No se pudo registrar la ${tipo}. Intenta actualizar y vuelve a probar.`)
    } finally {
      setAccionPendiente(null)
    }
  }

  async function registrarAusencia(empleadoId, quitar) {
    if (bloqueado) return
    setErrorAccion('')
    setAccionPendiente({ empleadoId, tipo: quitar ? 'quitar-ausencia' : 'ausencia' })
    try {
      await marcarAusencia.mutateAsync({ empleadoId, quitar })
    } catch (error) {
      setErrorAccion(error?.message || 'No se pudo actualizar la ausencia. Actualiza y vuelve a intentarlo.')
    } finally {
      setAccionPendiente(null)
    }
  }

  async function confirmarAnulacion() {
    if (!registroParaAnular || motivoAnulacion.trim().length < 3 || bloqueado) return
    setErrorAnulacion('')
    try {
      await anularEntrada.mutateAsync({ registroId: registroParaAnular.registro.id, motivo: motivoAnulacion.trim() })
      setRegistroParaAnular(null)
      setMotivoAnulacion('')
    } catch (error) {
      setErrorAnulacion(error?.message || 'No se pudo anular la entrada. Actualiza e inténtalo de nuevo.')
    }
  }

  function actualizar() {
    setErrorAccion('')
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
            <h3 id="marcaje-real-title" className="text-base font-black text-slate-900">Marcaje real de hoy</h3>
            <p className="text-xs capitalize text-slate-500">{fechaLegible(data?.fecha)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setVistaCompacta(valor => !valor)}
          aria-pressed={vistaCompacta}
          aria-label={vistaCompacta ? 'Mostrar todos los marcajes' : 'Mostrar solo pendientes y jornadas en curso'}
          className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-xs font-bold ${vistaCompacta ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-slate-200 bg-white text-slate-700'}`}
        >
          {vistaCompacta ? 'Ver todos' : 'Operativo'}
        </button>
        <button
          type="button"
          onClick={actualizar}
          disabled={consultaEnCurso}
          aria-label="Actualizar marcajes y empleados"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-wait disabled:opacity-60"
          style={{ touchAction: 'manipulation' }}
        >
          <RefreshCw size={15} className={consultaEnCurso ? 'animate-spin' : ''} aria-hidden="true" />
          <span className="hidden sm:inline">Actualizar</span>
        </button>
        </div>
      </div>

      <p className="mt-2 text-sm leading-snug text-slate-600">
        El servidor registra la hora; marca al empleado con la acción disponible. Quien no trabaja hoy
        (según los días de su ficha) aparece como <strong>Día libre</strong> y no suma pendientes.
      </p>

      {feriadoDeHoy && (
        <p className="mt-2 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-relaxed text-violet-950">
          <CalendarDays size={15} className="mt-0.5 shrink-0 text-violet-700" aria-hidden="true" />
          <span>
            <strong>Feriado{feriadoDeHoy.nombre ? `: ${feriadoDeHoy.nombre}` : ''}</strong>
            {feriadoDeHoy.laborable === false
              ? ' — no es laborable: nadie suma pendientes y no se registra ausencia. Si alguien vino, márcalo igual.'
              : ' — laborable: se espera asistencia y se paga con el recargo del feriado.'}
          </span>
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Resumen de marcajes de hoy">
        <ResumenEstado label="Pendientes" count={conteos.pendiente} color="amber" />
        <ResumenEstado label="En jornada" count={conteos['en-curso']} color="emerald" />
        <ResumenEstado label="Completados" count={conteos.completado} color="slate" />
        <ResumenEstado label="Ausencias" count={conteos.ausencia} color="rose" />
        <ResumenEstado label="Día libre" count={conteos.libre} color="slate" />
      </div>
      {conteos.manual > 0 && (
        <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-950">
          {conteos.manual} registro(s) de horario fijo están separados del marcaje real y no habilitan entrada o salida de reloj.
        </p>
      )}

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

      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap" role="group" aria-label="Filtrar marcajes por estado">
        {FILTROS.filter(item => !['todos', 'manuales', 'libres'].includes(item.id) || !vistaCompacta)
          .map(item => {
          const count = item.estado ? conteos[item.estado] : filas.length
          const seleccionado = filtro === item.id
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
          La fecha operativa cambió. Actualiza los marcajes antes de continuar.
          <button type="button" onClick={actualizar} className="ml-2 min-h-11 rounded-lg border border-amber-300 bg-white px-3 font-bold" style={{ touchAction: 'manipulation' }}>
            Actualizar
          </button>
        </div>
      )}

      {consultaConError && (
        <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <p>No se pudieron actualizar los marcajes o empleados. Para evitar duplicados, las acciones están pausadas hasta que actualices.</p>
          <button type="button" onClick={actualizar} className="mt-2 min-h-11 rounded-lg border border-rose-300 bg-white px-3 font-bold" style={{ touchAction: 'manipulation' }}>
            Volver a intentar
          </button>
        </div>
      )}

      {errorAccion && (
        <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          {errorAccion}
        </div>
      )}

      {consultaEnCurso && !filas.length ? (
        <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2" aria-label="Cargando empleados y marcajes" aria-busy="true">
          {[0, 1].map(item => <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      ) : !consultaConError && !filas.length ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          No hay empleados activos configurados en Nómina.
        </p>
      ) : !consultaConError && !listaVisible.length ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          {vistaCompacta && filtro === 'todos' ? 'No hay entradas pendientes ni jornadas en curso.' : 'No hay empleados que coincidan con esta búsqueda y filtro.'}
        </p>
      ) : (
        <div role="list" className="mt-3 grid min-w-0 grid-cols-1 gap-2.5 lg:grid-cols-2" aria-label="Lista de marcajes de hoy" aria-busy={Boolean(accionPendiente)}>
          {listaVisible.map(({ empleado, registro, estado, libre, feriado, nombre }) => {
            const pendienteDeEste = accionPendiente?.empleadoId === empleado.empleado_id
            const tipoPendiente = accionPendiente?.tipo
            const diaLibre = NOMBRE_DIA_CORTO[diaSemanaDeFecha(data.fecha)] ?? 'hoy'
            const marcajeReal = registro && !registro.es_ausencia && Boolean(registro.hora_entrada)
              && ['entrada', 'completo', 'corregido'].includes(registro.estado_marcaje)
            return (

              <article
                role="listitem"
                key={empleado.empleado_id}
                className={`grid min-w-0 grid-cols-1 items-center gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)] ${claseEstado(estado)}`}
              >
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-black text-slate-900" title={nombre}>{nombre}</h4>
                  {empleado.cargo && <p className="truncate text-xs text-slate-500">{empleado.cargo}</p>}
                  {feriado && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-800">
                      <CalendarDays size={11} aria-hidden="true" />
                      {feriado.laborable === false ? 'Feriado no laborable' : 'Feriado laborable'}
                    </span>
                  )}
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold" role="status">
                    {estado === 'completado'
                      ? <CheckCircle2 size={14} aria-hidden="true" />
                      : <span className="h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden="true" />}
                    <span>{etiquetaEstado(estado)}</span>
                    {registro?.estado_marcaje === 'corregido' && (
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-800">Marcaje corregido</span>
                    )}
                  </p>
                  {registro && !registro.es_ausencia && (registro.hora_entrada || registro.hora_salida) && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 tabular-nums">
                      {registro.hora_entrada && <span>Entrada <strong>{formatoHora(registro.hora_entrada)}</strong></span>}
                      {registro.hora_salida
                        ? <span>Salida <strong>{formatoHora(registro.hora_salida)}</strong></span>
                        : estado === 'en-curso' && <span className="text-amber-700">Salida pendiente</span>}
                    </div>
                  )}
                </div>

                {(estado === 'pendiente' || estado === 'libre') && (
                  <div className="flex w-full flex-col gap-1.5">
                    {estado === 'libre' && (
                      <p className="text-[11px] font-semibold text-slate-500">
                        {feriado && feriado.laborable === false
                          ? `Hoy es feriado${feriado.nombre ? ` (${feriado.nombre})` : ''}: no es día laborable. Si vino, márcalo igual.`
                          : `Hoy no le toca trabajar (${diaLibre}). Si vino, márcalo igual.`}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => registrarMarcaje(empleado.empleado_id, 'entrada')}
                      disabled={bloqueado}
                      aria-label={estado === 'libre' ? `Marcar entrada en día libre para ${nombre}` : `Marcar entrada para ${nombre}`}
                      aria-busy={Boolean(pendienteDeEste && tipoPendiente === 'entrada')}
                      className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-3 text-[16px] font-black shadow-sm transition-colors active:scale-[0.99] disabled:cursor-wait disabled:opacity-55 sm:text-sm ${estado === 'libre' ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-emerald-700 text-white hover:bg-emerald-600'}`}
                      style={{ touchAction: 'manipulation' }}
                    >
                      <LogIn size={17} aria-hidden="true" />
                      {pendienteDeEste && tipoPendiente === 'entrada'
                        ? 'Marcando entrada…'
                        : estado === 'libre' ? 'Marcar entrada (vino)' : 'Marcar entrada'}
                    </button>
                    {estado === 'pendiente' && (
                      <button
                        type="button"
                        onClick={() => registrarAusencia(empleado.empleado_id, false)}
                        disabled={bloqueado}
                        aria-label={`Marcar ausencia de hoy para ${nombre}`}
                        aria-busy={Boolean(pendienteDeEste && tipoPendiente === 'ausencia')}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-sm font-bold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-wait disabled:opacity-55"
                        style={{ touchAction: 'manipulation' }}
                      >
                        <UserX size={15} aria-hidden="true" />
                        {pendienteDeEste && tipoPendiente === 'ausencia' ? 'Registrando ausencia…' : 'Marcar ausente'}
                      </button>
                    )}
                  </div>
                )}

                {estado === 'ausencia' && (
                  <button
                    type="button"
                    onClick={() => registrarAusencia(empleado.empleado_id, true)}
                    disabled={bloqueado}
                    aria-label={`Deshacer la ausencia de hoy de ${nombre}`}
                    aria-busy={Boolean(pendienteDeEste && tipoPendiente === 'quitar-ausencia')}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-3 text-sm font-bold text-rose-800 transition-colors hover:bg-rose-50 disabled:cursor-wait disabled:opacity-55"
                    style={{ touchAction: 'manipulation' }}
                  >
                    <Undo2 size={15} aria-hidden="true" />
                    {pendienteDeEste && tipoPendiente === 'quitar-ausencia' ? 'Deshaciendo…' : 'Deshacer ausencia'}
                  </button>
                )}

                {(estado === 'en-curso' || estado === 'completado') && (
                  <div className="flex w-full flex-col gap-1.5">
                    {estado === 'en-curso' && (
                      <button
                        type="button"
                        onClick={() => registrarMarcaje(empleado.empleado_id, 'salida')}
                        disabled={bloqueado}
                        aria-label={`Marcar salida para ${nombre}`}
                        aria-busy={Boolean(pendienteDeEste && tipoPendiente === 'salida')}
                        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-[16px] font-black text-white shadow-sm transition-colors hover:bg-slate-700 active:scale-[0.99] disabled:cursor-wait disabled:opacity-55 sm:text-sm"
                        style={{ touchAction: 'manipulation' }}
                      >
                        <LogOut size={17} aria-hidden="true" />
                        {pendienteDeEste && tipoPendiente === 'salida' ? 'Marcando salida…' : 'Marcar salida'}
                      </button>
                    )}
                    {marcajeReal && (
                      <button
                        type="button"
                        onClick={() => setRegistroEnCorreccion({ empleado, registro })}
                        disabled={bloqueado}
                        aria-label={`Corregir marcaje de ${nombre}`}
                        className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-55 ${estado === 'en-curso' ? 'text-xs font-semibold' : ''}`}
                        style={{ touchAction: 'manipulation' }}
                      >
                        <PencilLine size={14} aria-hidden="true" />
                        Corregir marcaje
                      </button>
                    )}
                    {estado === 'en-curso' && marcajeReal && (
                      <button
                        type="button"
                        onClick={() => { setRegistroParaAnular({ empleado, registro }); setMotivoAnulacion(''); setErrorAnulacion('') }}
                        disabled={bloqueado}
                        aria-label={`Anular entrada y marcar ausente a ${nombre}`}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-3 text-xs font-bold text-rose-800 transition-colors hover:bg-rose-50 disabled:cursor-wait disabled:opacity-55"
                        style={{ touchAction: 'manipulation' }}
                      >
                        <UserX size={15} aria-hidden="true" />
                        Anular entrada y marcar ausente
                      </button>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
      {registroEnCorreccion && (
        <CorreccionMarcajeModal
          empleado={registroEnCorreccion.empleado}
          registro={registroEnCorreccion.registro}
          horasDescansoDefault={configNomina?.nomina_horas_descanso ?? 1}
          onClose={() => setRegistroEnCorreccion(null)}
          onGuardar={campos => corregirMarcaje.mutateAsync(campos)}
          isSaving={corregirMarcaje.isPending}
        />
      )}
      {registroParaAnular && (
        <Modal
          isOpen
          title="Anular entrada y registrar ausencia"
          onClose={() => { if (!anularEntrada.isPending) setRegistroParaAnular(null) }}
          busy={anularEntrada.isPending}
          className="max-w-md"
          footer={(
            <div className="flex w-full flex-col-reverse gap-2 pb-3 sm:flex-row sm:justify-end sm:pb-4">
              <button type="button" onClick={() => setRegistroParaAnular(null)} disabled={anularEntrada.isPending} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={confirmarAnulacion} disabled={anularEntrada.isPending || motivoAnulacion.trim().length < 3 || bloqueado} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-black text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50">
                {anularEntrada.isPending ? 'Guardando…' : 'Confirmar ausencia'}
              </button>
            </div>
          )}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-relaxed text-rose-950">
              <p><strong>{registroParaAnular.empleado.empleado?.nombre || registroParaAnular.empleado.nombre}</strong> quedará como ausente. Se limpiarán la entrada y las horas del marcaje, pero se conservará la acción en auditoría.</p>
              <p className="mt-1 text-xs">Entrada registrada: {formatoHora(registroParaAnular.registro.hora_entrada)}. Solo disponible mientras no tenga salida y el período siga abierto.</p>
            </div>
            <label className="block space-y-1.5 text-sm font-bold text-slate-800">
              Motivo de la anulación <span className="text-rose-600" aria-hidden="true">*</span>
              <textarea value={motivoAnulacion} onChange={event => setMotivoAnulacion(event.target.value)} maxLength={500} minLength={3} rows={3} disabled={anularEntrada.isPending} placeholder="Ej.: entrada marcada por error; empleado no asistió" className="min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[16px] font-normal leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60" />
              <span className="block text-right text-[11px] font-normal text-slate-500">{motivoAnulacion.length}/500</span>
            </label>
            {errorAnulacion && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{errorAnulacion}</p>}
          </div>
        </Modal>
      )}
    </section>
  )
}

function ResumenEstado({ label, count, color }) {
  const colors = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
  }
  return (
    <div className={`min-w-0 rounded-xl border px-2.5 py-2 ${colors[color]}`}>
      <span className="block truncate text-[11px] font-semibold">{label}</span>
      <strong className="mt-0.5 block text-base leading-tight tabular-nums">{count}</strong>
    </div>
  )
}
