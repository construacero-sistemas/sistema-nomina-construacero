// src/components/nomina/TabConfiguracion.jsx
// Configuración administrativa de calendario, tasas, conceptos y reglas.
import { Children, useState } from 'react'
import { CalendarDays, Plus, RefreshCw, Scale, ShieldCheck } from 'lucide-react'
import {
  useConfigEmpleados,
  useCrearConcepto,
  useCrearFeriado,
  useCrearHorario,
  useCrearReglaLegal,
  useCrearTasaSnapshot,
  useFeriados,
  useHorarios,
  useNominaConceptos,
  useReglasLegales,
  useTasasSnapshots,
} from '../../hooks/useNomina.js'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'

const inputClass = 'w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'
const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => `${today().slice(0, 8)}01`
const monthEnd = () => {
  const date = new Date()
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
}

export default function TabConfiguracion() {
  const [desde, setDesde] = useState(monthStart)
  const [hasta, setHasta] = useState(monthEnd)
  const feriados = useFeriados(desde, hasta)
  const tasas = useTasasSnapshots(desde, hasta)
  const horarios = useHorarios()
  const conceptos = useNominaConceptos()
  const reglas = useReglasLegales()
  const { data: empleados = [] } = useConfigEmpleados()

  return (
    <div className="space-y-4">
      <section className="bg-blue-50 border border-blue-200 rounded-2xl p-3 text-xs text-blue-900">
        <strong>Configuración controlada:</strong> las reglas y tasas nuevas quedan pendientes de aprobación y no cambian períodos ya calculados.
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <CalendarPanel
          feriados={feriados}
          horarios={horarios}
          empleados={empleados}
          onRefresh={() => { feriados.refetch(); horarios.refetch() }}
        />
        <RatesPanel
          desde={desde}
          hasta={hasta}
          setDesde={setDesde}
          setHasta={setHasta}
          tasas={tasas}
        />
      </div>

      <CatalogPanel conceptos={conceptos} reglas={reglas} />
    </div>
  )
}

function CalendarPanel({ feriados, horarios, empleados, onRefresh }) {
  return (
    <Panel icon={CalendarDays} title="Calendario laboral" action={<RefreshButton onClick={onRefresh} loading={feriados.isFetching || horarios.isFetching} />}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HolidayForm />
        <ScheduleForm empleados={empleados} />
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DataList title="Feriados del rango" loading={feriados.isLoading} error={feriados.isError} onRetry={() => feriados.refetch()}>
          {(feriados.data || []).map(item => <ListRow key={item.id || item.fecha} title={item.nombre} detail={`${item.fecha} · ${item.laborable ? 'Laborable' : 'No laborable'}`} />)}
        </DataList>
        <DataList title="Horarios registrados" loading={horarios.isLoading} error={horarios.isError} onRetry={() => horarios.refetch()}>
          {(horarios.data || []).slice(0, 20).map(item => <ListRow key={item.id} title={empleados.find(e => e.empleado_id === item.empleado_id)?.empleado?.nombre || 'Horario general'} detail={`${dayName(item.dia_semana)} · ${String(item.hora_inicio).slice(0, 5)}–${String(item.hora_fin).slice(0, 5)}`} />)}
        </DataList>
      </div>
    </Panel>
  )
}

function HolidayForm() {
  const crear = useCrearFeriado()
  const [form, setForm] = useState({ fecha: today(), nombre: '', tipo: 'empresa', laborable: false })
  const [error, setError] = useState('')
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }))
  async function submit(event) {
    event.preventDefault()
    if (!form.nombre.trim()) { setError('El nombre es obligatorio'); return }
    setError('')
    try { await crear.mutateAsync({ ...form, nombre: form.nombre.trim() }); setForm(current => ({ ...current, nombre: '' })) } catch (submitError) { setError(submitError.message) }
  }
  return <FormCard title="Nuevo feriado" onSubmit={submit} pending={crear.isPending} error={error}>
    <Field label="Fecha"><input type="date" value={form.fecha} onChange={e => change('fecha', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field>
    <Field label="Nombre"><input value={form.nombre} onChange={e => change('nombre', e.target.value)} maxLength={160} className={inputClass} placeholder="Ej. Día de la empresa" disabled={crear.isPending} /></Field>
    <Field label="Tipo"><select value={form.tipo} onChange={e => change('tipo', e.target.value)} className={inputClass} disabled={crear.isPending}><option value="empresa">Empresa</option><option value="nacional">Nacional</option><option value="regional">Regional</option></select></Field>
    <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={form.laborable} onChange={e => change('laborable', e.target.checked)} disabled={crear.isPending} /> Laborable con recargo</label>
  </FormCard>
}

function ScheduleForm({ empleados }) {
  const crear = useCrearHorario()
  const [form, setForm] = useState({ empleadoId: '', diaSemana: '6', semanaCiclo: '', grupoRotacion: '', fechaDesde: today(), fechaHasta: '', horaInicio: '08:00', horaFin: '17:00', horasJornada: '8', trabaja: true })
  const [error, setError] = useState('')
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }))
  async function submit(event) {
    event.preventDefault()
    setError('')
    try {
      await crear.mutateAsync({ ...form, diaSemana: Number(form.diaSemana), semanaCiclo: form.semanaCiclo ? Number(form.semanaCiclo) : null, horasJornada: Number(form.horasJornada), empleadoId: form.empleadoId || undefined, fechaHasta: form.fechaHasta || null })
    } catch (submitError) { setError(submitError.message) }
  }
  return <FormCard title="Nuevo horario / rotación" onSubmit={submit} pending={crear.isPending} error={error}>
    <Field label="Empleado (opcional)"><select value={form.empleadoId} onChange={e => change('empleadoId', e.target.value)} className={inputClass} disabled={crear.isPending}><option value="">Horario general</option>{empleados.map(item => <option key={item.empleado_id} value={item.empleado_id}>{item.empleado?.nombre || 'Empleado'}</option>)}</select></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Día"><select value={form.diaSemana} onChange={e => change('diaSemana', e.target.value)} className={inputClass} disabled={crear.isPending}>{[0, 1, 2, 3, 4, 5, 6].map(day => <option key={day} value={day}>{dayName(day)}</option>)}</select></Field><Field label="Horas"><input type="number" min="0.5" max="24" step="0.5" value={form.horasJornada} onChange={e => change('horasJornada', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Ciclo (1–5)"><input type="number" min="1" max="5" value={form.semanaCiclo} onChange={e => change('semanaCiclo', e.target.value)} className={inputClass} placeholder="Opcional" disabled={crear.isPending} /></Field><Field label="Grupo"><input value={form.grupoRotacion} onChange={e => change('grupoRotacion', e.target.value)} maxLength={80} className={inputClass} placeholder="A / B" disabled={crear.isPending} /></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Desde"><input type="date" value={form.fechaDesde} onChange={e => change('fechaDesde', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field><Field label="Hasta"><input type="date" value={form.fechaHasta} onChange={e => change('fechaHasta', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Entrada"><input type="time" value={form.horaInicio} onChange={e => change('horaInicio', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field><Field label="Salida"><input type="time" value={form.horaFin} onChange={e => change('horaFin', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field></div>
    <label className="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={form.trabaja} onChange={e => change('trabaja', e.target.checked)} disabled={crear.isPending} /> Trabaja ese día</label>
  </FormCard>
}

function RatesPanel({ desde, hasta, setDesde, setHasta, tasas }) {
  const crear = useCrearTasaSnapshot()
  const [form, setForm] = useState({ fecha: today(), monedaOrigen: 'USD', valor: '', fuente: 'BCV', observadoEn: '' })
  const [error, setError] = useState('')
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }))
  async function submit(event) {
    event.preventDefault()
    if (!(Number(form.valor) > 0)) { setError('La tasa debe ser mayor que cero'); return }
    setError('')
    try { await crear.mutateAsync({ ...form, valor: Number(form.valor), observadoEn: form.observadoEn || undefined }) } catch (submitError) { setError(submitError.message) }
  }
  return <Panel icon={Scale} title="Tasas multimoneda" action={<RefreshButton onClick={() => tasas.refetch()} loading={tasas.isFetching} />}>
    <div className="grid grid-cols-2 gap-2 mb-3"><Field label="Desde"><input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={inputClass} /></Field><Field label="Hasta"><input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={inputClass} /></Field></div>
    <FormCard title="Nuevo snapshot" onSubmit={submit} pending={crear.isPending} error={error}>
      <div className="grid grid-cols-2 gap-2"><Field label="Fecha"><input type="date" value={form.fecha} onChange={e => change('fecha', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field><Field label="Moneda"><select value={form.monedaOrigen} onChange={e => change('monedaOrigen', e.target.value)} className={inputClass} disabled={crear.isPending}><option>USD</option><option>EUR</option><option>USDT</option></select></Field></div>
      <div className="grid grid-cols-2 gap-2"><Field label="Valor en VES"><input type="number" min="0.000001" step="0.000001" value={form.valor} onChange={e => change('valor', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field><Field label="Fuente"><select value={form.fuente} onChange={e => change('fuente', e.target.value)} className={inputClass} disabled={crear.isPending}><option>BCV</option><option>EURO</option><option>USDT</option><option>MANUAL</option></select></Field></div>
      <Field label="Fecha/hora observada (opcional)"><input type="datetime-local" value={form.observadoEn} onChange={e => change('observadoEn', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field>
    </FormCard>
    <DataList title="Snapshots del rango" loading={tasas.isLoading} error={tasas.isError} onRetry={() => tasas.refetch()}>
      {(tasas.data || []).map(item => <ListRow key={item.id} title={`${item.moneda_origen} → VES · ${item.valor}`} detail={`${item.fecha} · ${item.fuente} · ${item.aprobado ? 'Aprobada' : 'Pendiente'}`} />)}
    </DataList>
  </Panel>
}

function CatalogPanel({ conceptos, reglas }) {
  return <Panel icon={ShieldCheck} title="Conceptos y reglas legales">
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
    <div className="grid grid-cols-2 gap-2"><Field label="Código"><input value={form.codigo} onChange={e => change('codigo', e.target.value)} maxLength={40} className={inputClass} placeholder="BONO_OBRA" disabled={crear.isPending} /></Field><Field label="Tipo"><select value={form.tipo} onChange={e => change('tipo', e.target.value)} className={inputClass} disabled={crear.isPending}><option value="ingreso">Ingreso</option><option value="deduccion">Deducción</option><option value="aporte_patronal">Aporte patronal</option><option value="retencion">Retención</option></select></Field></div>
    <Field label="Nombre"><input value={form.nombre} onChange={e => change('nombre', e.target.value)} maxLength={160} className={inputClass} placeholder="Bono de obra" disabled={crear.isPending} /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Moneda"><select value={form.monedaDefault} onChange={e => change('monedaDefault', e.target.value)} className={inputClass} disabled={crear.isPending}><option>USD</option><option>VES</option><option>EUR</option><option>USDT</option></select></Field><Field label="Fórmula (opcional)"><input value={form.formulaKey} onChange={e => change('formulaKey', e.target.value)} className={inputClass} placeholder="formula_aprobada" disabled={crear.isPending} /></Field></div>
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
  return <FormCard title="Nueva regla (requiere aprobación)" onSubmit={submit} pending={crear.isPending} error={error}>
    <div className="grid grid-cols-2 gap-2"><Field label="Código"><input value={form.codigo} onChange={e => change('codigo', e.target.value)} maxLength={60} className={inputClass} placeholder="IVSS" disabled={crear.isPending} /></Field><Field label="Tipo"><select value={form.tipo} onChange={e => change('tipo', e.target.value)} className={inputClass} disabled={crear.isPending}><option value="porcentaje">Porcentaje</option><option value="monto_fijo">Monto fijo</option><option value="formula">Fórmula</option></select></Field></div>
    <Field label="Nombre"><input value={form.nombre} onChange={e => change('nombre', e.target.value)} maxLength={160} className={inputClass} placeholder="Aporte legal" disabled={crear.isPending} /></Field>
    <div className="grid grid-cols-2 gap-2"><Field label="Valor"><input type="number" min="0" step="0.0001" value={form.valor} onChange={e => change('valor', e.target.value)} className={inputClass} disabled={crear.isPending} /></Field><Field label="Unidad"><select value={form.unidad} onChange={e => change('unidad', e.target.value)} className={inputClass} disabled={crear.isPending}><option value="porcentaje">Porcentaje</option><option value="VES">VES</option><option value="USD">USD</option><option value="factor">Factor</option><option value="formula">Fórmula</option></select></Field></div>
    <div className="grid grid-cols-2 gap-2"><Field label="Versión"><input value={form.version} onChange={e => change('version', e.target.value)} maxLength={80} className={inputClass} placeholder="2026.1" disabled={crear.isPending} /></Field><Field label="Fuente legal"><input value={form.fuente} onChange={e => change('fuente', e.target.value)} maxLength={240} className={inputClass} placeholder="Gaceta / resolución" disabled={crear.isPending} /></Field></div>
    <Field label="Fórmula o base (opcional)"><input value={form.formulaKey} onChange={e => change('formulaKey', e.target.value)} className={inputClass} placeholder="formula_aprobada" disabled={crear.isPending} /></Field>
  </FormCard>
}

function Panel({ icon: Icon, title, action, children }) {
  return <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3"><div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-black text-slate-800"><span className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon size={16} /></span>{title}</h2>{action}</div>{children}</section>
}

function FormCard({ title, onSubmit, pending, error, children }) {
  return <form onSubmit={onSubmit} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3 space-y-3"><div className="flex items-center gap-2 text-xs font-black text-slate-700"><Plus size={14} className="text-primary" />{title}</div>{error && <p className="rounded-lg bg-red-50 border border-red-200 px-2.5 py-2 text-xs text-red-700" role="alert">{error}</p>}{children}<button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-black text-white hover:bg-primary-hover disabled:opacity-50">{pending ? 'Guardando...' : 'Guardar'}</button></form>
}

function Field({ label, children }) { return <label className="block min-w-0"><span className="mb-1 block text-[11px] font-bold text-slate-500">{label}</span>{children}</label> }
function RefreshButton({ onClick, loading }) { return <button type="button" onClick={onClick} disabled={loading} className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200 disabled:opacity-50" aria-label="Actualizar"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button> }
function DataList({ title, loading, error, onRetry, children }) { return <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-black text-slate-700">{title}</h3>{error && <button type="button" onClick={onRetry} className="text-[11px] font-bold text-red-600 underline">Reintentar</button>}</div>{loading ? <Skeleton className="h-12 rounded-lg" /> : error ? <p className="text-xs text-red-600">No se pudo cargar.</p> : Children.count(children) > 0 ? children : <p className="text-xs text-slate-400">Sin registros.</p>}</div> }
function ListRow({ title, detail }) { return <div className="border-t border-slate-100 py-2 first:border-t-0"><p className="truncate text-xs font-bold text-slate-700">{title}</p><p className="truncate text-[11px] text-slate-400">{detail}</p></div> }
function dayName(day) { return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][Number(day)] || 'Día' }
