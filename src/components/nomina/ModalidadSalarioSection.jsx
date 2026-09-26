// src/components/nomina/ModalidadSalarioSection.jsx
// Modalidad de pago (día, semana, mes o comisión) con su monto y el desglose
// reactivo. Extraído de EmpleadoConfigModal.jsx para respetar el límite de 600
// líneas del guardarraíl de proyecto.
import { DollarSign, Sparkles } from 'lucide-react'
import { normalizarMontoInput } from '../../utils/montoUtils.js'

const inputCls = 'w-full min-h-11 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[16px] sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all'

const MODALIDADES = [
  { id: 'dia', label: 'Por Día' },
  { id: 'semana', label: 'Por Semana' },
  { id: 'mes', label: 'Por Mes' },
  { id: 'comision', label: 'Por Comisión (Vendedor)' },
]

export default function ModalidadSalarioSection({
  modalidad, montoInput, diasSemana, salarioDiaCalculado, horasJornada, cargando,
  onSeleccionarModalidad, onCambiarMonto,
}) {
  const jornadaNum = Number(horasJornada) || 8
  const tarifaHora = salarioDiaCalculado > 0 && jornadaNum > 0 ? salarioDiaCalculado / jornadaNum : 0
  // `diasSemana` son los días marcados en «Días que trabaja»: el monto semanal se
  // reparte entre ellos (una sola fuente; antes había un selector 5/6/7 aparte).
  const equivalenteSemanal = salarioDiaCalculado * (diasSemana || 6)
  const equivalenteMensual = salarioDiaCalculado * 30

  return (
    <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
      <div className="flex items-center justify-between">
        <label className="text-xs font-black text-slate-700 flex items-center gap-1.5">
          <DollarSign size={15} className="text-primary" />
          Modalidad de Salario / Pago (USD)
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-200/60 text-xs font-bold">
        {MODALIDADES.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSeleccionarModalidad(m.id)}
            className={`py-2 px-1 text-center rounded-xl transition-all ${modalidad === m.id ? 'bg-white text-slate-900 shadow-sm font-black' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {modalidad === 'comision' ? (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-950 space-y-1.5">
          <div className="flex items-center gap-1.5 font-black text-amber-900">
            <Sparkles size={14} className="text-amber-600" />
            <span>Modalidad: Pago de Comisión (Puesto: Vendedor)</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Asignado a <strong>Vendedores</strong> sin sueldo fijo semanal. Cada comisión cobrada se registra directamente como un <strong>Egreso en Finanzas</strong>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500">
              {modalidad === 'dia' ? 'Monto por día (USD) *' : modalidad === 'semana' ? 'Monto por semana (USD) *' : 'Monto mensual (USD) *'}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={montoInput}
              onChange={e => {
                const normalizado = normalizarMontoInput(e.target.value)
                if (normalizado !== null) onCambiarMonto(normalizado)
              }}
              placeholder={modalidad === 'dia' ? 'Ej: 30.00' : modalidad === 'semana' ? 'Ej: 180.00' : 'Ej: 600.00'}
              className={inputCls} disabled={cargando}
            />
          </div>
          {modalidad === 'semana' && (
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-slate-500">Días laborables / semana</span>
              <p
                className={`flex min-h-11 items-center rounded-xl border px-3 text-xs font-bold ${diasSemana > 0
                  ? 'border-slate-200 bg-slate-100 text-slate-600'
                  : 'border-red-200 bg-red-50 text-red-700'}`}
              >
                {diasSemana > 0
                  ? `${diasSemana} día${diasSemana === 1 ? '' : 's'} — se toma de «Días que trabaja»`
                  : 'Marca sus días en «Días que trabaja» para poder guardar'}
              </p>
              <p className="text-[10px] leading-relaxed text-slate-400">
                El monto semanal se reparte entre los días marcados; si cambias la semana, el salario por día se recalcula.
              </p>
            </div>
          )}
          {modalidad === 'mes' && (
            <div className="flex items-center text-[11px] text-slate-400 pt-5">
              <span>Base estándar de 30 días mensuales</span>
            </div>
          )}
        </div>
      )}

      {/* Desglose salarial reactivo */}
      {salarioDiaCalculado > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-2 border-t border-slate-200 min-w-0">
          <div className="p-2 rounded-xl bg-white border border-slate-100 text-center">
            <span className="text-[10px] text-slate-400 block font-medium">Por Día</span>
            <strong className="text-xs font-black text-slate-800">${salarioDiaCalculado.toFixed(2)}</strong>
          </div>
          <div className="p-2 rounded-xl bg-white border border-slate-100 text-center">
            <span className="text-[10px] text-slate-400 block font-medium">Por Hora ({horasJornada}h)</span>
            <strong className="text-xs font-black text-emerald-600">${tarifaHora.toFixed(2)}</strong>
          </div>
          <div className="p-2 rounded-xl bg-white border border-slate-100 text-center">
            <span className="text-[10px] text-slate-400 block font-medium">Semanal</span>
            <strong className="text-xs font-black text-slate-800">${equivalenteSemanal.toFixed(2)}</strong>
          </div>
          <div className="p-2 rounded-xl bg-white border border-slate-100 text-center">
            <span className="text-[10px] text-slate-400 block font-medium">Mensual</span>
            <strong className="text-xs font-black text-slate-800">${equivalenteMensual.toFixed(2)}</strong>
          </div>
        </div>
      )}
    </div>
  )
}
