import { useMemo, useState } from 'react'
import { Wallet, RefreshCw } from 'lucide-react'
import { usePagarLineas } from '../../hooks/useNomina.js'
import { useCuentasCustodia } from '../../hooks/useCuentasCustodia.js'
import useTasaCambioNomina from '../../hooks/useTasaCambioNomina.js'
import { formatUsd, formatBs } from '../../hooks/useMonedaNomina.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import { FORMAS_PAGO_OPCIONES } from '../../constants/formasPago.js'
import { getCuentasCompatibles } from '../finanzas/cuentasCompatibles.js'
import { normalizarMontoInput } from '../finanzas/formatos.js'

const inputClass = 'w-full min-h-11 px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-800'
const PAGE_SIZE = 8

export default function PagarNominaModal({ lineas = [], periodo, onClose }) {
  const pagar = usePagarLineas()
  const { cuentas, cargando, error: cuentasError } = useCuentasCustodia()
  const rates = useTasaCambioNomina()
  const [metodoPago, setMetodoPago] = useState('Efectivo $')
  const [cuentaId, setCuentaId] = useState('')
  const [fuente, setFuente] = useState('BCV')
  const [manual, setManual] = useState('')
  const [referencia, setReferencia] = useState('')
  const [observacion, setObservacion] = useState('')
  const [error, setError] = useState('')
  const [pagina, setPagina] = useState(1)
  const totalUsd = useMemo(() => lineas.reduce((sum, line) => sum + Number(line.total_neto_usd || 0), 0), [lineas])
  const compatibles = getCuentasCompatibles(metodoPago, cuentas)
  const cuenta = compatibles.find(c => c.id === cuentaId) || (compatibles.length === 1 ? compatibles[0] : null)
  const tasaUsdVes = fuente === 'MANUAL' ? Number(manual) : fuente === 'EURO' ? rates.eur : rates.usd
  const tasaLiquidacion = cuenta?.moneda === 'USDT' ? rates.usdt : tasaUsdVes
  const totalNativo = cuenta?.moneda === 'VES' ? totalUsd * tasaUsdVes : cuenta?.moneda === 'USDT'
    ? (tasaLiquidacion > 0 ? totalUsd * tasaUsdVes / tasaLiquidacion : null) : totalUsd
  const paginas = Math.max(1, Math.ceil(lineas.length / PAGE_SIZE))
  const bloqueado = pagar.isPending || cargando || !cuenta || !(tasaUsdVes > 0) || !(tasaLiquidacion > 0) || !lineas.length
  async function confirmar(event) {
    event?.preventDefault()
    if (bloqueado) return
    if (fuente === 'MANUAL' && observacion.trim().length < 3) { setError('Describe el motivo de la tasa manual.'); return }
    setError('')
    try {
      await pagar.mutateAsync({
        lineaIds: lineas.map(l => l.id), referencia: referencia.trim() || null,
        tasaBcv: String(tasaLiquidacion), tasaUsdVes: String(tasaUsdVes), fuenteTasa: fuente === 'MANUAL' ? 'MANUAL' : cuenta.moneda === 'USDT' ? 'USDT' : fuente,
        observacionTasa: observacion.trim() || `Tasas confirmadas al pagar: USD/VES ${tasaUsdVes}; ${cuenta.moneda}/VES ${cuenta.moneda === 'VES' ? 1 : tasaLiquidacion}`,
        metodoPago, cuentaCustodiaId: cuenta.id,
      })
      onClose()
    } catch (e) { setError(e.message || 'No se confirmó el pago.') }
  }
  const footer = <>
    <button type="button" onClick={onClose} disabled={pagar.isPending} className="min-h-11 px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-700">Volver</button>
    <button type="submit" form="pagar-nomina-form" disabled={bloqueado} className="min-h-11 flex-1 sm:flex-none px-4 py-2 rounded-xl bg-primary text-white font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2">
      <Wallet size={18} aria-hidden="true" />{pagar.isPending ? 'Confirmando...' : `Confirmar ${formatUsd(totalUsd)}`}
    </button>
  </>
  return <Modal isOpen onClose={onClose} title="Registrar pago de nómina" className="sm:max-w-lg" busy={pagar.isPending} footer={footer}>
    <form id="pagar-nomina-form" onSubmit={confirmar} className="space-y-4" aria-busy={pagar.isPending}>
      {(error || cuentasError || pagar.error) && <p role="alert" className="p-3 rounded-xl bg-rose-50 text-rose-800 border border-rose-200">{error || cuentasError || pagar.error?.message}</p>}
      <section className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
        <p className="text-sm font-semibold text-slate-600">{periodo?.nombre} · {lineas.length} recibo(s)</p>
        <p className="text-2xl font-black text-slate-900">{formatUsd(totalUsd)}</p>
        <p className="text-sm text-slate-700">{tasaUsdVes > 0 ? formatBs(totalUsd * tasaUsdVes) : 'Equivalencia pendiente de tasa'}</p>
      </section>
      <div><label id="metodo-nomina-label" className="block mb-1 text-sm font-bold">Método de pago</label>
        <CustomSelect aria-labelledby="metodo-nomina-label" placeholder="Método de pago" value={metodoPago} disabled={pagar.isPending}
          onChange={value => { setMetodoPago(value); setCuentaId('') }} options={FORMAS_PAGO_OPCIONES.filter(o => !o.soloIngreso)} />
      </div>
      <div><label id="cuenta-nomina-label" className="block mb-1 text-sm font-bold">Cuenta de salida</label>
        <CustomSelect aria-labelledby="cuenta-nomina-label" placeholder="Selecciona la cuenta de salida" value={cuenta?.id || ''} onChange={setCuentaId} disabled={pagar.isPending || cargando}
          options={compatibles.map(c => ({ value: c.id, label: c.nombre, sub: c.moneda }))} />
        {!cargando && compatibles.length === 0 && <p className="mt-1 text-sm text-amber-800">Registra una cuenta compatible en Tesorería antes de pagar.</p>}
      </div>
      <div><label id="tasa-nomina-label" className="block mb-1 text-sm font-bold">Tasa aplicada a la obligación en USD</label>
        <CustomSelect aria-labelledby="tasa-nomina-label" placeholder="Fuente de tasa" value={fuente} onChange={setFuente} disabled={pagar.isPending}
          options={[{ value: 'BCV', label: 'BCV dólar' }, { value: 'EURO', label: 'Referencia euro acordada' }, { value: 'MANUAL', label: 'Manual acordada' }]} />
        <p className="mt-2 text-sm">{tasaUsdVes > 0 ? `${tasaUsdVes.toLocaleString('es-VE')} Bs por USD` : 'No hay una tasa confirmada. Actualiza o indica una tasa manual.'}</p>
        <button type="button" onClick={rates.refresh} disabled={pagar.isPending || rates.loading} className="min-h-11 inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 mt-2 text-sm font-bold"><RefreshCw size={16} />Actualizar tasas</button>
      </div>
      {fuente === 'MANUAL' && <>
        <label className="block text-sm font-bold">Tasa manual Bs/USD<input type="text" inputMode="decimal" className={inputClass} value={manual} disabled={pagar.isPending}
          onChange={e => { const n = normalizarMontoInput(e.target.value); if (n !== null) setManual(n) }} /></label>
        <label className="block text-sm font-bold">Motivo de la tasa<input className={inputClass} value={observacion} maxLength={300} disabled={pagar.isPending} onChange={e => setObservacion(e.target.value)} /></label>
      </>}
      {cuenta && <p className="p-3 rounded-xl bg-blue-50 text-blue-900 text-sm">Salida de <strong>{cuenta.nombre}</strong>: {totalNativo == null ? 'Tasa pendiente' : `${totalNativo.toLocaleString('es-VE', { maximumFractionDigits: 6 })} ${cuenta.moneda}`}.
        {cuenta.moneda === 'USDT' && ` Conversión con ${rates.usdt} Bs/USDT; no se presupone paridad con USD.`}
      </p>}
      <label className="block text-sm font-bold">Referencia (opcional)<input className={inputClass} value={referencia} maxLength={160} disabled={pagar.isPending} onChange={e => setReferencia(e.target.value)} /></label>
      <section aria-label="Recibos incluidos" className="rounded-xl border border-slate-200 p-3">
        {lineas.slice((Math.min(pagina, paginas) - 1) * PAGE_SIZE, Math.min(pagina, paginas) * PAGE_SIZE).map(l => <p key={l.id} className="flex justify-between gap-3 py-1 text-sm"><span className="min-w-0 break-words">{l.empleado?.nombre || 'Recibo'}</span><strong className="shrink-0">{formatUsd(l.total_neto_usd)}</strong></p>)}
        {paginas > 1 && <div className="flex flex-wrap items-center gap-2 justify-between mt-3"><button type="button" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)} className="min-h-11 px-3 border rounded-xl">Anterior</button><span className="text-xs">{pagina} / {paginas}</span><button type="button" disabled={pagina >= paginas} onClick={() => setPagina(p => p + 1)} className="min-h-11 px-3 border rounded-xl">Siguiente</button></div>}
      </section>
      {pagar.operationId && <div className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-sm text-amber-900"><p className="break-all">Clave de operación: {pagar.operationId}</p><button type="button" disabled={pagar.isPending} onClick={async () => { try { const r = await pagar.checkStatus(); if (r?.estado === 'confirmada') onClose() } catch (e) { setError(e.message) } }} className="min-h-11 mt-2 px-3 border border-amber-500 rounded-xl font-bold">Comprobar resultado</button></div>}
      <p className="text-xs text-slate-600">El pago, los recibos y sus asientos se confirman juntos. Si se pierde la respuesta, conserva la misma operación y comprueba el resultado.</p>
    </form>
  </Modal>
}
