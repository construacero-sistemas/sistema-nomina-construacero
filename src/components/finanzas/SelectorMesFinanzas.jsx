// src/components/finanzas/SelectorMesFinanzas.jsx
// Flechas para ver el mes anterior/siguiente en Finanzas. Cambia el rango (desde/hasta) compartido
// de la vista, así el resumen, la tabla y la lista de tesorería muestran el mismo período.
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { etiquetaRango, isoToday, mesAnteriorIso, mesSiguienteIso, rangoDeMes } from './fechasRapidas.js'

export default function SelectorMesFinanzas({ desde, hasta, onRango }) {
  const mes = `${String(desde).slice(0, 7)}-01`
  const esMesEnCurso = mes >= `${isoToday().slice(0, 7)}-01`
  const boton = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-xs hover:bg-slate-50 disabled:opacity-40'
  return (
    <div className="flex items-center gap-1">
      {onRango && (
        <button type="button" aria-label="Mes anterior" className={boton} onClick={() => onRango(rangoDeMes(mesAnteriorIso(mes)))}>
          <ChevronLeft size={16} />
        </button>
      )}
      <p className="min-w-[8.5rem] text-center text-xs font-bold text-slate-600">{etiquetaRango(desde, hasta)}</p>
      {onRango && (
        <button type="button" aria-label="Mes siguiente" className={boton} disabled={esMesEnCurso} onClick={() => onRango(rangoDeMes(mesSiguienteIso(mes)))}>
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  )
}
