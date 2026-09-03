// src/components/nomina/TabConfiguracion.jsx
// Configuración administrativa de calendario, recargos, conceptos y reglas.
import { Children, useState } from 'react'
import { DollarSign, Plus, ShieldCheck, Sparkles, Clock, CalendarDays, Lock } from 'lucide-react'
import { useCandados } from '../../config/candadosRuntime.js'
import { useConfigNomina, useGuardarConfigNomina } from '../../hooks/useNomina.js'
import {
  useCrearConcepto,
  useCrearReglaLegal,
  useFeriados,
  useNominaConceptos,
  useReglasLegales,
} from '../../hooks/useNomina.js'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import useTablistNav from '../../../compat/hooks/useTablistNav.js'
import HolidaySummaryCard from './HolidaySummaryCard.jsx'
import RetencionCard from './RetencionCard.jsx'

const inputClass = 'w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'
const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => `${today().slice(0, 8)}01`
const monthEnd = () => {
  const date = new Date()
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
}

export default function TabConfiguracion() {
  const [desde] = useState(monthStart)
  const [hasta] = useState(monthEnd)
  // Lanzamiento por fases: la lógica de nómina va bloqueada; Almacenamiento queda abierto.
  // El estado EN VIVO vive en src/config/candadosRuntime.js (comando secreto lo levanta).
  const { nomina: SECCIONES_BLOQUEADAS } = useCandados()
  const [seccion, setSeccion] = useState(SECCIONES_BLOQUEADAS ? 'retencion' : 'calendario')
  const feriados = useFeriados(desde, hasta)
  const conceptos = useNominaConceptos()
  const reglas = useReglasLegales()
  const configNomina = useConfigNomina()

  const secciones = [
    { id: 'calendario', label: 'Horarios y calendario', description: 'Jornada estándar de empresa y feriados', locked: SECCIONES_BLOQUEADAS },
    { id: 'recargos', label: 'Horas extra y recargos', description: 'Montos fijos en USD por hora extra, sábado y feriado', locked: SECCIONES_BLOQUEADAS },
    { id: 'reglas', label: 'Conceptos y reglas', description: 'Conceptos de recibos y reglas legales', locked: SECCIONES_BLOQUEADAS },
    { id: 'retencion', label: 'Almacenamiento', description: 'Retención y purga inteligente de la base', locked: false },
  ]
  const navegarSecciones = useTablistNav(secciones.filter(item => !item.locked).map(item => item.id), seccion, setSeccion)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-2" role="tablist" aria-label="Objetivos de configuración" onKeyDown={navegarSecciones}>
        {secciones.map(item => {
          const activo = seccion === item.id
          if (item.locked) {
            return <button
              key={item.id}
              type="button"
              disabled
              aria-disabled="true"
              aria-label={`${item.label} — bloqueado temporalmente`}
              className="flex-1 min-w-[200px] sm:min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left cursor-not-allowed"
            >
              <span className="flex items-center gap-1.5 text-xs font-black text-slate-400">{item.label}<Lock size={12} aria-hidden="true" /></span>
              <span className="mt-1 block text-[11px] leading-snug text-slate-300">Disponible próximamente</span>
            </button>
          }
          return <button
            key={item.id}
            type="button"
            id={`config-tab-${item.id}`}
            tabIndex={activo ? 0 : -1}
            role="tab"
            aria-selected={activo}
            aria-controls={`config-panel-${item.id}`}
            onClick={() => setSeccion(item.id)}
            className={`flex-1 min-w-[200px] sm:min-w-0 rounded-2xl border p-3 text-left transition-all ${activo ? 'border-primary bg-primary text-white shadow-md' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
          >
            <span className="block text-xs font-black">{item.label}</span>
            <span className={`mt-1 block text-[11px] leading-snug ${activo ? 'text-white/80' : 'text-slate-400'}`}>{item.description}</span>
          </button>
        })}
      </div>

      <div id={`config-panel-${seccion}`} role="tabpanel" aria-labelledby={`config-tab-${seccion}`} tabIndex={-1}>
        {seccion === 'calendario' && <CalendarPanel
          feriados={feriados}
          configNomina={configNomina}
          onRefresh={() => feriados.refetch()}
        />}
        {seccion === 'recargos' && <SurchargesPanel config={configNomina} />}
        {seccion === 'reglas' && <CatalogPanel conceptos={conceptos} reglas={reglas} />}
        {seccion === 'retencion' && <RetencionCard />}
      </div>
    </div>
  )
}

function CalendarPanel({ feriados, configNomina, onRefresh }) {
  return (
    <div className="space-y-4">
      <StandardScheduleCard configNomina={configNomina} />
      <HolidaySummaryCard feriados={feriados} onRefresh={onRefresh} />
    </div>
  )
}

function StandardScheduleCard({ configNomina }) {
  const guardar = useGuardarConfigNomina()
  const loaded = configNomina.data?.config || configNomina.data || {}
  const [tipoPeriodo, setTipoPeriodo] = useState(loaded.nomina_tipo_periodo || 'semanal')
  const [error, setError] = useState('')

  async function guardarPeriodoDefault(nuevoTipo) {
    setTipoPeriodo(nuevoTipo)
    try {
      await guardar.mutateAsync({ nomina_tipo_periodo: nuevoTipo })
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-800">Horario Laboral Estándar de la Empresa</h2>
            <p className="text-xs text-slate-400">Jornada habitual predeterminada para marcaje y cálculo</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
          <Clock size={20} className="text-primary shrink-0" />
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Horario General</span>
            <span className="text-sm font-black text-slate-800">08:00 AM – 05:00 PM</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
          <CalendarDays size={20} className="text-emerald-600 shrink-0" />
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Jornada Efectiva</span>
            <span className="text-sm font-black text-slate-800">8.0 horas / día (+1h descanso)</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
          <DollarSign size={20} className="text-amber-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block mb-1">Frecuencia por defecto</span>
            <CustomSelect
              value={tipoPeriodo}
              onChange={guardarPeriodoDefault}
              disabled={guardar.isPending}
              options={[
                { value: 'semanal', label: 'Semanal (Lunes a Sábado)' },
                { value: 'quincenal', label: 'Quincenal (1–15 / 16–fin)' },
                { value: 'mensual', label: 'Mensual (30 días)' },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
        <p>
          <strong className="text-slate-700">Régimen semanal:</strong> Lunes a Viernes jornada fija. <span className="text-amber-700 font-bold">Sábados:</span> asistencia rotativa según los trabajadores que laboren cada fin de semana en el módulo de Asistencia.
        </p>
      </div>

      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
    </section>
  )
}

function SurchargesPanel({ config }) {
  const guardar = useGuardarConfigNomina()
  const [form, setForm] = useState({ montoExtra: '', montoSabado: '', montoFeriado: '' })
  const [error, setError] = useState('')
  const loaded = config.data?.config || config.data
  const values = loaded || {
    nomina_factor_hora_extra: 1.5, nomina_factor_sabado: 1.25, nomina_factor_feriado: 2,
    nomina_feriado_modo: 'monto_fijo',
  }

  const formateaMonto = value => (value == null || value === '' ? 'sin monto fijo' : `$${Number(value).toLocaleString('es-VE', { maximumFractionDigits: 2 })}`)

  async function submit(event) {
    event.preventDefault()
    const montoExtra = form.montoExtra === '' ? (values.nomina_monto_hora_extra_usd ?? null) : Number(form.montoExtra)
    const montoSabado = form.montoSabado === '' ? (values.nomina_monto_sabado_usd ?? null) : Number(form.montoSabado)
    const montoFeriado = form.montoFeriado === '' ? (values.nomina_monto_feriado_usd ?? null) : Number(form.montoFeriado)

    const montosActivos = [montoExtra, montoSabado, montoFeriado]
    if (montosActivos.some(monto => monto !== null && (!Number.isFinite(monto) || monto <= 0 || monto > 1000000))) {
      setError('Cada monto fijo debe ser mayor que cero.')
      return
    }

    const payload = {
      nomina_factor_hora_extra: Number(values.nomina_factor_hora_extra || 1.5),
      nomina_factor_sabado: Number(values.nomina_factor_sabado || 1.25),
      nomina_factor_feriado: Number(values.nomina_factor_feriado || 2.0),
      nomina_monto_hora_extra_usd: montoExtra,
      nomina_monto_sabado_usd: montoSabado,
      nomina_monto_feriado_usd: montoFeriado,
      nomina_feriado_modo: 'monto_fijo',
    }
    setError('')
    try {
      await guardar.mutateAsync(payload)
      setForm({ montoExtra: '', montoSabado: '', montoFeriado: '' })
    } catch (saveError) { setError(saveError.message) }
  }

  return (
    <Panel icon={DollarSign} title="Pago de horas extra, sábados y feriados">
      <p className="text-xs text-slate-500">
        Configura los montos directos en dólares para horas extras, sábados y días feriados trabajados. Si dejas una casilla vacía, se calcula automáticamente según el sueldo proporcional.
      </p>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label={`Monto fijo por hora extra (USD) · actual ${formateaMonto(values.nomina_monto_hora_extra_usd)}`}>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.montoExtra}
            onChange={event => setForm(current => ({ ...current, montoExtra: event.target.value }))}
            placeholder="Ej. 4.00"
            className={inputClass}
            disabled={guardar.isPending}
          />
        </Field>
        <Field label={`Monto fijo por sábado trabajado (USD) · actual ${formateaMonto(values.nomina_monto_sabado_usd)}`}>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.montoSabado}
            onChange={event => setForm(current => ({ ...current, montoSabado: event.target.value }))}
            placeholder="Ej. 30.00"
            className={inputClass}
            disabled={guardar.isPending}
          />
        </Field>
        <Field label={`Monto fijo por feriado (USD) · actual ${formateaMonto(values.nomina_monto_feriado_usd)}`}>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.montoFeriado}
            onChange={event => setForm(current => ({ ...current, montoFeriado: event.target.value }))}
            placeholder="Ej. 30.00"
            className={inputClass}
            disabled={guardar.isPending}
          />
        </Field>
        {error && (
          <p className="sm:col-span-3 rounded-lg bg-red-50 border border-red-200 px-2.5 py-2 text-xs text-red-700" role="alert">
            {error}
          </p>
        )}
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={guardar.isPending || config.isLoading}
            className="inline-flex items-center min-h-11 gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-black text-white disabled:opacity-50 hover:bg-primary-hover transition-all active:scale-95 shadow-xs"
            style={{ touchAction: 'manipulation' }}
          >
            {guardar.isPending ? 'Guardando...' : 'Guardar montos'}
          </button>
        </div>
      </form>
    </Panel>
  )
}

function CatalogPanel({ conceptos, reglas }) {
  return <Panel icon={ShieldCheck} title="Conceptos y reglas de nómina">
    <p className="text-xs text-slate-500">Define los conceptos que aparecen en los recibos y las reglas que deben ser aprobadas antes de usarse.</p>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><ConceptForm /><RuleForm /></div>
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <DataList title="Conceptos activos" loading={conceptos.isLoading} error={conceptos.isError} onRetry={() => conceptos.refetch()}>
        {(conceptos.data || []).map(item => <ListRow key={item.id} title={`${item.codigo} · ${item.nombre}`} detail={`${item.tipo} · ${item.moneda_default}`} />)}
      </DataList>
      <DataList title="Reglas registradas" loading={reglas.isLoading} error={reglas.isError} onRetry={() => reglas.refetch()}>
        {(reglas.data || []).map(item => <ListRow key={item.id} title={`${item.codigo} · ${item.nombre}`} detail={`${item.version} · ${item.aprobado_por ? 'Aprobada' : 'Pendiente'}`} />)}
      </DataList>
    </div>
  </Panel>
}

function ConceptForm() {
  const crear = useCrearConcepto()
  const [form, setForm] = useState({ codigo: '', nombre: '', tipo: 'ingreso', monedaDefault: 'USD', fechaDesde: today(), formulaKey: '', imponible: false, obligatorio: false })
  const [error, setError] = useState('')
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }))
  async function submit(event) {
    event.preventDefault()
    setError('')
    try { await crear.mutateAsync(form); setForm(current => ({ ...current, codigo: '', nombre: '' })) } catch (submitError) { setError(submitError.message) }
  }
  return <FormCard title="Nuevo concepto" onSubmit={submit} pending={crear.isPending} error={error}>
    <div className="grid grid-cols-2 gap-2"><Field label="Código"><input value={form.codigo} onChange={e => change('codigo', e.target.value)} maxLength={40} className={inputClass} placeholder="BONO_OBRA" disabled={crear.isPending} /></Field><Field label="Tipo"><CustomSelect value={form.tipo} onChange={value => change('tipo', value)} options={[{ value: 'ingreso', label: 'Ingreso' }, { value: 'deduccion', label: 'Deducción' }, { value: 'aporte_patronal', label: 'Aporte patronal' }, { value: 'retencion', label: 'Retención' }]} disabled={crear.isPending} /></Field></div>
    <Field label="Nombre"><input value={form.nombre} onChange={e => change('nombre', e.target.value)} maxLength={160} className={inputClass} placeholder="Bono de obra" disabled={crear.isPending} /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Moneda"><CustomSelect value={form.monedaDefault} onChange={value => change('monedaDefault', value)} options={['USD', 'VES', 'USDT'].map(value => ({ value, label: value }))} disabled={crear.isPending} /></Field><Field label="Fórmula (opcional)"><input value={form.formulaKey} onChange={e => change('formulaKey', e.target.value)} className={inputClass} placeholder="formula_aprobada" disabled={crear.isPending} /></Field></div>
    <div className="flex flex-wrap gap-3 text-xs font-bold text-slate-600"><label className="flex items-center gap-2"><input type="checkbox" checked={form.imponible} onChange={e => change('imponible', e.target.checked)} disabled={crear.isPending} /> Imponible</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.obligatorio} onChange={e => change('obligatorio', e.target.checked)} disabled={crear.isPending} /> Obligatorio</label></div>
  </FormCard>
}

function RuleForm() {
  const crear = useCrearReglaLegal()
  const [form, setForm] = useState({ codigo: '', nombre: '', tipo: 'porcentaje', valor: '', unidad: 'porcentaje', formulaKey: '', baseKey: '', fechaDesde: today(), version: '', fuente: '' })
  const [error, setError] = useState('')
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }))
  async function submit(event) {
    event.preventDefault()
    setError('')
    try { await crear.mutateAsync({ ...form, valor: form.valor === '' ? null : Number(form.valor) }) } catch (submitError) { setError(submitError.message) }
  }
  return <FormCard title="Agregar regla (requiere aprobación)" onSubmit={submit} pending={crear.isPending} error={error}>
    <div className="grid grid-cols-2 gap-2"><Field label="Código"><input value={form.codigo} onChange={e => change('codigo', e.target.value)} maxLength={60} className={inputClass} placeholder="IVSS" disabled={crear.isPending} /></Field><Field label="Tipo"><CustomSelect value={form.tipo} onChange={value => change('tipo', value)} options={[{ value: 'porcentaje', label: 'Porcentaje' }, { value: 'monto_fijo', label: 'Monto fijo' }, { value: 'formula', label: 'Fórmula' }]} disabled={crear.isPending} /></Field></div>
    <Field label="Nombre"><input value={form.nombre} onChange={e => change('nombre', e.target.value)} maxLength={160} className={inputClass} placeholder="Aporte legal" disabled={crear.isPending} /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Valor"><input type="number" min="0" step="0.0001" value={form.valor} onChange={e => change('valor', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field><Field label="Unidad"><CustomSelect value={form.unidad} onChange={value => change('unidad', value)} options={[{ value: 'porcentaje', label: 'Porcentaje' }, { value: 'VES', label: 'VES' }, { value: 'USD', label: 'USD' }, { value: 'factor', label: 'Factor' }, { value: 'formula', label: 'Fórmula' }]} disabled={crear.isPending} /></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Versión"><input value={form.version} onChange={e => change('version', e.target.value)} maxLength={80} className={inputClass} placeholder="2026.1" disabled={crear.isPending} /></Field><Field label="Fuente legal"><input value={form.fuente} onChange={e => change('fuente', e.target.value)} maxLength={240} className={inputClass} placeholder="Gaceta / resolución" disabled={crear.isPending} /></Field></div>
    <Field label="Fórmula o base (opcional)"><input value={form.formulaKey} onChange={e => change('formulaKey', e.target.value)} className={inputClass} placeholder="formula_aprobada" disabled={crear.isPending} /></Field>
  </FormCard>
}

function Panel({ icon: Icon, title, action, children }) {
  return <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3"><div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-black text-slate-800"><span className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon size={16} /></span>{title}</h2>{action}</div>{children}</section>
}

function FormCard({ title, onSubmit, pending, error, children }) {
  return <form onSubmit={onSubmit} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3 space-y-3"><div className="flex items-center gap-2 text-xs font-black text-slate-700"><Plus size={14} className="text-primary" />{title}</div>{error && <p className="rounded-lg bg-red-50 border border-red-200 px-2.5 py-2 text-xs text-red-700" role="alert">{error}</p>}{children}<button type="submit" disabled={pending} className="inline-flex items-center min-h-11 gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-black text-white hover:bg-primary-hover disabled:opacity-50">{pending ? 'Guardando...' : 'Guardar'}</button></form>
}

function Field({ label, children }) { return <label className="block min-w-0"><span className="mb-1 block text-[11px] font-bold text-slate-500">{label}</span>{children}</label> }
function DataList({ title, loading, error, onRetry, children }) { return <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-black text-slate-700">{title}</h3>{error && <button type="button" onClick={onRetry} className="text-[11px] font-bold text-red-600 underline">Volver a intentar</button>}</div>{loading ? <Skeleton className="h-12 rounded-lg" /> : error ? <p className="text-xs text-red-600">No se pudo cargar.</p> : Children.count(children) > 0 ? children : <p className="text-xs text-slate-400">Sin registros.</p>}</div> }
function ListRow({ title, detail }) { return <div className="border-t border-slate-100 py-2 first:border-t-0"><p className="truncate text-xs font-bold text-slate-700">{title}</p><p className="truncate text-[11px] text-slate-400">{detail}</p></div> }
