// src/components/nomina/marcaje/TarjetaMarcaje.jsx
// Tarjeta de un empleado en el marcaje real de hoy: su estado y la acción
// contextual que le corresponde. No decide nada contra el servidor: recibe el
// estado ya calculado por el panel y le devuelve la intención del operador.
import { CalendarDays, CheckCircle2, LogIn, LogOut, PencilLine, Undo2, UserX } from 'lucide-react'
import { NOMBRE_DIA_CORTO, diaSemanaDeFecha } from '../../../utils/diasLaborables.js'
import { claseEstado, esMarcajeReal, etiquetaEstado, formatoHora } from './marcajeEstado.js'

export default function TarjetaMarcaje({
  fila,
  fecha,
  accionPendiente,
  bloqueado,
  onMarcar,
  onAusencia,
  onCorregir,
  onAnular,
}) {
  const { empleado, registro, estado, feriado, nombre, libre } = fila
  const pendienteDeEste = accionPendiente?.empleadoId === empleado.empleado_id
  const tipoPendiente = accionPendiente?.tipo
  const diaLibre = NOMBRE_DIA_CORTO[diaSemanaDeFecha(fecha)] ?? 'hoy'
  const marcajeReal = esMarcajeReal(registro)
  // Mismo criterio que el servidor (M-1): en día libre o feriado no laborable no hay
  // falta que registrar, así que anular la entrada elimina el registro del día.
  const diaNoLaborable = Boolean(libre || feriado?.laborable === false)

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
            onClick={() => onMarcar(empleado.empleado_id, 'entrada')}
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
              onClick={() => onAusencia(empleado.empleado_id, false)}
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
          onClick={() => onAusencia(empleado.empleado_id, true)}
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
              onClick={() => onMarcar(empleado.empleado_id, 'salida')}
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
              onClick={() => onCorregir({ empleado, registro })}
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
              onClick={() => onAnular({ empleado, registro, resultadoEsperado: diaNoLaborable ? 'sin-registro' : 'ausencia' })}
              disabled={bloqueado}
              aria-label={diaNoLaborable ? `Anular entrada (no vino) de ${nombre}` : `Anular entrada y marcar ausente a ${nombre}`}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-3 text-xs font-bold text-rose-800 transition-colors hover:bg-rose-50 disabled:cursor-wait disabled:opacity-55"
              style={{ touchAction: 'manipulation' }}
            >
              <UserX size={15} aria-hidden="true" />
              {diaNoLaborable ? 'Anular entrada (no vino)' : 'Anular entrada y marcar ausente'}
            </button>
          )}
        </div>
      )}
    </article>
  )
}
