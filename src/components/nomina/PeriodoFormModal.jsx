// src/components/nomina/PeriodoFormModal.jsx
// Creación intuitiva de un período de nómina con atajos de fecha inmediatos.
import { useState } from 'react'
import { Calendar, Sparkles } from 'lucide-react'
import { useCrearPeriodo } from '../../hooks/useNomina'
import { useConfigNegocio } from '../../../compat/hooks/useConfigNegocio.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all font-medium'

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Rango sugerido según el tipo de período */
function rangoSugerido(tipo) {
  const hoy = new Date()

  if (tipo === 'semanal') {
    const dow = hoy.getDay()
    const lunes = new Date(hoy)
    lunes.setDate(hoy.getDate() + (dow === 0 ? -6 : 1 - dow))
    const sabado = new Date(lunes)
    sabado.setDate(lunes.getDate() + 5) // Lunes a Sábado estándar Construacero
    return { desde: iso(lunes), hasta: iso(sabado) }
  }

  if (tipo === 'quincenal') {
    const dia = hoy.getDate()
    if (dia <= 15) {
      return {
        desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
        hasta: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 15)),
      }
    }
    return {
      desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 16)),
      hasta: iso(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)),
    }
  }

  // mensual
  return {
    desde: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
    hasta: iso(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)),
  }
}

function nombreSugerido(tipo, desde, hasta) {
  if (!desde || !hasta) return ''
  const d = new Date(`${desde}T12:00:00`)
  const h = new Date(`${hasta}T12:00:00`)
  const mes = h.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })

  if (tipo === 'mensual') {
    return mes.charAt(0).toUpperCase() + mes.slice(1)
  }
  const dd = d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
  const hh = h.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
  const prefijo = tipo === 'quincenal' ? 'Quincena' : 'Semana'
  return `${prefijo} ${dd} – ${hh} ${h.getFullYear()}`
}

export default function PeriodoFormModal({ onClose }) {
  const crear = useCrearPeriodo()
  const { data: config = {} } = useConfigNegocio()

  const tipoDefault = config.nomina_tipo_periodo || 'semanal'
  const rangoInicial = rangoSugerido(tipoDefault)
  const [tipo, setTipo] = useState(tipoDefault)
  const [desde, setDesde] = useState(rangoInicial.desde)
  const [hasta, setHasta] = useState(rangoInicial.hasta)
  const [nombre, setNombre] = useState(() => nombreSugerido(tipoDefault, rangoInicial.desde, rangoInicial.hasta))
  const [nombreEditado, setNombreEditado] = useState(false)
  const [error, setError] = useState('')

  function cambiarTipo(nuevoTipo) {
    const r = rangoSugerido(nuevoTipo)
    setTipo(nuevoTipo)
    setDesde(r.desde)
    setHasta(r.hasta)
    if (!nombreEditado) setNombre(nombreSugerido(nuevoTipo, r.desde, r.hasta))
  }

  function aplicarAtajoSemanaPasada() {
    const hoy = new Date()
    const dow = hoy.getDay()
    const lunes = new Date(hoy)
    lunes.setDate(hoy.getDate() + (dow === 0 ? -6 : 1 - dow) - 7)
    const sabado = new Date(lunes)
    sabado.setDate(lunes.getDate() + 5)
    const dIso = iso(lunes)
    const hIso = iso(sabado)
    setTipo('semanal')
    setDesde(dIso)
    setHasta(hIso)
    if (!nombreEditado) setNombre(nombreSugerido('semanal', dIso, hIso))
  }

  const cargando = crear.isPending

  async function guardar(e) {
    if (e) e.preventDefault()
    setError('')
    if (!nombre.trim()) { setError('El nombre es obligatorio'); return }
    if (!desde || !hasta) { setError('Indica las fechas del período'); return }
    if (hasta < desde) { setError('La fecha final debe ser posterior a la inicial'); return }

    try {
      await crear.mutateAsync({ nombre: nombre.trim(), desde, hasta, tipo })
      onClose()
    } catch (err) {
      setError(err.message || 'Error al crear período')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Crear Período de Nómina" className="max-w-md">
      <form onSubmit={guardar} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-medium">
            {error}
          </div>
        )}

        {/* Tipo de período */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Frecuencia de Pago
          </label>
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-100 text-xs font-bold">
            {[
              { id: 'semanal',   label: 'Semanal' },
              { id: 'quincenal', label: 'Quincenal' },
              { id: 'mensual',   label: 'Mensual' },
            ].map(t => (
              <button
                key={t.id} type="button" disabled={cargando}
                onClick={() => cambiarTipo(t.id)}
                className={`py-2 rounded-xl transition-all ${
                  tipo === t.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Atajos Rápidos */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => cambiarTipo(tipo)}
            className="text-[11px] font-bold text-primary hover:text-primary-hover flex items-center gap-1"
          >
            <Sparkles size={12} />
            Periodo actual
          </button>
          <span className="text-slate-300">·</span>
          <button
            type="button"
            onClick={aplicarAtajoSemanaPasada}
            className="text-[11px] font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1"
          >
            <Calendar size={12} />
            Semana anterior
          </button>
        </div>

        {/* Rango de Fechas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Fecha Desde *</label>
            <DatePicker
              value={desde}
              onChange={val => {
                setDesde(val)
                if (!nombreEditado) setNombre(nombreSugerido(tipo, val, hasta))
              }}
              disabled={cargando}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Fecha Hasta *</label>
            <DatePicker
              value={hasta}
              onChange={val => {
                setHasta(val)
                if (!nombreEditado) setNombre(nombreSugerido(tipo, desde, val))
              }}
              disabled={cargando}
            />
          </div>
        </div>

        {/* Nombre del Período */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700">Nombre o Identificador del Período *</label>
          <input
            type="text" value={nombre}
            onChange={e => { setNombre(e.target.value); setNombreEditado(true) }}
            placeholder="Ej: Semana 18 – 23 Ago 2026"
            className={inputCls} disabled={cargando}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 mt-4 border-t border-slate-100">
          <button onClick={onClose} type="button" disabled={cargando}
            className="px-4 py-2 min-h-11 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={cargando}
            className="px-5 py-2 min-h-11 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all active:scale-95"
          >
            {cargando ? 'Creando...' : 'Crear Período'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
