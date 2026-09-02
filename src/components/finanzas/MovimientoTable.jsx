// src/components/finanzas/MovimientoTable.jsx
// Presentación responsive del libro con paginación, selector de registros y auditoría visual
import { useMemo, useState } from 'react'
import {
  Ban,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
} from 'lucide-react'
import HorizontalScroll from '../../../compat/components/ui/HorizontalScroll.jsx'

function money(value, currency) {
  return `${Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

function date(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

const OPCIONES_POR_PAGINA = [10, 25, 50, 100]

export default function MovimientoTable({ movimientos = [], onAnular }) {
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(10)

  const totalRegistros = movimientos.length
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / porPagina))
  const paginaEfectiva = Math.min(Math.max(1, pagina), totalPaginas)

  const inicio = (paginaEfectiva - 1) * porPagina
  const fin = Math.min(inicio + porPagina, totalRegistros)

  const movimientosPaginados = useMemo(() => {
    return movimientos.slice(inicio, fin)
  }, [movimientos, inicio, fin])

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Encabezado con conteo y selector de registros tipo pill */}
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-white">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-500">
            <CalendarDays size={16} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-800 leading-tight">Movimientos</h2>
            <p className="text-[11px] text-slate-400 font-medium">
              {totalRegistros === 0
                ? '0 registros'
                : `Mostrando ${inicio + 1} - ${fin} de ${totalRegistros} registro(s)`}
            </p>
          </div>
        </div>

        {/* Selector de items por página con botones tipo pill */}
        {totalRegistros > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
            <span className="hidden sm:inline text-[11px] text-slate-400 mr-1">Por página:</span>
            <div className="inline-flex rounded-xl p-0.5 bg-slate-100/80 border border-slate-200/60">
              {OPCIONES_POR_PAGINA.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setPorPagina(n)
                    setPagina(1)
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                    porPagina === n
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Vista de tabla en Desktop */}
      <HorizontalScroll className="hidden md:block" contentClassName="bg-white">
        <table className="w-full min-w-[860px] text-xs" aria-label="Movimientos financieros">
          <thead className="bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
            <tr>
              <th className="px-4 py-3 text-left font-black">Fecha</th>
              <th className="px-4 py-3 text-left font-black">Tipo</th>
              <th className="px-4 py-3 text-left font-black">Categoría / Concepto</th>
              <th className="px-4 py-3 text-right font-black">Monto</th>
              <th className="px-4 py-3 text-right font-black">Equivalente VES</th>
              <th className="px-4 py-3 text-left font-black">Estado</th>
              <th className="px-4 py-3 text-right font-black">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movimientosPaginados.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-xs">
                  No hay movimientos registrados en este período.
                </td>
              </tr>
            ) : (
              movimientosPaginados.map((item) => (
                <DesktopRow key={item.id} item={item} onAnular={onAnular} />
              ))
            )}
          </tbody>
        </table>
      </HorizontalScroll>

      {/* Vista de tarjetas en Móvil */}
      <div className="md:hidden divide-y divide-slate-100">
        {movimientosPaginados.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs">
            No hay movimientos registrados en este período.
          </div>
        ) : (
          movimientosPaginados.map((item) => (
            <MobileRow key={item.id} item={item} onAnular={onAnular} />
          ))
        )}
      </div>

      {/* Barra de Paginación */}
      {totalPaginas > 1 && (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-medium text-slate-500">
            Página <strong className="text-slate-800 font-black">{paginaEfectiva}</strong> de{' '}
            <strong className="text-slate-800 font-black">{totalPaginas}</strong>
          </span>

          <div className="flex items-center gap-1">
            {/* Primera página */}
            <button
              type="button"
              onClick={() => setPagina(1)}
              disabled={paginaEfectiva === 1}
              title="Primera página"
              aria-label="Primera página"
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronsLeft size={15} />
            </button>

            {/* Página anterior */}
            <button
              type="button"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={paginaEfectiva === 1}
              title="Página anterior"
              aria-label="Página anterior"
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={15} />
            </button>

            {/* Selector de números de página */}
            <div className="hidden sm:flex items-center gap-1 px-1">
              {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPaginas || Math.abs(p - paginaEfectiva) <= 1)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) {
                    acc.push('...')
                  }
                  acc.push(p)
                  return acc
                }, [])
                .map((item, idx) =>
                  item === '...' ? (
                    <span key={`dots-${idx}`} className="px-1 text-xs text-slate-400">
                      ...
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPagina(item)}
                      aria-current={paginaEfectiva === item ? 'page' : undefined}
                      className={`min-w-[28px] h-7 px-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        paginaEfectiva === item
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-200/70'
                      }`}
                    >
                      {item}
                    </button>
                  )
                )}
            </div>

            {/* Página siguiente */}
            <button
              type="button"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={paginaEfectiva === totalPaginas}
              title="Página siguiente"
              aria-label="Página siguiente"
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={15} />
            </button>

            {/* Última página */}
            <button
              type="button"
              onClick={() => setPagina(totalPaginas)}
              disabled={paginaEfectiva === totalPaginas}
              title="Última página"
              aria-label="Última página"
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronsRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DesktopRow({ item, onAnular }) {
  const activo = item.estado === 'activo'
  return (
    <tr className="hover:bg-slate-50/70 transition-colors">
      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{date(item.fecha)}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        <TypeBadge type={item.tipo} />
      </td>
      <td className="px-4 py-3 max-w-[280px]">
        <p className="truncate font-bold text-slate-800">{item.concepto}</p>
        <p className="truncate text-[11px] text-slate-400">
          {item.categoria}
          {item.referencia ? ` · ${item.referencia}` : ''}
        </p>
      </td>
      <td className="px-4 py-3 text-right font-bold text-slate-700 whitespace-nowrap">
        {money(item.monto, item.moneda)}
      </td>
      <td className="px-4 py-3 text-right font-black text-slate-900 whitespace-nowrap">
        {money(item.monto_ves, 'VES')}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <StateBadge state={item.estado} />
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {activo ? (
          <button
            type="button"
            onClick={() => onAnular(item)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
            aria-label="Anular movimiento"
          >
            <Ban size={13} /> Anular
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
            <Eye size={12} /> Anulado
          </span>
        )}
      </td>
    </tr>
  )
}

function MobileRow({ item, onAnular }) {
  const activo = item.estado === 'activo'
  return (
    <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-800 text-sm leading-snug">{item.concepto}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {item.categoria} · {date(item.fecha)}
          </p>
        </div>
        <TypeBadge type={item.tipo} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 border border-slate-100">
        <Metric label="Monto" value={money(item.monto, item.moneda)} />
        <Metric
          label="Equivalente VES"
          value={money(item.monto_ves, 'VES')}
          accent={item.tipo === 'ingreso'}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 pt-1">
        <StateBadge state={item.estado} />
        {activo ? (
          <button
            type="button"
            onClick={() => onAnular(item)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors cursor-pointer"
          >
            <Ban size={14} /> Anular
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
            <Eye size={13} /> Conservado
          </span>
        )}
      </div>
    </article>
  )
}

function Metric({ label, value, accent }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-black ${accent ? 'text-emerald-700' : 'text-slate-800'}`}>
        {value}
      </p>
    </div>
  )
}

function TypeBadge({ type }) {
  const label = type === 'ingreso' ? 'Entrada' : 'Salida'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
        type === 'ingreso'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-rose-200 bg-rose-50 text-rose-700'
      }`}
    >
      {label}
    </span>
  )
}

function StateBadge({ state }) {
  const label = state === 'activo' ? 'Vigente' : 'Anulado'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        state === 'activo'
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-slate-100 text-slate-500'
      }`}
    >
      {label}
    </span>
  )
}
