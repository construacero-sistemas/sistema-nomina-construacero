// src/components/nomina/HojaSemanal.jsx
// «Hoja semanal» (docs/PLAN_HOJA_SEMANAL.md): la planilla de la contadora dentro de
// la app, con las mismas columnas y el bono de $35 en el primer recuadro (sin la
// tabla aparte de «sueldo legal»). Los números vienen de los recibos ya calculados;
// los totales suman TODAS las filas. El descuento manual se agrega desde aquí.
// Responsiva sin recortar datos: en teléfono y tablet, una ficha por persona con
// TODOS los campos (sin desplazamiento lateral); desde 1024 px, la tabla completa.
import { Download, Plus } from 'lucide-react'
import HorizontalScroll from '../../../compat/components/ui/HorizontalScroll.jsx'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import useHojaSemanal from '../../hooks/useHojaSemanal.js'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { COLUMNAS, cantidad, hojaACsv, usd } from './hojaSemanalCsv.js'
import { formatBs } from '../../hooks/useMonedaNomina.js'

function FichaPersona({ fila, bs, puedeDescontar, onAgregarDescuento }) {
  const nombre = capitalizarPalabras(fila.nombre)
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 break-words text-sm font-black text-slate-900">{nombre}</h4>
        <div className="shrink-0 text-right">
          <span className="block text-[10px] font-bold uppercase text-slate-500">Neto</span>
          <strong className="block text-base font-black tabular-nums text-emerald-800">${usd(fila.neto)}</strong>
          <span className="block font-mono text-[11px] font-bold text-emerald-700">{formatBs(bs)}</span>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs min-[360px]:grid-cols-2">
        {COLUMNAS.map(c => (
          <div key={c.id} className="flex items-baseline justify-between gap-2">
            <dt className="min-w-0 text-slate-500">{c.titulo}</dt>
            <dd className={`shrink-0 tabular-nums ${c.fuerte ? 'font-black text-slate-900' : 'font-semibold text-slate-800'}`}>{c.formato(fila[c.id])}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-2">
          <dt className="min-w-0 text-slate-500">Descuentos</dt>
          <dd className={`shrink-0 tabular-nums font-semibold ${fila.descuentos > 0 ? 'text-red-600' : 'text-slate-400'}`}>{usd(fila.descuentos)}</dd>
        </div>
      </dl>
      {puedeDescontar && (
        <button type="button" onClick={onAgregarDescuento}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border border-sky-200 bg-white px-3 text-xs font-bold text-sky-800 hover:bg-sky-50"
          style={{ touchAction: 'manipulation' }}>
          <Plus size={13} aria-hidden="true" />Agregar descuento<span className="sr-only"> a {nombre}</span>
        </button>
      )}
    </li>
  )
}

// `bsDe(fila)`: neto de la fila YA en bolívares (lo decide el detalle del período:
// tasa congelada al pagar, al cerrar o la activa).
export default function HojaSemanal({ periodo, lineas = [], abierto, puedeGestionarNomina, bsDe, onAgregarDescuento }) {
  const { data, isLoading, isError, refetch } = useHojaSemanal(periodo.id)
  const lineaPorId = new Map(lineas.map(linea => [linea.id, linea]))

  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />
  if (isError) {
    return (
      <div role="alert" className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800">
        <p>No se pudo armar la hoja semanal. No se muestran totales en cero.</p>
        <button type="button" onClick={() => refetch()} className="min-h-11 rounded-xl border border-rose-300 bg-white px-4 font-bold">Volver a intentar</button>
      </div>
    )
  }
  const filas = data?.filas || []
  const totales = data?.totales || {}
  if (!filas.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-400">
        Aún no se ha calculado la nómina de este período. Pulsa <strong>Calcular</strong> en la pantalla anterior.
      </div>
    )
  }
  const totalBs = filas.reduce((s, fila) => s + bsDe(fila), 0)

  function descargar() {
    const csv = hojaACsv({ periodo, filas, totales, bsDe })
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = `hoja-semanal-${periodo.desde}-a-${periodo.hasta}.csv`
    enlace.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section aria-label="Hoja semanal" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          Semana = sueldo mensual ÷ 30 × 7. Se llena primero el sueldo semanal; el bono (hasta ${usd(data.bonoSemanal)}) es lo que sobra.
        </p>
        <button type="button" onClick={descargar}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
          style={{ touchAction: 'manipulation' }}>
          <Download size={14} aria-hidden="true" /> Descargar Excel
        </button>
      </div>
      <ul className="space-y-2.5 lg:hidden" aria-label="Hoja semanal por persona">
        {filas.map(fila => {
          const linea = lineaPorId.get(fila.lineaId)
          return (
            <FichaPersona key={fila.lineaId} fila={fila} bs={bsDe(fila)}
              puedeDescontar={Boolean(abierto && puedeGestionarNomina && !fila.pagado && linea)}
              onAgregarDescuento={() => onAgregarDescuento(linea)} />
          )
        })}
        <li className="rounded-2xl border-2 border-slate-300 bg-slate-50 p-3" aria-label="Totales de la semana">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-black text-slate-900">Totales ({totales.empleados})</h4>
            <div className="shrink-0 text-right">
              <strong className="block text-base font-black tabular-nums text-emerald-800">${usd(totales.neto)}</strong>
              <span className="block font-mono text-[11px] font-bold text-emerald-700">{formatBs(totalBs)}</span>
            </div>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-xs min-[360px]:grid-cols-2">
            {COLUMNAS.filter(c => c.total).map(c => (
              <div key={c.id} className="flex items-baseline justify-between gap-2">
                <dt className="min-w-0 text-slate-500">{c.titulo}</dt>
                <dd className="shrink-0 font-black tabular-nums text-slate-900">{c.formato(totales[c.id])}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-2">
              <dt className="min-w-0 text-slate-500">Descuentos</dt>
              <dd className="shrink-0 font-black tabular-nums text-red-600">{usd(totales.descuentos)}</dd>
            </div>
          </dl>
        </li>
      </ul>
      <div className="hidden lg:block">
      <HorizontalScroll>
        <table className="w-full whitespace-nowrap text-[11px] tabular-nums" aria-label="Hoja semanal del período">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase leading-tight text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left font-black">Nombre</th>
              {COLUMNAS.map(c => <th key={c.id} className="whitespace-normal px-1.5 py-2 text-right align-bottom font-bold">{c.titulo}</th>)}
              <th className="px-1.5 py-2 text-right align-bottom font-bold">Descuentos</th>
              <th className="px-1.5 py-2 text-right align-bottom font-black">Neto $</th>
              <th className="px-2 py-2 text-right align-bottom font-black">Neto Bs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.map(fila => {
              const nombre = capitalizarPalabras(fila.nombre)
              const linea = lineaPorId.get(fila.lineaId)
              const puedeDescontar = abierto && puedeGestionarNomina && !fila.pagado && linea
              return (
                <tr key={fila.lineaId}>
                  <th scope="row" className="min-w-[7rem] whitespace-normal px-2 py-2 text-left font-bold text-slate-800">{nombre}</th>
                  {COLUMNAS.map(c => (
                    <td key={c.id} className={`px-1.5 py-2 text-right ${c.fuerte ? 'font-black text-slate-900' : 'text-slate-700'}`}>{c.formato(fila[c.id])}</td>
                  ))}
                  <td className="px-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className={fila.descuentos > 0 ? 'font-bold text-red-600' : 'text-slate-400'}>{usd(fila.descuentos)}</span>
                      {puedeDescontar && (
                        <button type="button" onClick={() => onAgregarDescuento(linea)}
                          title={`Agregar descuento a ${nombre}`}
                          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-sky-200 text-sky-800 hover:bg-sky-50"
                          style={{ touchAction: 'manipulation' }}>
                          <Plus size={14} aria-hidden="true" /><span className="sr-only">Descuento a {nombre}</span>
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right font-black text-emerald-800">{usd(fila.neto)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] font-bold text-emerald-700">{formatBs(bsDe(fila))}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-black text-slate-900">
            <tr>
              <th scope="row" className="px-3 py-2.5 text-left">Totales ({totales.empleados})</th>
              {COLUMNAS.map(c => <td key={c.id} className="px-2 py-2.5 text-right">{c.total ? c.formato(totales[c.id]) : ''}</td>)}
              <td className="px-2 py-2.5 text-right text-red-600">{usd(totales.descuentos)}</td>
              <td className="px-2 py-2.5 text-right text-emerald-800">{usd(totales.neto)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-[11px] text-emerald-700">{formatBs(totalBs)}</td>
            </tr>
          </tfoot>
        </table>
      </HorizontalScroll>
      </div>
    </section>
  )
}
