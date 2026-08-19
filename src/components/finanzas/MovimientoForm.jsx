// src/components/finanzas/MovimientoForm.jsx
// Formulario de alta financiera; los cálculos definitivos ocurren en el Worker.
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useCrearMovimiento } from '../../hooks/useFinanzas.js'

const inputClass = 'w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function MovimientoForm({ categorias = [], onClose }) {
  const crear = useCrearMovimiento()
  const [form, setForm] = useState({
    fecha: today(), tipo: 'egreso', categoria: '', concepto: '', monto: '', moneda: 'USD',
    tasaVes: '1', fuenteTasa: 'MANUAL', observacionTasa: '', referencia: '', observaciones: '',
  })
  const [error, setError] = useState('')
  const disabled = crear.isPending
  const categoriasCompatibles = useMemo(() => categorias.filter(item => item.tipo === 'ambos' || item.tipo === form.tipo), [categorias, form.tipo])

  function change(field, value) {
    setForm(current => ({ ...current, [field]: value }))
  }

  function validate() {
    if (!form.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(form.fecha)) return 'Selecciona una fecha válida.'
    if (!form.categoria) return 'Selecciona una categoría.'
    if (!form.concepto.trim()) return 'Escribe el concepto del movimiento.'
    if (!(Number(form.monto) > 0)) return 'El monto debe ser mayor que cero.'
    if (!(Number(form.tasaVes) > 0)) return 'La tasa VES debe ser mayor que cero.'
    if (form.fuenteTasa === 'MANUAL' && !form.observacionTasa.trim()) return 'Describe la fuente o aprobación de la tasa manual.'
    return ''
  }

  async function submit(event) {
    event.preventDefault()
    const validationError = validate()
    setError(validationError)
    if (validationError) return
    try {
      await crear.mutateAsync({
        ...form,
        categoria: form.categoria.trim(),
        concepto: form.concepto.trim(),
        monto: Number(form.monto),
        tasaVes: Number(form.tasaVes),
        observacionTasa: form.observacionTasa.trim(),
        referencia: form.referencia.trim() || null,
        observaciones: form.observaciones.trim() || null,
      })
      onClose()
    } catch (submitError) {
      setError(submitError.message || 'No se pudo guardar el movimiento.')
    }
  }

  return <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="movimiento-title">
    <div className="w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto overflow-x-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100 bg-white"><div><h2 id="movimiento-title" className="text-lg font-black text-slate-800">Nuevo movimiento</h2><p className="text-xs text-slate-400 mt-0.5">Registra un ingreso o egreso con su tasa congelada.</p></div><button type="button" onClick={onClose} disabled={disabled} className="p-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="Cerrar"><X size={18} /></button></div>
      <form onSubmit={submit} className="p-4 sm:p-6 space-y-4">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Tipo *"><select value={form.tipo} onChange={e => change('tipo', e.target.value)} className={inputClass} disabled={disabled}><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></Field>
          <Field label="Fecha *"><input type="date" value={form.fecha} onChange={e => change('fecha', e.target.value)} className={inputClass} disabled={disabled} /></Field>
          <Field label="Moneda *"><select value={form.moneda} onChange={e => change('moneda', e.target.value)} className={inputClass} disabled={disabled}><option>USD</option><option>VES</option><option>EUR</option><option>USDT</option></select></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Categoría *"><select value={form.categoria} onChange={e => change('categoria', e.target.value)} className={inputClass} disabled={disabled}><option value="">Selecciona una categoría...</option>{categoriasCompatibles.map(item => <option key={item.id || item.nombre} value={item.nombre}>{item.nombre}</option>)}</select></Field><Field label="Concepto *"><input value={form.concepto} onChange={e => change('concepto', e.target.value)} maxLength={180} className={inputClass} placeholder="Ej. compra de materiales" disabled={disabled} /></Field></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Field label="Monto *"><input type="number" min="0.000001" step="0.000001" value={form.monto} onChange={e => change('monto', e.target.value)} className={inputClass} placeholder="0.00" disabled={disabled} /></Field><Field label="Tasa VES *"><input type="number" min="0.000001" step="0.000001" value={form.tasaVes} onChange={e => change('tasaVes', e.target.value)} className={inputClass} disabled={disabled} /></Field><Field label="Fuente de tasa *"><select value={form.fuenteTasa} onChange={e => change('fuenteTasa', e.target.value)} className={inputClass} disabled={disabled}><option value="MANUAL">Manual</option><option value="BCV">BCV</option><option value="EURO">Euro</option><option value="USDT">USDT</option></select></Field></div>
        <Field label="Observación/aprobación de tasa *"><input value={form.observacionTasa} onChange={e => change('observacionTasa', e.target.value)} maxLength={300} className={inputClass} placeholder="Fuente, fecha o aprobación contable" disabled={disabled} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Referencia"><input value={form.referencia} onChange={e => change('referencia', e.target.value)} maxLength={160} className={inputClass} placeholder="Factura, transferencia..." disabled={disabled} /></Field><Field label="Observaciones"><input value={form.observaciones} onChange={e => change('observaciones', e.target.value)} maxLength={1000} className={inputClass} placeholder="Información adicional" disabled={disabled} /></Field></div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-slate-100"><button type="button" onClick={onClose} disabled={disabled} className="h-10 px-4 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancelar</button><button type="submit" disabled={disabled} className="h-10 px-5 rounded-xl bg-primary text-sm font-black text-white hover:bg-primary-hover disabled:opacity-50">{disabled ? 'Guardando...' : 'Guardar movimiento'}</button></div>
      </form>
    </div>
  </div>
}

function Field({ label, children }) {
  return <label className="block min-w-0"><span className="block mb-1.5 text-xs font-bold text-slate-600">{label}</span>{children}</label>
}
