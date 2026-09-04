// src/components/finanzas/SyncPosDespachosList.jsx
// Listado detallado y selección de despachos individuales de un método de pago del POS
import { useState, useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  FileText,
  Calendar,
} from 'lucide-react'

const FILAS_POR_PAGINA = 6

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * @param {object} props
 * @param {Array<object>} props.despachos - Lista de despachos de este método
 * @param {Array<string>} props.excluidos - IDs de despachos desmarcados
 * @param {(id: string) => void} props.onToggleDespacho - Callback al cambiar checkbox
 * @param {() => void} props.onToggleTodos - Callback para marcar/desmarcar todos
 * @param {string} props.moneda - 'USD' | 'VES' | 'USDT'
 */
export default function SyncPosDespachosList({
  despachos = [],
  excluidos = [],
  onToggleDespacho,
  onToggleTodos,
  moneda = 'USD',
}) {
  const [pagina, setPagina] = useState(1)

  const totalDespachos = despachos.length
  const totalPaginas = Math.max(1, Math.ceil(totalDespachos / FILAS_POR_PAGINA))

  // Asegurar página dentro de límites si cambian los despachos
  const paginaActual = Math.min(pagina, totalPaginas)

  const despachosPaginados = useMemo(() => {
    const inicio = (paginaActual - 1) * FILAS_POR_PAGINA
    return despachos.slice(inicio, inicio + FILAS_POR_PAGINA)
  }, [despachos, paginaActual])

  const todosSeleccionados = despachos.length > 0 && despachos.every(d => !excluidos.includes(d.id))

  const totalActivoUsd = useMemo(() => {
    return despachos
      .filter(d => !excluidos.includes(d.id))
      .reduce((sum, d) => sum + Number(d.monto_usd || 0), 0)
  }, [despachos, excluidos])

  const totalActivoVes = useMemo(() => {
    return despachos
      .filter(d => !excluidos.includes(d.id))
      .reduce((sum, d) => sum + Number(d.monto_ves || 0), 0)
  }, [despachos, excluidos])

  if (totalDespachos === 0) {
    return (
      <div className="py-4 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
        No se encontraron despachos individuales para este método.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
      {/* Barra superior con selección masiva */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5">
        <button
          type="button"
          onClick={onToggleTodos}
          className="min-h-11 inline-flex items-center gap-2 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all shadow-2xs"
          style={{ touchAction: 'manipulation' }}
        >
          {todosSeleccionados ? (
            <>
              <CheckSquare size={16} className="text-primary" />
              <span>Desmarcar todos ({totalDespachos})</span>
            </>
          ) : (
            <>
              <Square size={16} className="text-slate-400" />
              <span>Marcar todos ({totalDespachos})</span>
            </>
          )}
        </button>

        <div className="text-[11px] font-semibold text-slate-600">
          Subtotal activo:{' '}
          <strong className="text-slate-900 font-black">
            {moneda === 'VES'
              ? `Bs. ${formatMoney(totalActivoVes)} ($${formatMoney(totalActivoUsd)})`
              : `$${formatMoney(totalActivoUsd)} USD`}
          </strong>
        </div>
      </div>

      {/* Lista paginada de 6 filas */}
      <div className="space-y-1.5">
        {despachosPaginados.map(despacho => {
          const estaExcluido = excluidos.includes(despacho.id)
          const activo = !estaExcluido

          return (
            <div
              key={despacho.id}
              onClick={() => onToggleDespacho(despacho.id)}
              className={`min-h-11 w-full rounded-xl border p-2.5 flex items-center justify-between gap-2.5 cursor-pointer transition-all ${
                activo
                  ? 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                  : 'bg-slate-100/80 border-slate-200 opacity-60'
              }`}
              style={{ touchAction: 'manipulation' }}
            >
              {/* Checkbox y número/cliente */}
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  aria-label={activo ? `Desmarcar ${despacho.numero}` : `Marcar ${despacho.numero}`}
                  className="min-h-11 min-w-11 -m-2.5 flex items-center justify-center text-slate-600 hover:text-primary transition-colors"
                  style={{ touchAction: 'manipulation' }}
                >
                  {activo ? (
                    <CheckSquare size={18} className="text-primary shrink-0" />
                  ) : (
                    <Square size={18} className="text-slate-400 shrink-0" />
                  )}
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-black text-slate-900 flex items-center gap-1">
                      <FileText size={12} className="text-slate-400" />
                      {despacho.numero}
                    </span>
                    <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                      <Calendar size={10} />
                      {despacho.fecha}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 truncate max-w-xs sm:max-w-md">
                    {despacho.cliente}
                  </p>
                </div>
              </div>

              {/* Monto del ticket */}
              <div className="text-right shrink-0">
                <div className="text-xs font-black text-slate-900">
                  {moneda === 'VES'
                    ? `Bs. ${formatMoney(despacho.monto_ves)}`
                    : `$${formatMoney(despacho.monto_usd)}`}
                </div>
                {moneda === 'VES' && (
                  <div className="text-[10px] font-semibold text-slate-500">
                    ~${formatMoney(despacho.monto_usd)} USD
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Paginación obligatoria (6 filas por página) */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/80">
          <button
            type="button"
            onClick={() => setPagina(p => Math.max(1, p - 1))}
            disabled={paginaActual <= 1}
            className="min-h-11 inline-flex items-center gap-1 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs active:scale-95 transition-all"
            style={{ touchAction: 'manipulation' }}
          >
            <ChevronLeft size={16} />
            <span>Anterior</span>
          </button>

          <span className="text-xs font-bold text-slate-600">
            Página {paginaActual} de {totalPaginas}
          </span>

          <button
            type="button"
            onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
            disabled={paginaActual >= totalPaginas}
            className="min-h-11 inline-flex items-center gap-1 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs active:scale-95 transition-all"
            style={{ touchAction: 'manipulation' }}
          >
            <span>Siguiente</span>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
