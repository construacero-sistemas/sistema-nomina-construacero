// Caja de búsqueda inteligente de movimientos: una sola línea que entiende palabras,
// montos, rangos, fechas, tipo y "repetidos". Muestra cómo interpretó lo escrito.
import { Loader2, Search, X } from 'lucide-react'
import { interpretarBusqueda } from './busquedaMovimientos.js'

const EJEMPLOS = [
  { texto: 'repetidos', ayuda: 'posibles duplicados' },
  { texto: 'egreso >1.000.000', ayuda: 'egresos mayores a 1.000.000' },
  { texto: '28 oct ingreso', ayuda: 'ingresos de un día' },
  { texto: '#665', ayuda: 'por número de registro' },
]

export default function BuscadorMovimientos({ valor, onChange, encontrados, cargados, totalServidor, cargandoTodo }) {
  const texto = valor.trim()
  const { etiquetas } = interpretarBusqueda(valor)
  const completo = !cargandoTodo
  return (
    <section aria-label="Buscar movimientos" className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs space-y-2">
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={valor}
          onChange={event => onChange(event.target.value)}
          placeholder="Buscar: concepto, categoría, monto, # de registro, fecha…"
          aria-label="Buscar movimientos"
          autoComplete="off"
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-sm font-medium text-slate-800 outline-none focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
        />
        {valor && (
          <button type="button" onClick={() => onChange('')} aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        )}
      </div>

      {!texto ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span className="font-bold">Prueba:</span>
          {EJEMPLOS.map(ejemplo => (
            <button key={ejemplo.texto} type="button" onClick={() => onChange(ejemplo.texto)} title={ejemplo.ayuda}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-[11px] font-bold text-slate-600 hover:border-sky-300 hover:text-sky-700">
              {ejemplo.texto}
            </button>
          ))}
        </p>
      ) : (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-bold text-slate-500">Entendí:</span>
            {etiquetas.map((etiqueta, indice) => (
              <span key={`${etiqueta}-${indice}`} className="rounded-full bg-sky-50 px-2.5 py-1 font-bold text-sky-800">{etiqueta}</span>
            ))}
          </div>
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-600">
            {cargandoTodo && <Loader2 size={13} className="animate-spin text-slate-400" aria-hidden="true" />}
            <strong className="text-slate-900">{encontrados}</strong> {encontrados === 1 ? 'movimiento encontrado' : 'movimientos encontrados'}
            {cargandoTodo
              ? ` · buscando en todo el período (${cargados}${Number.isFinite(Number(totalServidor)) ? ` de ${totalServidor}` : ''} revisados)…`
              : completo && Number.isFinite(Number(totalServidor)) ? ` de ${totalServidor} del período` : ''}
          </p>
        </div>
      )}
    </section>
  )
}
