// src/components/layout/HeaderDate.jsx
// Muestra la fecha y hora en la parte izquierda de la cabecera en pantallas de escritorio (PC).
import { Calendar } from 'lucide-react'
import useTasaCambioNomina from '../../hooks/useTasaCambioNomina.js'
import { formatFechaHora } from '../../../compat/utils/formatDateTime.js'

export function HeaderDate() {
  const { lastUpdate } = useTasaCambioNomina()
  const fecha = formatFechaHora(lastUpdate || new Date())

  if (!fecha) return null

  return (
    <div
      className="hidden md:flex items-center gap-1.5 pl-3 ml-1 border-l border-white/10 text-white/45 text-xs font-medium select-none"
      title="Fecha y hora oficial (Caracas)"
      aria-label={`Fecha actual: ${fecha}`}
    >
      <Calendar size={13} className="text-amber-400/70 shrink-0" aria-hidden="true" />
      <span>{fecha}</span>
    </div>
  )
}

export default HeaderDate
