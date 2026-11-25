// src/components/nomina/marcaje/TarjetaMarcaje.jsx
// Tarjeta de asistencia diaria por excepción:
// - Día laborable sin falta: Presente por defecto según horario del empleado.
// - Acciones únicas: + Horas extras (desde 0.5h o manual), Marcar ausente, o
//   en días libres/feriados: Marcar día trabajado.
import { useState } from 'react'
import { CalendarCheck2, CalendarDays, CheckCircle2, Clock, FileCheck2, FileX2, RotateCcw, Undo2, UserX, X } from 'lucide-react'
import { NOMBRE_DIA_CORTO, diaSemanaDeFecha } from '../../../utils/diasLaborables.js'
import { horarioEfectivoDelDia } from '../../../../server/lib/asistenciaExcepciones.js'
import { claseEstado, etiquetaEstado, formatoHora } from './marcajeEstado.js'
import HorasExtraInline from './HorasExtraInline.jsx'

const BOTON_PRINCIPAL = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-3 text-[16px] font-black shadow-sm transition-colors active:scale-[0.99] disabled:cursor-wait disabled:opacity-55 sm:text-sm'
const BOTON_SECUNDARIO = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-bold transition-colors disabled:cursor-wait disabled:opacity-55'
const TACTIL = { touchAction: 'manipulation' }

function ParaLector({ children }) {
  return <span className="sr-only">{children}</span>
}

export default function TarjetaMarcaje({
  fila,
  fecha,
  horasDescansoDefault = 1,
  pendiente = null,
  bloqueada = false,
  onHorasExtra,
  onDiaTrabajado,
  onAusencia,
}) {
  const { empleado, registro, estado, feriado, nombre } = fila
  const [editandoExtras, setEditandoExtras] = useState(false)
  const [eligiendoFalta, setEligiendoFalta] = useState(false)

  const id = empleado.empleado_id
  const enCurso = tipo => pendiente === tipo
  const diaLibre = NOMBRE_DIA_CORTO[diaSemanaDeFecha(fecha)] ?? 'hoy'
  const horario = horarioEfectivoDelDia(empleado, fecha, horasDescansoDefault)
  const horasExtra = Number(registro?.horas_extra || 0)

  async function guardarExtras(valor) {
    await onHorasExtra(id, valor)
    setEditandoExtras(false)
  }

  return (
    <article
      role="listitem"
      className={`grid min-w-0 grid-cols-1 items-center gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,auto)] ${claseEstado(estado)}`}
    >
      <div className="min-w-0">
        <h4 className="truncate text-sm font-black text-slate-900" title={nombre}>{nombre}</h4>
        {empleado.cargo && <p className="truncate text-xs text-slate-500">{empleado.cargo}</p>}

        {feriado && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-800">
            <CalendarDays size={11} aria-hidden="true" />
            {feriado.laborable === false ? `Feriado no laborable${feriado.nombre ? ` · ${feriado.nombre}` : ''}` : `Feriado laborable${feriado.nombre ? ` · ${feriado.nombre}` : ''}`}
          </span>
        )}

        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold">
          {estado === 'presente' || estado === 'extra' || estado === 'descanso-trabajado'
            ? <CheckCircle2 size={14} className="shrink-0" aria-hidden="true" />
            : <span className="h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden="true" />}
          <span>{etiquetaEstado(estado)}</span>

          {horasExtra > 0 && !registro?.es_ausencia && (
            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900 tabular-nums">
              +{horasExtra} h extra
            </span>
          )}

          {registro?.es_ausencia && (
            registro.ausencia_justificada
              ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-800">Con justificativo · se paga</span>
              : <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-800">Sin justificativo · se descuenta el día</span>
          )}
        </p>

        {estado !== 'ausencia' && estado !== 'libre' && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 tabular-nums">
            <span>
              Horario <strong>{formatoHora(horario.horaInicio)} – {formatoHora(horario.horaFin)}</strong> ({horario.horasJornada}h)
            </span>
            {horasExtra > 0 && registro?.hora_salida && (
              <span className="font-semibold text-amber-900">
                Salida c/ extras <strong>{formatoHora(registro.hora_salida)}</strong>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Acciones contextuales en día laborable */}
      {(estado === 'presente' || estado === 'extra') && (
        <div className="flex w-full flex-col gap-2">
          {editandoExtras ? (
            <HorasExtraInline
              nombre={nombre}
              horaFinBase={horario.horaFin}
              horasActuales={horasExtra}
              bloqueada={bloqueada}
              pendiente={enCurso('horas-extra')}
              onGuardar={guardarExtras}
              onCancelar={() => setEditandoExtras(false)}
            />
          ) : eligiendoFalta ? (
            <div role="group" aria-label={`¿${nombre} trae justificativo?`} className="min-w-0 space-y-2 rounded-xl border border-rose-200 bg-rose-50/60 p-2.5">
              <p className="text-xs font-bold text-slate-800">¿Trae justificativo?</p>
              <button
                type="button"
                onClick={() => { setEligiendoFalta(false); onAusencia(id, false, true) }}
                disabled={bloqueada}
                className={`${BOTON_SECUNDARIO} h-auto flex-col gap-0 border-sky-300 py-1.5 text-sky-800 hover:bg-sky-50`}
                style={TACTIL}
              >
                <span className="inline-flex items-center gap-1.5"><FileCheck2 size={15} aria-hidden="true" />Sí, con justificativo</span>
                <span className="text-[11px] font-semibold text-sky-700">El día se paga</span>
                <ParaLector> para {nombre}</ParaLector>
              </button>
              <button
                type="button"
                onClick={() => { setEligiendoFalta(false); onAusencia(id, false, false) }}
                disabled={bloqueada}
                className={`${BOTON_SECUNDARIO} h-auto flex-col gap-0 border-rose-300 py-1.5 text-rose-800 hover:bg-rose-50`}
                style={TACTIL}
              >
                <span className="inline-flex items-center gap-1.5"><FileX2 size={15} aria-hidden="true" />No, sin justificativo</span>
                <span className="text-[11px] font-semibold text-rose-700">Se descuenta solo ese día</span>
                <ParaLector> para {nombre}</ParaLector>
              </button>
              <button
                type="button"
                onClick={() => setEligiendoFalta(false)}
                disabled={bloqueada}
                className={`${BOTON_SECUNDARIO} border-slate-300 text-slate-700 hover:bg-slate-50`}
                style={TACTIL}
              >
                <X size={15} aria-hidden="true" />
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditandoExtras(true)}
                disabled={bloqueada}
                aria-busy={enCurso('horas-extra')}
                className={`${BOTON_PRINCIPAL} ${horasExtra > 0 ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-emerald-700 text-white hover:bg-emerald-600'}`}
                style={TACTIL}
              >
                <Clock size={17} aria-hidden="true" />
                {horasExtra > 0 ? `Editar extras (+${horasExtra} h)` : 'Horas extras'}
                <ParaLector> de {nombre}</ParaLector>
              </button>
              {estado === 'presente' && (
                <button
                  type="button"
                  onClick={() => setEligiendoFalta(true)}
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
            </>
          )}
        </div>
      )}

      {/* Ausencia registrada → volver a presente */}
      {estado === 'ausencia' && (
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={() => onAusencia(id, true)}
            disabled={bloqueada}
            aria-busy={enCurso('quitar-ausencia')}
            className={`${BOTON_PRINCIPAL} bg-emerald-700 text-white hover:bg-emerald-600`}
            style={TACTIL}
          >
            <Undo2 size={16} aria-hidden="true" />
            {enCurso('quitar-ausencia') ? 'Restaurando…' : 'Volver a presente'}
            <ParaLector> ({nombre})</ParaLector>
          </button>
        </div>
      )}

      {/* Día de descanso o feriado no laborable → marcar como trabajado si vino */}
      {estado === 'libre' && (
        <div className="flex w-full flex-col gap-2">
          <p className="text-[11px] font-semibold text-slate-500">
            {feriado && feriado.laborable === false
              ? `Hoy es feriado${feriado.nombre ? ` (${feriado.nombre})` : ''}. Si vino, márcalo como trabajado.`
              : `Hoy no le toca trabajar (${diaLibre}). Si vino, márcalo como trabajado.`}
          </p>
          <button
            type="button"
            onClick={() => onDiaTrabajado(id, false)}
            disabled={bloqueada}
            aria-busy={enCurso('dia-trabajado')}
            className={`${BOTON_PRINCIPAL} border border-violet-300 bg-white text-violet-800 hover:bg-violet-50`}
            style={TACTIL}
          >
            <CalendarCheck2 size={17} aria-hidden="true" />
            {enCurso('dia-trabajado') ? 'Marcando día…' : 'Marcar día trabajado'}
            <ParaLector> de {nombre}</ParaLector>
          </button>
        </div>
      )}

      {/* Descanso / feriado ya marcado como trabajado → horas extras o quitar */}
      {estado === 'descanso-trabajado' && (
        <div className="flex w-full flex-col gap-2">
          {editandoExtras ? (
            <HorasExtraInline
              nombre={nombre}
              horaFinBase={horario.horaFin}
              horasActuales={horasExtra}
              bloqueada={bloqueada}
              pendiente={enCurso('horas-extra')}
              onGuardar={guardarExtras}
              onCancelar={() => setEditandoExtras(false)}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditandoExtras(true)}
                disabled={bloqueada}
                aria-busy={enCurso('horas-extra')}
                className={`${BOTON_PRINCIPAL} ${horasExtra > 0 ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-violet-700 text-white hover:bg-violet-600'}`}
                style={TACTIL}
              >
                <Clock size={17} aria-hidden="true" />
                {horasExtra > 0 ? `Editar extras (+${horasExtra} h)` : 'Horas extras'}
                <ParaLector> de {nombre}</ParaLector>
              </button>
              <button
                type="button"
                onClick={() => onDiaTrabajado(id, true)}
                disabled={bloqueada}
                aria-busy={enCurso('quitar-dia-trabajado')}
                className={`${BOTON_SECUNDARIO} border-slate-300 text-slate-700 hover:bg-slate-50`}
                style={TACTIL}
              >
                <RotateCcw size={14} aria-hidden="true" />
                {enCurso('quitar-dia-trabajado') ? 'Quitando…' : 'Quitar día trabajado'}
                <ParaLector> de {nombre}</ParaLector>
              </button>
            </>
          )}
        </div>
      )}
    </article>
  )
}
