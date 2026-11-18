// src/components/nomina/PeriodosAutoCard.jsx
// Configuración de cómo nacen los períodos de nómina: automáticos (por defecto,
// semana jueves → miércoles) o manuales. El día de inicio de la semana se puede
// cambiar. Los valores y la validación salen de server/lib/nominaSemana.js.
import { CalendarClock } from 'lucide-react'
import { useGuardarConfigNomina } from '../../hooks/useNomina.js'
import { DIAS_SEMANA, rangoSemana, semanaDeConfig } from '../../../server/lib/nominaSemana.js'

const capitalizar = texto => texto.charAt(0).toUpperCase() + texto.slice(1)

function hoyIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtCorto(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-VE', { weekday: 'short', day: '2-digit', month: 'short' })
}

export default function PeriodosAutoCard({ configNomina, editable = true }) {
  const cfg = configNomina.data?.config || configNomina.data || {}
  const { modo, inicio } = semanaDeConfig(cfg)
  const guardar = useGuardarConfigNomina()
  const automatico = modo === 'automatico'
  const ejemplo = rangoSemana(hoyIso(), inicio)
  const bloqueado = !editable || guardar.isPending || configNomina.isLoading

  const opcionModo = (valor, titulo, detalle) => {
    const activo = modo === valor
    return (
      <button
        type="button"
        role="radio"
        aria-checked={activo}
        disabled={bloqueado}
        onClick={() => !activo && guardar.mutate({ nomina_periodo_modo: valor })}
        className={`flex-1 min-h-11 rounded-xl border p-3 text-left transition-all disabled:opacity-60 ${activo ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
      >
        <span className="block text-sm font-black text-slate-800">{titulo}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{detalle}</span>
      </button>
    )
  }

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <CalendarClock size={18} />
        </div>
        <div>
          <h2 className="text-sm font-black text-slate-800">Períodos de nómina</h2>
          <p className="text-xs text-slate-400">Cómo se abre cada semana de pago</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2" role="radiogroup" aria-label="Modo de creación de períodos">
        {opcionModo('automatico', 'Automático', 'La semana en curso se abre sola al entrar a Períodos. Recomendado.')}
        {opcionModo('manual', 'Manual', 'Cada período se crea a mano con el botón «Crear Nuevo Período».')}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <label className="block space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">La semana empieza el</span>
          <select
            value={inicio}
            disabled={bloqueado}
            onChange={e => guardar.mutate({ nomina_semana_inicio: Number(e.target.value) })}
            className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
          >
            {DIAS_SEMANA.map((dia, i) => (
              <option key={dia} value={i}>{capitalizar(dia)} → {DIAS_SEMANA[(i + 6) % 7]}</option>
            ))}
          </select>
        </label>
        <p className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 text-xs text-slate-600">
          Semana actual: <strong className="text-slate-800">{fmtCorto(ejemplo.desde)} – {fmtCorto(ejemplo.hasta)}</strong>
        </p>
      </div>

      <p className="text-[11px] text-slate-400">
        {automatico
          ? 'Cambiar el día de inicio solo afecta a las semanas nuevas; los períodos ya creados no se mueven.'
          : 'En modo manual el formulario de nuevo período propone esta misma semana.'}
      </p>
    </section>
  )
}
