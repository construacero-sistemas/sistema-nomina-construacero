// src/components/nomina/PeriodoFormModal.jsx
// Creación de un período de nómina con sugerencia automática de fechas.
import { useState } from 'react'
import { useCrearPeriodo } from '../../hooks/useNomina'
import { useConfigNegocio } from '../../../compat/hooks/useConfigNegocio.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Rango sugerido según el tipo de período, tomando como base la fecha de hoy. */
function rangoSugerido(tipo) {
  const hoy = new Date()

  if (tipo === 'semanal') {
    const dow = hoy.getDay()
    const lunes = new Date(hoy)
    lunes.setDate(hoy.getDate() + (dow === 0 ? -6 : 1 - dow))
    const domingo = new Date(lunes)
    domingo.setDate(lunes.getDate() + 6)
    return { desde: iso(lunes), hasta: iso(domingo) }
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

/** Nombre legible por defecto para el rango. */
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

  function cambiarDesde(valor) {
    setDesde(valor)
    if (!nombreEditado) setNombre(nombreSugerido(tipo, valor, hasta))
  }

  function cambiarHasta(valor) {
    setHasta(valor)
    if (!nombreEditado) setNombre(nombreSugerido(tipo, desde, valor))
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
    <Modal isOpen onClose={onClose} title="Nuevo período de nómina" className="max-w-md">
      <form onSubmit={guardar} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Tipo */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Tipo de período</label>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'semanal',   label: 'Semanal' },
              { id: 'quincenal', label: 'Quincenal' },
              { id: 'mensual',   label: 'Mensual' },
            ].map(t => (
              <button
                key={t.id} type="button" disabled={cargando}
                onClick={() => cambiarTipo(t.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border disabled:opacity-50 ${
                  tipo === t.id
                    ? 'bg-primary text-white border-primary shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Fechas */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Desde *</label>
            <input type="date" value={desde} onChange={e => cambiarDesde(e.target.value)}
              className={inputCls} disabled={cargando} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Hasta *</label>
            <input type="date" value={hasta} onChange={e => cambiarHasta(e.target.value)}
              className={inputCls} disabled={cargando} />
          </div>
        </div>

        {/* Nombre */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Nombre del período *</label>
          <input
            type="text" value={nombre}
            onChange={e => { setNombre(e.target.value); setNombreEditado(true) }}
            placeholder="Ej: Semana 10 – 16 Ago 2026"
            className={inputCls} disabled={cargando}
          />
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Tras crear el período, usa <strong>Calcular</strong> para generar los recibos a partir
            de la asistencia registrada en ese rango de fechas.
          </p>
        </div>
      </form>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
        <button onClick={onClose} type="button" disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button onClick={guardar} disabled={cargando}
          className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-bold">
          {cargando ? 'Creando...' : 'Crear período'}
        </button>
      </div>
    </Modal>
  )
}
