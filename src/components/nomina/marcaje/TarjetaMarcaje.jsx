// src/components/nomina/marcaje/TarjetaMarcaje.jsx
// Tarjeta de un empleado en el marcaje real de hoy: su estado y la acción
// contextual que le corresponde. No decide nada contra el servidor: recibe el
// estado ya calculado por el panel y le devuelve la intención del operador.
//
// Reglas de interfaz (docs/PLAN_MARCAJE_BOTONES_UX.md):
// - M-10: una sola acción principal por estado; lo poco frecuente o destructivo
//   vive en «Más acciones», un disclosure en línea (sin portales).
// - M-13: el nombre accesible de cada botón EMPIEZA por su texto visible; el nombre
//   del empleado se añade con texto solo para lectores (`sr-only`).
// - M-14: la tarjeta no es una región viva; el panel anuncia la última acción.
import { useId, useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronDown, LogIn, LogOut, PencilLine, RotateCcw, Undo2, UserX } from 'lucide-react'
import { NOMBRE_DIA_CORTO, diaSemanaDeFecha } from '../../../utils/diasLaborables.js'
import { TOLERANCIA_RETRASO_MINUTOS, minutosEntre } from '../../../../server/lib/marcajeReglas.js'
import { claseEstado, esMarcajeReal, etiquetaEstado, formatoHora } from './marcajeEstado.js'

const BOTON_PRINCIPAL = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-3 text-[16px] font-black shadow-sm transition-colors active:scale-[0.99] disabled:cursor-wait disabled:opacity-55 sm:text-sm'
const BOTON_SECUNDARIO = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-bold transition-colors disabled:cursor-wait disabled:opacity-55'
const TACTIL = { touchAction: 'manipulation' }

function cuentaRegresiva(segundos) {
  const minutos = Math.floor(segundos / 60)
  return `${minutos}:${String(segundos % 60).padStart(2, '0')}`
}

function duracion(minutos) {
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  return resto ? `${horas} h ${resto} min` : `${horas} h`
}

// Texto solo para lectores de pantalla: completa el nombre accesible sin cambiar lo visible.
function ParaLector({ children }) {
  return <span className="sr-only">{children}</span>
}

// Props de estado por tarjeta (M-4/M-6/M-8, ver useAccionesMarcaje):
// - pendiente: tipo de la acción en curso de ESTA persona (o null).
// - bloqueada: no se puede actuar sobre ella (carga, error o acción en curso).
// - deshacer: { tipo, segundos } mientras se puede deshacer lo recién marcado.
// - confirmandoSalida: { minutos } si la salida es sospechosamente corta.
// - horaActual: `HH:MM` operativa, para el tiempo en jornada y el retraso (M-11).
export default function TarjetaMarcaje({
  fila,
  fecha,
  horaActual = null,
  pendiente = null,
  bloqueada = false,
  deshacer = null,
  confirmandoSalida = null,
  onMarcar,
  onAusencia,
  onCorregir,
  onAnular,
  onDeshacer,
}) {
  const { empleado, registro, estado, feriado, nombre, libre } = fila
  const [masAbierto, setMasAbierto] = useState(false)
  const idMas = useId()
  const id = empleado.empleado_id
  const enCurso = tipo => pendiente === tipo
  const diaLibre = NOMBRE_DIA_CORTO[diaSemanaDeFecha(fecha)] ?? 'hoy'
  const marcajeReal = esMarcajeReal(registro)
  // Mismo criterio que el servidor (M-1): en día libre o feriado no laborable no hay
  // falta que registrar, así que anular la entrada elimina el registro del día.
  const diaNoLaborable = Boolean(libre || feriado?.laborable === false)
  const textoAnular = diaNoLaborable ? 'No vino — anular entrada' : 'No vino — marcar ausente'

  // M-11: informativo, no cambia el cálculo de nómina.
  const minutosEnJornada = estado === 'en-curso' && horaActual ? minutosEntre(registro?.hora_entrada, horaActual) : null
  const horaInicio = estado === 'pendiente' && empleado.hora_inicio ? String(empleado.hora_inicio).slice(0, 5) : null
  const minutosTarde = horaInicio && horaActual && horaActual > horaInicio ? minutosEntre(horaInicio, horaActual) : 0
  const retraso = minutosTarde > TOLERANCIA_RETRASO_MINUTOS ? minutosTarde : null

  return (
    <article
      role="listitem"
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
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold">
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
            {minutosEnJornada !== null && <span>En jornada {duracion(minutosEnJornada)}</span>}
          </div>
        )}
        {horaInicio && (
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums text-slate-600">
            <span>Entra <strong>{formatoHora(horaInicio)}</strong></span>
            {retraso && <span className="font-bold text-amber-800">Retraso {duracion(retraso)}</span>}
          </div>
        )}
        {deshacer && (
          <button
            type="button"
            onClick={() => onDeshacer(id)}
            disabled={bloqueada}
            aria-busy={enCurso(`deshacer-${deshacer.tipo}`)}
            className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-55"
            style={TACTIL}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {enCurso(`deshacer-${deshacer.tipo}`)
              ? 'Deshaciendo…'
              : <>Deshacer {deshacer.tipo}<span className="tabular-nums text-slate-500" aria-hidden="true"> ({cuentaRegresiva(deshacer.segundos)})</span></>}
            <ParaLector> de {nombre}</ParaLector>
          </button>
        )}
      </div>

      {(estado === 'pendiente' || estado === 'libre') && (
        <div className="flex w-full flex-col gap-2">
          {estado === 'libre' && (
            <p className="text-[11px] font-semibold text-slate-500">
              {feriado && feriado.laborable === false
                ? `Hoy es feriado${feriado.nombre ? ` (${feriado.nombre})` : ''}: no es día laborable. Si vino, márcalo igual.`
                : `Hoy no le toca trabajar (${diaLibre}). Si vino, márcalo igual.`}
            </p>
          )}
          <button
            type="button"
            onClick={() => onMarcar(id, 'entrada')}
            disabled={bloqueada}
            aria-busy={enCurso('entrada')}
            className={`${BOTON_PRINCIPAL} ${estado === 'libre' ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-emerald-700 text-white hover:bg-emerald-600'}`}
            style={TACTIL}
          >
            <LogIn size={17} aria-hidden="true" />
            {enCurso('entrada') ? 'Marcando entrada…' : estado === 'libre' ? 'Marcar entrada (vino)' : 'Marcar entrada'}
            <ParaLector> para {nombre}</ParaLector>
          </button>
          {estado === 'pendiente' && (
            <button
              type="button"
              onClick={() => onAusencia(id, false)}
              disabled={bloqueada}
              aria-busy={enCurso('ausencia')}
              className={`${BOTON_SECUNDARIO} border-rose-200 text-rose-700 hover:bg-rose-50`}
              style={TACTIL}
            >
              <UserX size={15} aria-hidden="true" />
              {enCurso('ausencia') ? 'Registrando ausencia…' : 'Marcar ausente'}
              <ParaLector> a {nombre}</ParaLector>
            </button>
          )}
        </div>
      )}

      {estado === 'ausencia' && (
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={() => onMarcar(id, 'entrada', { reemplazarAusencia: true })}
            disabled={bloqueada}
            aria-busy={enCurso('entrada')}
            className={`${BOTON_PRINCIPAL} bg-emerald-700 text-white hover:bg-emerald-600`}
            style={TACTIL}
          >
            <LogIn size={17} aria-hidden="true" />
            {enCurso('entrada') ? 'Marcando entrada…' : 'Llegó: marcar entrada'}
            <ParaLector> de {nombre}</ParaLector>
          </button>
          <button
            type="button"
            onClick={() => onAusencia(id, true)}
            disabled={bloqueada}
            aria-busy={enCurso('quitar-ausencia')}
            className={`${BOTON_SECUNDARIO} border-rose-300 text-rose-800 hover:bg-rose-50`}
            style={TACTIL}
          >
            <Undo2 size={15} aria-hidden="true" />
            {enCurso('quitar-ausencia') ? 'Deshaciendo…' : 'Deshacer ausencia'}
            <ParaLector> de {nombre}</ParaLector>
          </button>
        </div>
      )}

      {estado === 'en-curso' && (
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={() => onMarcar(id, 'salida')}
            disabled={bloqueada}
            aria-busy={enCurso('salida')}
            className={`${BOTON_PRINCIPAL} bg-slate-900 text-white hover:bg-slate-700`}
            style={TACTIL}
          >
            <LogOut size={17} aria-hidden="true" />
            {enCurso('salida')
              ? 'Marcando salida…'
              : confirmandoSalida ? `¿Salida tras ${confirmandoSalida.minutos} min? Toca otra vez` : 'Marcar salida'}
            <ParaLector>{confirmandoSalida ? ` para confirmar la salida de ${nombre}` : ` para ${nombre}`}</ParaLector>
          </button>
          {marcajeReal && (
            <>
              <button
                type="button"
                onClick={() => setMasAbierto(valor => !valor)}
                aria-expanded={masAbierto}
                aria-controls={idMas}
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold text-slate-600 hover:bg-white/70"
                style={TACTIL}
              >
                Más acciones<ParaLector> de {nombre}</ParaLector>
                <ChevronDown size={14} className={`transition-transform ${masAbierto ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {masAbierto && (
                <div id={idMas} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/80 p-2">
                  <button
                    type="button"
                    onClick={() => onCorregir({ empleado, registro, nombre })}
                    disabled={bloqueada}
                    className={`${BOTON_SECUNDARIO} border-slate-300 text-slate-700 hover:bg-slate-50`}
                    style={TACTIL}
                  >
                    <PencilLine size={14} aria-hidden="true" />
                    Corregir hora<ParaLector> de {nombre}</ParaLector>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAnular({ empleado, registro, nombre, resultadoEsperado: diaNoLaborable ? 'sin-registro' : 'ausencia' })}
                    disabled={bloqueada}
                    className={`${BOTON_SECUNDARIO} border-rose-300 text-rose-800 hover:bg-rose-50`}
                    style={TACTIL}
                  >
                    <UserX size={15} aria-hidden="true" />
                    {textoAnular}<ParaLector> — {nombre}</ParaLector>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {estado === 'completado' && marcajeReal && (
        <button
          type="button"
          onClick={() => onCorregir({ empleado, registro, nombre })}
          disabled={bloqueada}
          className={`${BOTON_SECUNDARIO} border-slate-300 text-slate-700 hover:bg-slate-50`}
          style={TACTIL}
        >
          <PencilLine size={14} aria-hidden="true" />
          Corregir marcaje<ParaLector> de {nombre}</ParaLector>
        </button>
      )}
    </article>
  )
}
