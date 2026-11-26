// src/components/nomina/HojaSemanal.jsx
// «Hoja semanal» (docs/PLAN_HOJA_SEMANAL.md): la planilla de la contadora dentro de
// la app, con el bono de $35 en el primer recuadro (sin la tabla aparte de
// «sueldo legal»). En pantalla cada cantidad va debajo de su monto y las columnas
// se agrupan (Semana · Pago · Adicionales); el Excel conserva todas por separado. Los números vienen de los recibos ya calculados;
// los totales suman TODAS las filas. El descuento manual se agrega desde aquí.
// Responsiva sin recortar datos: en teléfono y tablet, una ficha por persona con
// TODOS los campos (sin desplazamiento lateral); desde 1024 px, la tabla completa.
import { Plus } from 'lucide-react'
import HorizontalScroll from '../../../compat/components/ui/HorizontalScroll.jsx'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import useHojaSemanal from '../../hooks/useHojaSemanal.js'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { GRUPOS_PANTALLA, columnasVisibles, usd } from './hojaSemanalCsv.js'
import { formatBs } from '../../hooks/useMonedaNomina.js'

// Monto con su cantidad debajo (en gris), para no gastar una columna en cada una.
function Celda({ monto, detalle, titulo, fuerte = false }) {
  return (
    <>
      <span className={`block ${fuerte ? 'font-black text-slate-900' : ''}`}>{usd(monto)}</span>
      {detalle && <span title={titulo} className="block whitespace-nowrap text-[10px] font-semibold text-slate-400">{detalle}</span>}
    </>
  )
}

function FichaPersona({ fila, columnas, detalleDe, tituloDe, bs, puedeDescontar, onAgregarDescuento }) {
  const nombre = capitalizarPalabras(fila.nombre)
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="break-words text-sm font-black text-slate-900">{nombre}</h4>
          <span className="block text-[11px] font-semibold text-slate-500">${usd(fila.sueldoMensual)} al mes</span>
        </div>
        <div className="shrink-0 text-right">
          <span className="block text-[10px] font-bold uppercase text-slate-500">Neto</span>
          <strong className="block text-base font-black tabular-nums text-emerald-800">${usd(fila.neto)}</strong>
          {bs > 0 && <span className="block font-mono text-[11px] font-bold text-emerald-700">{formatBs(bs)}</span>}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs min-[360px]:grid-cols-2">
        {columnas.map(c => (
          <div key={c.id} className="flex items-baseline justify-between gap-2">
            <dt title={tituloDe?.(c, fila)} className="min-w-0 text-slate-500">{c.titulo}{detalleDe(c, fila) && <span className="text-slate-400"> · {detalleDe(c, fila)}</span>}</dt>
            <dd className={`shrink-0 tabular-nums ${c.fuerte ? 'font-black text-slate-900' : 'font-semibold text-slate-800'}`}>{usd(fila[c.id])}</dd>
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
// `tasa`: Bs por dólar del período (la del cierre o la activa); los recibos ya
// pagados usan la tasa que quedó guardada al pagar.
export default function HojaSemanal({ periodo, lineas = [], abierto, puedeGestionarNomina, bsDe, tasa = 0, tasaOrigen = 'activa', onAgregarDescuento }) {
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
  const columnas = columnasVisibles(filas)
  const tasaDe = fila => (fila.pagado && Number(fila.tasaPago) > 0 ? Number(fila.tasaPago) : Number(tasa) || 0)
  // El total a cobrar lleva debajo su cambio en bolívares; el resto, su cantidad.
  // El bono sale de la semana: si la semana no llega al bono, se paga solo lo que
  // alcanza. Debajo del monto se aclara «de $35,00 · semana incompleta».
  const topeBono = Number(data.bonoSemanal || 0) * Math.max(1, Number(data.semanas) || 1)
  const detalleDe = (c, fila) => {
    if (c.id === 'totalACobrar') return tasaDe(fila) > 0 ? formatBs(Number(fila.totalACobrar) * tasaDe(fila)) : null
    if (c.id === 'bonoSemanal') return topeBono > 0 && Number(fila.bonoSemanal) < topeBono - 0.005 ? `de $${usd(topeBono)}` : null
    return c.detalle?.(fila) || null
  }
  const tituloDe = (c, fila) => (c.id === 'bonoSemanal' && topeBono > 0 && Number(fila.bonoSemanal) < topeBono - 0.005
    ? `Semana incompleta · tope $${usd(topeBono)}`
    : undefined)
  const totalACobrarBs = filas.reduce((s, fila) => s + Number(fila.totalACobrar) * tasaDe(fila), 0)
  const detalleTotalDe = c => (c.id === 'totalACobrar' ? (totalACobrarBs > 0 ? formatBs(totalACobrarBs) : null) : c.detalleTotal?.(totales) || null)
  // Franja de grupos sobre los encabezados: un tramo por grupo consecutivo.
  const tramos = []
  for (const c of columnas) {
    const ultimo = tramos[tramos.length - 1]
    if (ultimo && c.grupo && ultimo.grupo === c.grupo) ultimo.span += 1
    else tramos.push({ grupo: c.grupo || null, span: 1 })
  }

  return (
    <section aria-label="Hoja semanal" className="space-y-2">
      {Number(tasa) > 0 && (
        <p className="inline-flex flex-wrap items-baseline gap-x-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-800">
          Tasa de nómina <strong className="text-sm font-black tabular-nums">Bs {usd(tasa)}</strong> por $1
          <span className="text-emerald-700">({tasaOrigen === 'cierre' ? 'cierre del período' : 'activa'}{filas.some(f => f.pagado && Number(f.tasaPago) > 0) ? '; los pagados usan la tasa guardada al pagar' : ''})</span>
        </p>
      )}
      <ul className="space-y-2.5 lg:hidden" aria-label="Hoja semanal por persona">
        {filas.map(fila => {
          const linea = lineaPorId.get(fila.lineaId)
          return (
            <FichaPersona key={fila.lineaId} fila={fila} columnas={columnas} detalleDe={detalleDe} tituloDe={tituloDe} bs={bsDe(fila)}
              puedeDescontar={Boolean(abierto && puedeGestionarNomina && !fila.pagado && linea)}
              onAgregarDescuento={() => onAgregarDescuento(linea)} />
          )
        })}
        <li className="rounded-2xl border-2 border-slate-300 bg-slate-50 p-3" aria-label="Totales de la semana">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-black text-slate-900">Totales ({totales.empleados})</h4>
            <div className="shrink-0 text-right">
              <strong className="block text-base font-black tabular-nums text-emerald-800">${usd(totales.neto)}</strong>
              {totalBs > 0 && <span className="block font-mono text-[11px] font-bold text-emerald-700">{formatBs(totalBs)}</span>}
            </div>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-xs min-[360px]:grid-cols-2">
            {columnas.map(c => (
              <div key={c.id} className="flex items-baseline justify-between gap-2">
                <dt className="min-w-0 text-slate-500">{c.titulo}{detalleTotalDe(c) && <span className="text-slate-400"> · {detalleTotalDe(c)}</span>}</dt>
                <dd className="shrink-0 font-black tabular-nums text-slate-900">{usd(totales[c.id])}</dd>
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
        {/* El modal permite cortar palabras en cualquier letra (overflow-wrap: anywhere);
            en la tabla los encabezados solo se parten entre palabras. */}
        <table className="w-full text-[12px] tabular-nums [overflow-wrap:normal] [word-break:normal]" aria-label="Hoja semanal del período">
          <thead className="bg-slate-50 text-[10px] uppercase leading-tight text-slate-500">
            <tr aria-hidden="true" className="text-[9px] tracking-wide text-slate-400">
              <td className="px-3 pt-2" />
              {tramos.map((t, i) => (
                <td key={i} colSpan={t.span} className={`px-2 pt-2 text-center font-black ${t.grupo ? 'border-b border-slate-200' : ''}`}>
                  {t.grupo ? GRUPOS_PANTALLA.find(g => g.id === t.grupo)?.titulo : ''}
                </td>
              ))}
              <td colSpan={2} />
            </tr>
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2 text-left font-black">Nombre</th>
              {columnas.map(c => <th key={c.id} className="min-w-[4.5rem] px-2 py-2 text-right align-bottom font-bold">{c.titulo}</th>)}
              <th className="px-2 py-2 text-right align-bottom font-bold">Descuentos</th>
              <th className="px-3 py-2 text-right align-bottom font-black">Neto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.map(fila => {
              const nombre = capitalizarPalabras(fila.nombre)
              const linea = lineaPorId.get(fila.lineaId)
              const puedeDescontar = abierto && puedeGestionarNomina && !fila.pagado && linea
              return (
                <tr key={fila.lineaId}>
                  <th scope="row" className="min-w-[8.5rem] px-3 py-2 text-left font-normal">
                    <span className="block font-bold text-slate-800">{nombre}</span>
                    <span className="block text-[10px] font-semibold text-slate-400">${usd(fila.sueldoMensual)} al mes</span>
                  </th>
                  {columnas.map(c => (
                    <td key={c.id} className={`whitespace-nowrap px-2 py-2 text-right ${c.fuerte ? '' : 'text-slate-700'}`}>
                      <Celda monto={fila[c.id]} detalle={detalleDe(c, fila)} titulo={tituloDe(c, fila)} fuerte={c.fuerte} />
                    </td>
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
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <span className="block font-black text-emerald-800">{usd(fila.neto)}</span>
                    {bsDe(fila) > 0 && <span className="block font-mono text-[10px] font-bold text-emerald-700">{formatBs(bsDe(fila))}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-black text-slate-900">
            <tr>
              <th scope="row" className="px-3 py-2.5 text-left">Totales ({totales.empleados})</th>
              {columnas.map(c => (
                <td key={c.id} className="whitespace-nowrap px-2 py-2.5 text-right">
                  <Celda monto={totales[c.id]} detalle={detalleTotalDe(c)} />
                </td>
              ))}
              <td className="px-2 py-2.5 text-right text-red-600">{usd(totales.descuentos)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right">
                <span className="block text-emerald-800">{usd(totales.neto)}</span>
                {totalBs > 0 && <span className="block font-mono text-[10px] text-emerald-700">{formatBs(totalBs)}</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </HorizontalScroll>
      </div>
    </section>
  )
}
