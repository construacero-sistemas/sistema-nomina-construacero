// Portada "Mes a mes": responde de un vistazo ¿cuánto entró?, ¿cuánto salió?,
// ¿cuánto gané?, ¿en qué se fue? y ¿de qué cuenta salió?
// Los totales usan el resumen del servidor cuando está disponible (cifras del
// libro completo); el detalle por cuenta se arma con los movimientos cargados y
// se etiqueta como tal cuando faltan páginas.
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Landmark, TrendingDown, TrendingUp } from 'lucide-react'
import { formatNumber } from './formatos.js'

const money = value => value == null || !Number.isFinite(Number(value)) ? '—' : formatNumber(value)

function usdDe(movimiento) {
  const monto = Number(movimiento.monto) || 0
  if (movimiento.moneda === 'USD') return monto
  const tasaVes = Number(movimiento.tasa_ves)
  const tasaUsd = Number(movimiento.tasa_usd_ves)
  if (!(tasaUsd > 0) || !(tasaVes > 0)) return null
  return monto * tasaVes / tasaUsd
}

const nombreMes = iso => {
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  const [anio, mes] = String(iso || '').split('-')
  return `${meses[Number(mes) - 1] || iso} ${anio || ''}`.trim()
}

function etiquetaRango(desde, hasta) {
  const inicio = String(desde || '').slice(0, 7)
  if (inicio && `${inicio}-01` === desde && hasta?.startsWith(inicio)) return nombreMes(inicio)
  return `Del ${desde} al ${hasta}`
}

function agregarMovimientos(rows, cuentas) {
  const porCategoria = new Map()
  const porCuenta = new Map()
  const porMoneda = {}
  let ingresos = 0, egresos = 0, sinValorar = 0
  for (const movimiento of rows) {
    if (movimiento.estado === 'anulado') continue
    const usd = usdDe(movimiento)
    if (usd == null) sinValorar += 1
    const totalUsd = usd ?? 0
    const esIngreso = movimiento.tipo === 'ingreso'
    if (esIngreso) ingresos += totalUsd; else egresos += totalUsd

    const moneda = porMoneda[movimiento.moneda] || { ingresos: 0, egresos: 0 }
    if (esIngreso) moneda.ingresos += Number(movimiento.monto) || 0; else moneda.egresos += Number(movimiento.monto) || 0
    porMoneda[movimiento.moneda] = moneda

    const claveCategoria = `${movimiento.tipo}:${movimiento.categoria || 'Sin categoría'}`
    const categoria = porCategoria.get(claveCategoria) || { tipo: movimiento.tipo, categoria: movimiento.categoria || 'Sin categoría', usd: 0, movimientos: [] }
    categoria.usd += totalUsd
    categoria.movimientos.push(movimiento)
    porCategoria.set(claveCategoria, categoria)

    const claveCuenta = movimiento.cuenta_custodia_id || 'sin-cuenta'
    const cuenta = porCuenta.get(claveCuenta) || { id: claveCuenta, ingresos: 0, egresos: 0 }
    if (esIngreso) cuenta.ingresos += totalUsd; else cuenta.egresos += totalUsd
    porCuenta.set(claveCuenta, cuenta)
  }
  return {
    ingresos, egresos, sinValorar, porMoneda,
    categorias: [...porCategoria.values()].sort((a, b) => b.usd - a.usd),
    cuentas: [...porCuenta.values()].map(cuenta => ({
      ...cuenta,
      nombre: cuenta.id === 'sin-cuenta' ? 'Sin cuenta asignada' : (cuentas.find(item => item.id === cuenta.id)?.nombre || 'Cuenta sin nombre'),
      moneda: cuentas.find(item => item.id === cuenta.id)?.moneda || '',
      saldo: cuentas.find(item => item.id === cuenta.id)?.saldo,
    })),
  }
}

function barrasPorPeriodo(rows) {
  const porDia = true
  const buckets = new Map()
  for (const movimiento of rows) {
    if (movimiento.estado === 'anulado') continue
    const fecha = String(movimiento.fecha || '').slice(0, 10)
    if (!fecha) continue
    const bucket = buckets.get(fecha) || { fecha, ingresos: 0, egresos: 0 }
    const usd = usdDe(movimiento) ?? 0
    if (movimiento.tipo === 'ingreso') bucket.ingresos += usd; else bucket.egresos += usd
    buckets.set(fecha, bucket)
  }
  return { porDia, filas: [...buckets.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)) }
}

function Tarjeta({ icono: Icono, etiqueta, valor, tono }) {
  const colores = {
    verde: 'border-emerald-200 bg-emerald-50/70 text-emerald-800',
    rojo: 'border-rose-200 bg-rose-50/70 text-rose-800',
    azul: 'border-sky-200 bg-sky-50/70 text-sky-800',
  }
  return (
    <div className={`rounded-2xl border p-4 shadow-xs ${colores[tono] || colores.azul}`}>
      <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide opacity-80">
        <Icono size={14} className="shrink-0" /> {etiqueta}
      </p>
      <p className="mt-1.5 text-2xl font-black tabular-nums text-slate-900">{valor}</p>
    </div>
  )
}

export default function MesAMesResumen({ movimientos = [], summary = null, cuentas = [], loading = false, totalServidor, desde, hasta }) {
  const [abiertas, setAbiertas] = useState(() => new Set())
  const datos = useMemo(() => agregarMovimientos(movimientos, cuentas), [movimientos, cuentas])
  const barras = useMemo(() => barrasPorPeriodo(movimientos), [movimientos])

  // El resumen del servidor manda (libro completo); sin él se suman las filas cargadas.
  const ingresosUsd = summary?.ingresos_usd != null ? Number(summary.ingresos_usd) : datos.ingresos
  const egresosUsd = summary?.egresos_usd != null ? Number(summary.egresos_usd) : datos.egresos
  const gananciaUsd = summary?.balance_usd != null ? Number(summary.balance_usd) : ingresosUsd - egresosUsd
  // Pendiente solo cuando el servidor avisa movimientos sin valorar; sin resumen
  // (o con resumen completo) los números son utilizables.
  const completos = !summary || !summary.movimientos_sin_usd
  const margen = ingresosUsd > 0 ? (gananciaUsd / ingresosUsd) * 100 : null
  const parcial = Number.isFinite(Number(totalServidor)) && movimientos.length < Number(totalServidor)
  const maxBarras = Math.max(1, ...barras.filas.map(fila => Math.max(fila.ingresos, fila.egresos)))

  const alternar = clave => setAbiertas(actuales => {
    const siguiente = new Set(actuales)
    if (siguiente.has(clave)) siguiente.delete(clave); else siguiente.add(clave)
    return siguiente
  })

  return (
    <section aria-label="Resumen financiero" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-black text-slate-900 tracking-tight">Mes a mes</h2>
        <p className="text-xs font-bold text-slate-500">{etiquetaRango(desde, hasta)}</p>
      </div>

      {summary?.movimientos_sin_usd > 0 && (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {summary.movimientos_sin_usd} movimiento(s) sin tasa histórica: el consolidado USD está pendiente de valoración.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tarjeta icono={TrendingUp} etiqueta="Ingresos" tono="verde" valor={completos ? `$${money(ingresosUsd)} USD` : 'Consolidado pendiente'} />
        <Tarjeta icono={TrendingDown} etiqueta="Gastos" tono="rojo" valor={completos ? `$${money(egresosUsd)} USD` : 'Consolidado pendiente'} />
        <Tarjeta icono={Landmark} etiqueta="Ganancia (entró − salió)" tono="azul"
          valor={completos ? `$${money(gananciaUsd)} USD${margen != null ? ` · ${money(margen)}%` : ''}` : 'Consolidado pendiente'} />
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-700">
        {['USD', 'USDT', 'VES'].map(moneda => {
          const nativo = datos.porMoneda[moneda]
          const servidor = summary ? {
            USD: { ingresos: summary.ingresos_usd_puro, egresos: summary.egresos_usd_puro },
            USDT: { ingresos: summary.ingresos_usdt_puro, egresos: summary.egresos_usdt_puro },
            VES: { ingresos: summary.ingresos_ves_puro, egresos: summary.egresos_ves_puro },
          }[moneda] : null
          const entrada = servidor?.ingresos != null ? servidor.ingresos : nativo?.ingresos
          const salida = servidor?.egresos != null ? servidor.egresos : nativo?.egresos
          if (entrada == null && salida == null) return null
          return (
            <span key={moneda} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-xs">
              <span className="font-mono text-slate-500">{moneda}</span>
              <span className="text-emerald-700">+{money(entrada)}</span>
              <span className="text-rose-700">−{money(salida)}</span>
            </span>
          )
        })}
      </div>

      {barras.filas.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500">Ingresos vs gastos por día</p>
          <div className="mt-3 flex h-28 items-end gap-1 overflow-x-auto">
            {barras.filas.map(fila => (
              <div key={fila.fecha} className="flex h-full flex-1 items-end gap-0.5 min-w-[6px]" title={`${fila.fecha}: +$${money(fila.ingresos)} / −$${money(fila.egresos)}`}>
                <div className="w-1/2 rounded-t bg-emerald-500/80" style={{ height: `${Math.max(2, (fila.ingresos / maxBarras) * 100)}%` }} />
                <div className="w-1/2 rounded-t bg-rose-500/80" style={{ height: `${Math.max(2, (fila.egresos / maxBarras) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] font-bold text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500/80" /> Ingresos</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500/80" /> Gastos</span>
            {barras.filas.length > 0 && <span className="ml-auto">{barras.filas[0].fecha} → {barras.filas[barras.filas.length - 1].fecha}</span>}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
        <p className="px-4 pt-4 text-xs font-black uppercase tracking-wide text-slate-500">En qué se fue la plata, por categoría</p>
        <ul className="divide-y divide-slate-100 p-2">
          {datos.categorias.filter(categoria => categoria.tipo === 'egreso').map(categoria => (
            <li key={`egreso:${categoria.categoria}`}>
              <button type="button" onClick={() => alternar(`egreso:${categoria.categoria}`)} className="flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-left hover:bg-slate-50 cursor-pointer">
                {abiertas.has(`egreso:${categoria.categoria}`) ? <ChevronDown size={15} className="text-slate-400 shrink-0" /> : <ChevronRight size={15} className="text-slate-400 shrink-0" />}
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{categoria.categoria}</span>
                <span className="text-xs text-slate-400">{categoria.movimientos.length} mov.</span>
                <span className="font-mono text-sm font-black text-rose-700">−${money(categoria.usd)}</span>
              </button>
              {abiertas.has(`egreso:${categoria.categoria}`) && (
                <ul className="ml-6 space-y-1 border-l border-slate-100 pl-3 pb-2">
                  {categoria.movimientos.map(movimiento => (
                    <li key={movimiento.id} className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-600">
                      <span className="min-w-0 truncate">{movimiento.fecha} · {movimiento.concepto}</span>
                      <span className="font-mono font-bold text-slate-800">{money(movimiento.monto)} {movimiento.moneda}{usdDe(movimiento) != null ? ` · $${money(usdDe(movimiento))}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {datos.categorias.filter(categoria => categoria.tipo === 'ingreso').map(categoria => (
            <li key={`ingreso:${categoria.categoria}`}>
              <button type="button" onClick={() => alternar(`ingreso:${categoria.categoria}`)} className="flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-left hover:bg-slate-50 cursor-pointer">
                {abiertas.has(`ingreso:${categoria.categoria}`) ? <ChevronDown size={15} className="text-slate-400 shrink-0" /> : <ChevronRight size={15} className="text-slate-400 shrink-0" />}
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{categoria.categoria}</span>
                <span className="text-xs text-slate-400">{categoria.movimientos.length} mov.</span>
                <span className="font-mono text-sm font-black text-emerald-700">+${money(categoria.usd)}</span>
              </button>
              {abiertas.has(`ingreso:${categoria.categoria}`) && (
                <ul className="ml-6 space-y-1 border-l border-slate-100 pl-3 pb-2">
                  {categoria.movimientos.map(movimiento => (
                    <li key={movimiento.id} className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-600">
                      <span className="min-w-0 truncate">{movimiento.fecha} · {movimiento.concepto}</span>
                      <span className="font-mono font-bold text-slate-800">{money(movimiento.monto)} {movimiento.moneda}{usdDe(movimiento) != null ? ` · $${money(usdDe(movimiento))}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {datos.categorias.length === 0 && (
            <li className="px-3 py-4 text-sm text-slate-500">{loading ? 'Cargando movimientos…' : 'Sin movimientos en este período.'}</li>
          )}
        </ul>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
        <p className="px-4 pt-4 text-xs font-black uppercase tracking-wide text-slate-500">Cuánto entró y salió de cada cuenta</p>
        <ul className="divide-y divide-slate-100 p-2">
          {datos.cuentas.map(cuenta => (
            <li key={cuenta.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-2 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{cuenta.nombre}</span>
              <span className="font-mono text-xs text-emerald-700">+${money(cuenta.ingresos)}</span>
              <span className="font-mono text-xs text-rose-700">−${money(cuenta.egresos)}</span>
              {cuenta.saldo != null && Number.isFinite(Number(cuenta.saldo)) && (
                <span className="font-mono text-xs font-bold text-slate-600">Saldo: {money(cuenta.saldo)} {cuenta.moneda}</span>
              )}
            </li>
          ))}
          {datos.cuentas.length === 0 && (
            <li className="px-3 py-4 text-sm text-slate-500">Sin movimientos por cuenta en este período.</li>
          )}
        </ul>
      </div>

      {parcial && (
        <p className="text-xs font-medium text-slate-500">
          Detalle armado con {movimientos.length} de {totalServidor} movimientos cargados; los totales en USD vienen del libro completo.
        </p>
      )}
    </section>
  )
}
