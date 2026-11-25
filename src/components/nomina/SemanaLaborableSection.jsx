// src/components/nomina/SemanaLaborableSection.jsx
// Días que trabaja cada persona y con qué jornada cada uno. Es la fuente del
// estado «Libre» y del horario por defecto en Asistencia. Extraído de
// EmpleadoConfigModal.jsx para respetar el límite de 600 líneas.
import { CalendarDays } from 'lucide-react'
import { NOMBRE_DIA, NOMBRE_DIA_CORTO, diasLaborablesTexto } from '../../utils/diasLaborables.js'

// Horas entre entrada y salida (salida al día siguiente si es menor). null si falta un dato.
function horasEntre(inicio, fin) {
  const aMin = hora => {
    const [h, m] = String(hora || '').split(':').map(Number)
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
  }
  const desde = aMin(inicio)
  const hasta = aMin(fin)
  if (desde === null || hasta === null) return null
  const minutos = hasta > desde ? hasta - desde : hasta + 24 * 60 - desde
  return Math.round((minutos / 60) * 100) / 100
}

const fmtHoras = n => `${Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 })} h`

const inputDiaCls = 'w-full min-h-11 px-2 rounded-xl border border-slate-200 bg-white text-[16px] sm:text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all'

export default function SemanaLaborableSection({
  semana, cargando, onAlternarDia, onCambiarJornada, onCopiarJornada, onHorarioEstandar,
}) {
  const diasActivos = semana.dias.filter(dia => dia.activo)
  const resumenSemana = diasLaborablesTexto(diasActivos.map(dia => dia.diaSemana))

  return (
    <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <label className="text-xs font-black text-slate-700 flex items-center gap-1.5">
          <CalendarDays size={15} className="text-primary" />
          Días que trabaja
        </label>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
          {resumenSemana}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Solo estos días se toman como laborables por defecto en Asistencia. El domingo se paga como
        feriado y nunca se exige.
      </p>

      <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Días que trabaja">
        {semana.dias.map(dia => (
          <button
            key={dia.diaSemana}
            type="button"
            onClick={() => onAlternarDia(dia.diaSemana)}
            aria-pressed={dia.activo}
            aria-label={`${NOMBRE_DIA[dia.diaSemana]}: ${dia.activo ? 'trabaja' : 'no trabaja'}`}
            disabled={cargando}
            style={{ touchAction: 'manipulation' }}
            className={`min-h-11 rounded-xl border text-[11px] font-black transition-all disabled:opacity-50 ${
              dia.activo
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-slate-200 bg-white text-slate-400 hover:text-slate-600'
            }`}
          >
            {NOMBRE_DIA_CORTO[dia.diaSemana]}
          </button>
        ))}
      </div>

      {!semana.hayHorario && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          Sin semana guardada todavía: se asume el horario de la empresa (lunes a viernes; sábado y domingo de descanso). Guarda la ficha para
          fijar sus días.
        </p>
      )}

      {diasActivos.length === 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          Sin días marcados no se puede guardar: elige al menos uno.
        </p>
      ) : (
        <div className="space-y-1.5 pt-0.5">
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_4.75rem] gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400" aria-hidden="true">
            <span />
            <span>Entrada</span>
            <span>Salida</span>
            <span>Jornada (h)</span>
          </div>
          {diasActivos.map(dia => {
            const tramo = horasEntre(dia.horaInicio, dia.horaFin)
            const excede = tramo !== null && Number(dia.horasJornada) > tramo
            return (
            <div key={dia.diaSemana} className="space-y-1">
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_4.75rem] items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-600">{NOMBRE_DIA_CORTO[dia.diaSemana]}</span>
              <input
                type="time"
                value={dia.horaInicio}
                onChange={e => onCambiarJornada(dia.diaSemana, 'horaInicio', e.target.value)}
                aria-label={`Hora de entrada del ${NOMBRE_DIA[dia.diaSemana]}`}
                disabled={cargando}
                className={inputDiaCls}
              />
              <input
                type="time"
                value={dia.horaFin}
                onChange={e => onCambiarJornada(dia.diaSemana, 'horaFin', e.target.value)}
                aria-label={`Hora de salida del ${NOMBRE_DIA[dia.diaSemana]}`}
                disabled={cargando}
                className={inputDiaCls}
              />
              <input
                type="number"
                min="1"
                max="24"
                step="0.5"
                value={dia.horasJornada}
                onChange={e => onCambiarJornada(dia.diaSemana, 'horasJornada', e.target.value)}
                aria-label={`Jornada del ${NOMBRE_DIA[dia.diaSemana]}`}
                disabled={cargando}
                className={inputDiaCls}
              />
            </div>
            {excede && (
              <p role="alert" className="pl-11 text-[10px] font-semibold text-amber-800">
                La jornada ({fmtHoras(dia.horasJornada)}) es mayor que el tiempo entre entrada y salida ({fmtHoras(tramo)}).
              </p>
            )}
            </div>
            )
          })}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
          {onHorarioEstandar && (
            <button
              type="button"
              onClick={onHorarioEstandar}
              disabled={cargando}
              className="text-[11px] font-bold text-primary hover:text-primary-hover disabled:opacity-50"
            >
              Horario estándar 08:00 a 17:00 (8 h)
            </button>
          )}
          {diasActivos.length > 1 && (
            <button
              type="button"
              onClick={onCopiarJornada}
              disabled={cargando}
              className="text-[11px] font-bold text-primary hover:text-primary-hover disabled:opacity-50"
            >
              Usar el mismo horario en todos los días marcados
            </button>
          )}
          </div>
        </div>
      )}
    </div>
  )
}
