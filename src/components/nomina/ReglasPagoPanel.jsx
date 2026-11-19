// src/components/nomina/ReglasPagoPanel.jsx
// Configuración → «Reglas de pago y de la ley». Todo lo que decide cuánto se paga
// queda editable aquí por si cambia la ley o la política de la empresa:
//   - hora extra, sábado y domingo/feriado trabajados: por FACTOR o MONTO FIJO;
//   - reglas de la ley (migración 263): divisor del sueldo mensual, días
//     laborables por defecto, descanso pagado y faltas que lo hacen perder.
// Solo quien tiene `administrarSistema` (jefe) guarda; el servidor exige lo mismo.
import { useState } from 'react'
import { DollarSign, RotateCcw, Scale } from 'lucide-react'
import { useGuardarConfigNomina } from '../../hooks/useNomina.js'
import useAuthStore from '../../../compat/store/useAuthStore.js'
import { tieneCapacidad } from '../../config/accesoModulos.js'
import { Switch } from '../ui/index.js'
import { NOMBRE_DIA_CORTO } from '../../utils/diasLaborables.js'
import { FALTAS_PIERDE_DESCANSO_LEY, LIMITES_REGLAS_LEY, REGLAS_LEY_DEFAULT, reglasLeyDeConfig } from '../../../server/lib/nominaReglasLey.js'

const inputCls = 'w-full min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[16px] sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

// Valores mínimos de la LOTTT para el botón «Valores de la ley».
const LEY_PAGOS = { extra: 1.5, sabado: 1.5, feriado: 1.5 }

const CONCEPTOS = [
  {
    id: 'extra', titulo: 'Hora extra',
    factor: 'nomina_factor_hora_extra', monto: 'nomina_monto_hora_extra_usd',
    ayudaFactor: 'Factor × la hora normal (sueldo diario ÷ horas de la jornada). Ley: mínimo 1,5 (art. 118).',
    ayudaMonto: 'Monto fijo en dólares por cada hora extra, igual para todos.',
  },
  {
    id: 'sabado', titulo: 'Sábado trabajado',
    factor: 'nomina_factor_sabado', monto: 'nomina_monto_sabado_usd',
    ayudaFactor: 'Se suma al descanso pagado: 1 = un día de sueldo más; 1,5 = día y medio. Ley: 1,5 (art. 120).',
    ayudaMonto: 'Monto fijo en dólares por cada sábado trabajado.',
  },
  {
    id: 'feriado', titulo: 'Domingo o feriado trabajado',
    factor: 'nomina_factor_feriado', monto: 'nomina_monto_feriado_usd',
    ayudaFactor: 'Se suma al descanso pagado: 1 = un día de sueldo más; 1,5 = día y medio. Ley: 1,5 (art. 120).',
    ayudaMonto: 'Monto fijo en dólares por cada domingo o feriado trabajado.',
  },
]

function modoInicial(config, concepto) {
  const monto = config?.[concepto.monto]
  const tieneMonto = monto != null && Number(monto) > 0
  if (concepto.id === 'feriado') return tieneMonto && config?.nomina_feriado_modo === 'monto_fijo' ? 'monto' : 'factor'
  return tieneMonto ? 'monto' : 'factor'
}

function estadoDesdeConfig(config) {
  const reglas = reglasLeyDeConfig(config)
  const pagos = Object.fromEntries(CONCEPTOS.map(c => [c.id, {
    modo: modoInicial(config, c),
    factor: String(config?.[c.factor] ?? 1.5),
    monto: config?.[c.monto] != null ? String(config[c.monto]) : '',
  }]))
  return {
    pagos,
    divisor: String(reglas.divisorMensual),
    dias: reglas.diasLaborablesDefault,
    descanso: reglas.descansoRemunerado,
    faltas: String(reglas.faltasPierdeDescanso),
    bono: String(reglas.bonoSemanalUsd),
  }
}

function construirPayload(form) {
  const payload = {}
  for (const c of CONCEPTOS) {
    const p = form.pagos[c.id]
    if (p.modo === 'factor') {
      const factor = Number(String(p.factor).replace(',', '.'))
      if (!Number.isFinite(factor) || factor < 1 || factor > 10) return { error: `${c.titulo}: el factor debe estar entre 1 y 10` }
      payload[c.factor] = factor
      payload[c.monto] = null
    } else {
      const monto = Number(String(p.monto).replace(',', '.'))
      if (!Number.isFinite(monto) || monto <= 0) return { error: `${c.titulo}: el monto fijo debe ser mayor que 0` }
      payload[c.monto] = monto
    }
  }
  payload.nomina_feriado_modo = form.pagos.feriado.modo === 'monto' ? 'monto_fijo' : 'factor'
  const divisor = Number(form.divisor)
  const { min: dMin, max: dMax } = LIMITES_REGLAS_LEY.divisorMensual
  if (!Number.isInteger(divisor) || divisor < dMin || divisor > dMax) return { error: `El divisor del sueldo mensual debe ser un entero entre ${dMin} y ${dMax}` }
  const faltas = Number(form.faltas)
  const { min: fMin, max: fMax } = LIMITES_REGLAS_LEY.faltasPierdeDescanso
  if (!Number.isInteger(faltas) || faltas < fMin || faltas > fMax) return { error: `Las faltas deben ser un entero entre ${fMin} y ${fMax}` }
  if (!form.dias.length) return { error: 'Marca al menos un día laborable por defecto' }
  payload.nomina_divisor_mensual = divisor
  payload.nomina_dias_laborables_default = [...form.dias].sort((a, b) => a - b)
  payload.nomina_descanso_remunerado = form.descanso
  payload.nomina_faltas_pierde_descanso = faltas
  const bono = Number(String(form.bono ?? '').replace(',', '.'))
  const { min: bMin, max: bMax } = LIMITES_REGLAS_LEY.bonoSemanalUsd
  if (String(form.bono ?? '').trim() === '' || !Number.isFinite(bono) || bono < bMin || bono > bMax) return { error: `El bono semanal debe ser un monto entre $${bMin} y $${bMax}` }
  payload.nomina_bono_semanal_usd = Math.round(bono * 100) / 100
  return { payload }
}

function Bloque({ titulo, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 min-w-0">
      <h3 className="text-xs font-black text-slate-700">{titulo}</h3>
      {children}
    </div>
  )
}

export default function ReglasPagoPanel({ config }) {
  const guardar = useGuardarConfigNomina()
  const perfil = useAuthStore(s => s.perfil)
  const puedeEditar = tieneCapacidad(perfil, 'administrarNomina')
  const cargado = config.data?.config || config.data
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const actual = form ?? estadoDesdeConfig(cargado)
  const bloqueado = !puedeEditar || guardar.isPending || config.isLoading

  const cambiar = cambio => setForm(previo => ({ ...(previo ?? estadoDesdeConfig(cargado)), ...cambio }))
  const cambiarPago = (id, cambio) => cambiar({ pagos: { ...actual.pagos, [id]: { ...actual.pagos[id], ...cambio } } })
  const alternarDia = dia => cambiar({ dias: actual.dias.includes(dia) ? actual.dias.filter(d => d !== dia) : [...actual.dias, dia] })

  function valoresDeLey() {
    setError('')
    setForm({
      pagos: Object.fromEntries(CONCEPTOS.map(c => [c.id, { modo: 'factor', factor: String(LEY_PAGOS[c.id]), monto: '' }])),
      divisor: String(REGLAS_LEY_DEFAULT.divisorMensual),
      dias: [...REGLAS_LEY_DEFAULT.diasLaborablesDefault],
      descanso: REGLAS_LEY_DEFAULT.descansoRemunerado,
      faltas: String(FALTAS_PIERDE_DESCANSO_LEY),
      // El bono no es de la ley: se conserva el que esté escrito.
      bono: actual.bono,
    })
  }

  async function enviar(event) {
    event.preventDefault()
    const { payload, error: invalido } = construirPayload(actual)
    if (invalido) { setError(invalido); return }
    setError('')
    try {
      await guardar.mutateAsync(payload)
      setForm(null)
    } catch (e) { setError(e.message) }
  }

  return (
    <form onSubmit={enviar} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-black text-slate-800"><Scale size={16} className="text-primary shrink-0" /> Reglas de pago y de la ley</h2>
          <p className="text-xs text-slate-500">Todo lo que decide cuánto se paga. Si cambia la ley, se ajusta aquí sin tocar el sistema. Los cambios se aplican al recalcular un período.</p>
        </div>
        {puedeEditar && (
          <button type="button" onClick={valoresDeLey} disabled={bloqueado}
            className="inline-flex items-center gap-1.5 min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            style={{ touchAction: 'manipulation' }}>
            <RotateCcw size={14} /> Valores de la ley
          </button>
        )}
      </div>
      {!puedeEditar && <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">Solo quien administra la nómina puede cambiar estas reglas.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {CONCEPTOS.map(c => {
          const p = actual.pagos[c.id]
          return (
            <Bloque key={c.id} titulo={c.titulo}>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100" role="radiogroup" aria-label={`Cómo se paga: ${c.titulo}`}>
                {[['factor', 'Por factor'], ['monto', 'Monto fijo']].map(([modo, etiqueta]) => (
                  <button key={modo} type="button" role="radio" aria-checked={p.modo === modo} disabled={bloqueado}
                    onClick={() => cambiarPago(c.id, { modo })}
                    className={`min-h-11 rounded-lg text-xs font-bold transition-all ${p.modo === modo ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                    style={{ touchAction: 'manipulation' }}>{etiqueta}</button>
                ))}
              </div>
              <label className="block min-w-0">
                <span className="mb-1 flex items-center gap-1 text-[11px] font-bold text-slate-500">
                  {p.modo === 'factor' ? 'Factor (× sueldo)' : <><DollarSign size={12} /> Monto en USD</>}
                </span>
                <input type="text" inputMode="decimal" className={inputCls} disabled={bloqueado}
                  aria-label={`${c.titulo}: ${p.modo === 'factor' ? 'factor' : 'monto fijo'}`}
                  value={p.modo === 'factor' ? p.factor : p.monto}
                  onChange={e => cambiarPago(c.id, p.modo === 'factor' ? { factor: e.target.value } : { monto: e.target.value })} />
              </label>
              <p className="text-[11px] leading-relaxed text-slate-500">{p.modo === 'factor' ? c.ayudaFactor : c.ayudaMonto}</p>
            </Bloque>
          )
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Bloque titulo="Sueldo diario">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-slate-500">Dividir el sueldo mensual entre (días)</span>
            <input type="text" inputMode="numeric" className={inputCls} disabled={bloqueado} aria-label="Divisor del sueldo mensual"
              value={actual.divisor} onChange={e => cambiar({ divisor: e.target.value })} />
          </label>
          <p className="text-[11px] text-slate-500">Ley: 30 (art. 113). Cambiarlo no recalcula los sueldos ya guardados en cada ficha.</p>
        </Bloque>

        <Bloque titulo="Días laborables por defecto">
          <div className="grid grid-cols-6 gap-1" role="group" aria-label="Días laborables por defecto">
            {[1, 2, 3, 4, 5, 6].map(dia => {
              const activo = actual.dias.includes(dia)
              return (
                <button key={dia} type="button" aria-pressed={activo} disabled={bloqueado} onClick={() => alternarDia(dia)}
                  className={`min-h-11 rounded-lg border text-xs font-bold ${activo ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-slate-500'}`}
                  style={{ touchAction: 'manipulation' }}>{NOMBRE_DIA_CORTO[dia]}</button>
              )
            })}
          </div>
          <p className="text-[11px] text-slate-500">Para quien no tiene su semana guardada. El domingo nunca es laborable. Ley: lunes a viernes (art. 173).</p>
        </Bloque>

        <Bloque titulo="Descanso pagado">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-600">Pagar sábado, domingo y feriados aunque no se trabajen</span>
            <Switch checked={actual.descanso} onChange={() => !bloqueado && cambiar({ descanso: !actual.descanso })} label="Descanso pagado" />
          </div>
          <p className="text-[11px] text-slate-500">Ley: sí (art. 119).</p>
        </Bloque>

        <Bloque titulo="Faltas que hacen perder el descanso">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-slate-500">Desde cuántas faltas en la semana (0 = nunca se descuenta)</span>
            <input type="text" inputMode="numeric" className={inputCls} disabled={bloqueado || !actual.descanso} aria-label="Faltas que hacen perder el descanso"
              value={actual.faltas} onChange={e => cambiar({ faltas: e.target.value })} />
          </label>
          <p className="text-[11px] text-slate-500">Con 0, una falta sin justificativo descuenta solo el día faltado y el descanso se paga completo. Con otro número, desde esa falta cada una descuenta además un día de descanso. Empresa: {REGLAS_LEY_DEFAULT.faltasPierdeDescanso}. Ley: {FALTAS_PIERDE_DESCANSO_LEY} (art. 119). Las faltas justificadas nunca cuentan.</p>
        </Bloque>

        <Bloque titulo="Bono semanal">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-slate-500">Monto por semana (USD)</span>
            <input type="text" inputMode="decimal" className={inputCls} disabled={bloqueado} aria-label="Bono semanal en dólares"
              value={actual.bono} onChange={e => cambiar({ bono: e.target.value })} />
          </label>
          <p className="text-[11px] text-slate-500">Sale de la semana (días trabajados + días pagados sin trabajar); no se suma al sueldo: el sueldo semanal es lo que queda. Se aplica una vez por semana del período y cada recibo guarda el bono que le tocó al calcular, así que cambiarlo no altera recibos ya calculados o pagados. Por defecto: ${REGLAS_LEY_DEFAULT.bonoSemanalUsd}.</p>
        </Bloque>
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">{error}</p>}
      {puedeEditar && (
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={bloqueado}
            className="inline-flex items-center min-h-11 rounded-xl bg-primary px-4 text-xs font-black text-white disabled:opacity-50 hover:bg-primary-hover active:scale-95 shadow-xs"
            style={{ touchAction: 'manipulation' }}>
            {guardar.isPending ? 'Guardando...' : 'Guardar reglas'}
          </button>
          {form && (
            <button type="button" onClick={() => { setForm(null); setError('') }} disabled={guardar.isPending}
              className="inline-flex items-center min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700"
              style={{ touchAction: 'manipulation' }}>Descartar cambios</button>
          )}
        </div>
      )}
    </form>
  )
}
