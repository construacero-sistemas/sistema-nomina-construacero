// src/components/finanzas/FinanzasFiltrosUI.jsx
// Subcomponentes reutilizables de UI para filtros y estados de error del libro financiero
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import { Settings2, RefreshCw } from 'lucide-react'

export function FilterField({ label, children }) {
  return (
    <label className="space-y-1 min-w-0">
      <span className="block text-[11px] font-bold text-slate-500">{label}</span>
      <span className="block [&>input]:w-full [&>input]:h-11 [&>input]:rounded-xl [&>input]:border [&>input]:border-slate-200 [&>input]:bg-slate-50 [&>input]:px-2.5 [&>input]:text-xs [&>input]:text-slate-700 [&>select]:w-full [&>select]:h-11 [&>select]:rounded-xl [&>select]:border [&>select]:border-slate-200 [&>select]:bg-slate-50 [&>select]:px-2.5 [&>select]:text-xs [&>select]:text-slate-700">
        {children}
      </span>
    </label>
  )
}

export function Choice({ value, onChange, placeholder, options }) {
  return <CustomSelect value={value} onChange={onChange} placeholder={placeholder} options={options} clearable />
}

export function InlineError({ message, onRetry }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700" role="alert">
      {message} <button type="button" onClick={onRetry} className="underline font-black cursor-pointer">Volver a intentar</button>
    </div>
  )
}

export function FinanzasFiltrosSeccion({
  filtroCartera,
  setFiltroCartera,
  rangosRapidos = [],
  chipActivo,
  aplicarRangoRapido,
  desde,
  setDesde,
  hasta,
  setHasta,
  tipo,
  setTipo,
  categoria,
  setCategoria,
  opcionesCategoriaFiltro = [],
  setCategoriasOpen,
  moneda,
  setMoneda,
  resetFiltros,
  onRefresh,
  mostrarAnulados,
  setMostrarAnulados,
}) {
  return (
    <section aria-label="Filtros y rango del reporte" className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-black text-slate-800">Filtros y Período</h2>
          <p className="mt-0.5 text-xs text-slate-400 hidden sm:block">Filtra las fechas, tipo de movimiento o categoría.</p>
        </div>
        {filtroCartera && (
          <button
            type="button"
            onClick={() => setFiltroCartera('')}
            className="text-xs font-bold text-primary hover:underline cursor-pointer"
          >
            Mostrar todas las carteras
          </button>
        )}
      </div>

      {/* Rangos rápidos */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Rangos de fecha rápidos">
        {rangosRapidos.map(rango => (
          <button
            key={rango.id}
            type="button"
            onClick={() => aplicarRangoRapido(rango.id)}
            aria-pressed={chipActivo === rango.id}
            className={`px-3 h-8 rounded-full text-xs font-bold border transition-colors cursor-pointer ${
              chipActivo === rango.id
                ? 'bg-primary text-white border-primary'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            {rango.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <FilterField label="Desde"><DatePicker value={desde} onChange={setDesde} /></FilterField>
        <FilterField label="Hasta"><DatePicker value={hasta} onChange={setHasta} /></FilterField>
        <FilterField label="Tipo">
          <Choice
            value={tipo}
            onChange={setTipo}
            placeholder="Todos"
            options={[{ value: 'ingreso', label: 'Ingresos' }, { value: 'egreso', label: 'Egresos' }]}
          />
        </FilterField>
        <FilterField label="Categoría">
          <div className="flex gap-1.5">
            <div className="flex-1 min-w-0">
              <Choice
                value={categoria}
                onChange={val => {
                  if (val === '__crear__' || val === '__gestionar__') {
                    setCategoriasOpen(true)
                    return
                  }
                  setCategoria(val)
                }}
                placeholder="Todas"
                options={opcionesCategoriaFiltro}
              />
            </div>
            <button
              type="button"
              onClick={() => setCategoriasOpen(true)}
              className="shrink-0 h-11 w-11 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700 flex items-center justify-center cursor-pointer"
              aria-label="Gestionar categorías"
              title="Gestionar categorías"
            >
              <Settings2 size={15} />
            </button>
          </div>
        </FilterField>
        <FilterField label="Moneda">
          <Choice
            value={moneda}
            onChange={setMoneda}
            placeholder="Todas"
            options={['USD', 'VES', 'USDT'].map(value => ({ value, label: value }))}
          />
        </FilterField>
        <div className="flex items-end gap-2">
          <button type="button" onClick={resetFiltros} className="flex-1 h-11 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer">Limpiar</button>
          <button type="button" onClick={onRefresh} className="h-11 w-11 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center cursor-pointer" aria-label="Actualizar reportes"><RefreshCw size={15} /></button>
        </div>
      </div>

      <label className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 cursor-pointer">
        <input
          type="checkbox"
          checked={mostrarAnulados}
          onChange={e => setMostrarAnulados(e.target.checked)}
          className="rounded border-slate-300 text-primary focus:ring-primary"
        />
        Mostrar movimientos anulados también
      </label>
    </section>
  )
}
