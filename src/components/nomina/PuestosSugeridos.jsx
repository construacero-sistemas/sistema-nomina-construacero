// src/components/nomina/PuestosSugeridos.jsx
// Botones de puesto para la ficha del empleado: los fijos, los personalizados de
// la cuenta (guardados en Configuración, `nomina_puestos`, migración 265) y los
// cargos que ya usa alguien. «+ Agregar puesto» guarda uno nuevo para todos.
import { useMemo, useState } from 'react'
import { Plus, Check, X } from 'lucide-react'
import { useConfigEmpleados, useConfigNomina, useGuardarConfigNomina } from '../../hooks/useNomina'
import { MAX_LARGO_PUESTO, normalizarPuesto, unirPuestos } from '../../../server/lib/nominaPuestos.js'

const PUESTOS_BASE = ['Chofer', 'Operador', 'Soldador', 'Almacenista', 'Ayudante', 'Administración']
const clave = texto => String(texto || '').trim().toLocaleLowerCase('es')

export default function PuestosSugeridos({ cargo, onElegir, disabled = false }) {
  const { data: configs = [] } = useConfigEmpleados({ incluirInactivas: true })
  const configNomina = useConfigNomina()
  const guardarConfig = useGuardarConfigNomina()
  const [agregando, setAgregando] = useState(false)
  const [nuevo, setNuevo] = useState('')
  const [error, setError] = useState('')

  const datosConfig = configNomina.data?.config || configNomina.data
  const guardados = useMemo(
    () => (Array.isArray(datosConfig?.nomina_puestos) ? unirPuestos(datosConfig.nomina_puestos) : []),
    [datosConfig],
  )
  const enUso = useMemo(() => new Set(configs.map(c => clave(c.cargo)).filter(Boolean)), [configs])
  const puestos = useMemo(
    () => unirPuestos(PUESTOS_BASE, guardados, configs.map(c => c.cargo)),
    [guardados, configs],
  )
  // Solo se puede quitar un puesto personalizado guardado que nadie usa.
  const esQuitable = puesto => guardados.some(g => clave(g) === clave(puesto))
    && !PUESTOS_BASE.some(b => clave(b) === clave(puesto)) && !enUso.has(clave(puesto))

  function cerrar() { setAgregando(false); setNuevo(''); setError('') }

  async function confirmar() {
    const nombre = normalizarPuesto(nuevo)
    if (!nombre) return
    onElegir(nombre)
    if (!puestos.some(p => clave(p) === clave(nombre))) {
      try {
        await guardarConfig.mutateAsync({ nomina_puestos: [...guardados, nombre] })
      } catch (err) {
        setError(`El puesto quedó en esta ficha, pero no se guardó en la lista: ${err.message || 'error'}`)
        return
      }
    }
    cerrar()
  }

  function quitar(puesto) {
    guardarConfig.mutate({ nomina_puestos: guardados.filter(g => clave(g) !== clave(puesto)) })
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="text-[10px] text-slate-400 font-semibold">Puestos:</span>
        {puestos.map(puesto => (
          <span key={puesto} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onElegir(puesto)}
              disabled={disabled}
              aria-pressed={clave(cargo) === clave(puesto)}
              className={`text-[10px] font-bold px-2 py-0.5 transition-all ${esQuitable(puesto) ? 'rounded-l-md' : 'rounded-md'} ${
                clave(cargo) === clave(puesto) ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {puesto}
            </button>
            {esQuitable(puesto) && (
              <button type="button" onClick={() => quitar(puesto)} disabled={disabled || guardarConfig.isPending}
                aria-label={`Quitar el puesto ${puesto}`} title="Quitar de la lista (nadie lo usa)"
                className="rounded-r-md bg-slate-100 px-1 py-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {agregando ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={nuevo}
              onChange={e => setNuevo(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); confirmar() }
                if (e.key === 'Escape') { e.preventDefault(); cerrar() }
              }}
              maxLength={MAX_LARGO_PUESTO}
              placeholder="Nuevo puesto"
              aria-label="Nombre del nuevo puesto"
              className="min-h-11 w-36 rounded-lg border border-slate-300 bg-white px-2 text-[16px] sm:text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button type="button" onClick={confirmar} disabled={!nuevo.trim() || guardarConfig.isPending} aria-label="Agregar puesto"
              className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg bg-primary text-white disabled:opacity-40">
              <Check size={13} />
            </button>
            <button type="button" onClick={cerrar} aria-label="Cancelar nuevo puesto"
              className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <X size={13} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAgregando(true)}
            disabled={disabled}
            className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-dashed border-primary/40 text-primary hover:bg-primary/5 inline-flex items-center gap-1"
          >
            <Plus size={11} /> Agregar puesto
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-[11px] font-semibold text-rose-700">{error}</p>}
    </div>
  )
}
