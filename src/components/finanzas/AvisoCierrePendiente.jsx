// src/components/finanzas/AvisoCierrePendiente.jsx
// Recordatorios de cierre mensual en Movimientos (para quien puede cerrar meses):
//  - último día del mes (mes abierto): aviso de que mañana toca cerrarlo y conviene ir contando;
//  - desde el día 1 (mes anterior abierto): ya toca cerrarlo, con acceso directo a Tesorería.
// El servidor solo deja cerrar un mes cuando ya terminó, por eso el aviso del último día no trae botón.
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { nombreMesCierre } from '../../services/pdf/cierreNombre.js'
import { esUltimoDiaDelMes } from './fechasRapidas.js'

export default function AvisoCierrePendiente({ previo, actual, hoy, onIr }) {
  if (previo?.estado === 'abierto') {
    return (
      <div role="status" className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-start gap-2.5 leading-relaxed">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <span><strong>Ya toca cerrar {nombreMesCierre(previo.mes)}.</strong> Cuenta el dinero de cada cuenta y ciérralo; hasta entonces no se puede abrir el mes en curso.</span>
        </span>
        <button
          type="button"
          onClick={onIr}
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-xl bg-amber-700 px-4 text-sm font-bold text-white shadow-xs hover:bg-amber-800 active:bg-amber-900 sm:w-auto"
        >
          Ir a cerrar el mes
        </button>
      </div>
    )
  }
  if (actual?.estado === 'abierto' && esUltimoDiaDelMes(hoy, actual.mes)) {
    return (
      <div role="status" className="flex items-start gap-2.5 rounded-2xl border border-sky-200 bg-sky-50 p-3.5 text-sm leading-relaxed text-sky-950 shadow-xs">
        <CalendarClock size={18} className="mt-0.5 shrink-0 text-sky-600" />
        <span><strong>Hoy es el último día de {nombreMesCierre(actual.mes)}.</strong> Mañana toca cerrar el mes: ve contando el dinero de cada cuenta para hacerlo sin apuro.</span>
      </div>
    )
  }
  return null
}
