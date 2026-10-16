import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, LockKeyhole, RefreshCw } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import { isoToday } from './fechasRapidas.js'
import { formatNumber } from './formatos.js'

const tasa = value => Number(value) > 0 ? Number(value) : 0
const money = value => value == null ? '—' : formatNumber(value)
const walletKey = row => row.cuentaCustodiaId
const key = () => crypto.randomUUID()
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`
const csvFile = (rows, name) => {
  const blob = new Blob([`\ufeff${rows.map(row => row.map(csvCell).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  URL.revokeObjectURL(url)
}

export default function PeriodoMensualFinanzas({ periodo, saldos, cuentas, loading, error, pending, rates, onRefresh, onOpen, onClose }) {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [opening, setOpening] = useState({})
  const [closing, setClosing] = useState({})
  const [step, setStep] = useState(0)
  const [message, setMessage] = useState('')
  const wallets = periodo?.cuentas || []
  const missing = periodo?.cuentasPendientes || []
  const canUseRates = tasa(rates.usd) > 0 && tasa(rates.usdt) > 0
  const activeWallets = useMemo(() => (cuentas || []).filter(item => item.activo), [cuentas])
  const openingMissing = wallets.filter(wallet => opening[walletKey(wallet)]?.saldoReal === '' || opening[walletKey(wallet)]?.saldoReal == null)

  const openWizard = () => {
    const previous = new Map((periodo?.cierreAnterior || []).map(row => [row.cuentaCustodiaId, row]))
    const next = Object.fromEntries(activeWallets.map(wallet => {
      const prior = previous.get(wallet.id)
      return [wallet.id, {
        metodo: prior ? 'cierre_anterior' : 'saldo_real',
        saldoReal: prior?.saldo ?? '',
        motivo: '',
      }]
    }))
    setOpening(next); setStep(0); setMessage(''); setWizardOpen(true)
  }
  const setOpeningValue = (id, field, value) => setOpening(current => ({ ...current, [id]: { ...current[id], [field]: value } }))
  const setClosingValue = (id, field, value) => setClosing(current => ({ ...current, [id]: { ...current[id], [field]: value } }))

  async function confirmOpening() {
    const rows = activeWallets.map(wallet => {
      const entry = opening[wallet.id] || {}
      const prior = (periodo?.cierreAnterior || []).find(item => item.cuentaCustodiaId === wallet.id)
      const balance = entry.metodo === 'cierre_anterior' ? prior?.saldo : Number(entry.saldoReal)
      return {
        cuentaCustodiaId: wallet.id, metodo: entry.metodo,
        ...(entry.metodo === 'saldo_real' ? { saldoReal: Number(entry.saldoReal) } : {}),
        ...(entry.metodo === 'saldo_real' && prior ? { motivo: entry.motivo || null } : {}),
        tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt),
        ...(wallet.moneda === 'VES' ? { tasaUsdVes: String(rates.usd) } : {}),
        ...(wallet.moneda === 'USDT' ? { tasaUsdtVes: String(rates.usdt) } : {}),
        ...(balance !== undefined ? { previewSaldo: Number(balance) } : {}),
      }
    })
    const missingRows = rows.filter(row => row.metodo === 'saldo_real' && (!Number.isFinite(row.saldoReal) || row.saldoReal < 0))
    if (missingRows.length) { setMessage('Revisa los saldos físicos de todas las cuentas antes de continuar.'); return }
    if (rows.some(row => row.metodo === 'cierre_anterior' && row.previewSaldo == null)) { setMessage('No se pudo recuperar un cierre anterior consistente.'); return }
    if (rows.some(row => {
      const prior = (periodo?.cierreAnterior || []).find(item => item.cuentaCustodiaId === row.cuentaCustodiaId)
      return row.metodo === 'saldo_real' && prior && Math.abs(Number(row.saldoReal) - Number(prior.saldo)) > 0.000001
        && String(row.motivo || '').trim().length < 8
    })) { setMessage('Justifica con al menos 8 caracteres cada diferencia frente al cierre anterior.'); return }
    rows.forEach(row => { delete row.previewSaldo })
    try {
      await onOpen({ accion: 'aperturar', mesInicio: periodo.mes, idempotencyKey: key(), payload: { cuentas: rows, tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt) } })
      setWizardOpen(false); setMessage('Apertura mensual confirmada. Saldos y tasas quedaron congelados.')
      await onRefresh()
    } catch (cause) { setMessage(cause.message || 'No se confirmó la apertura; conserva los datos y reintenta.') }
  }

  async function confirmClosing() {
    // El conteo prellenado (saldoCalculado) cuenta como saldo contado aunque el
    // usuario no haya tocado el campo: la validación usa la misma fuente que el input.
    const rows = wallets.map(wallet => {
      const entry = closing[walletKey(wallet)] || {}
      return { cuentaCustodiaId: walletKey(wallet), saldoReal: Number(entry.saldoReal ?? wallet.saldoCalculado), motivo: entry.motivo || null,
        tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt) }
    })
    if (rows.some(row => !Number.isFinite(row.saldoReal) || row.saldoReal < 0)) { setMessage('Registra el saldo contado de cada cuenta abierta.'); return }
    if (wallets.some(wallet => {
      const entry = closing[walletKey(wallet)] || {}
      return Math.abs(Number(entry.saldoReal ?? wallet.saldoCalculado) - Number(wallet.saldoCalculado || 0)) > 0.000001
        && String(entry.motivo || '').trim().length < 8
    })) {
      setMessage('Justifica con al menos 8 caracteres cada diferencia contra el saldo calculado.'); return
    }
    try {
      await onClose({ accion: 'cerrar', mesInicio: periodo.mes, idempotencyKey: key(), payload: { cuentas: rows, tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt) } })
      setMessage('Cierre mensual confirmado. El libro queda de solo lectura para ese mes.')
      await onRefresh()
    } catch (cause) { setMessage(cause.message || 'No se confirmó el cierre; conserva los datos y reintenta.') }
  }

  function downloadPeriod() {
    const headers = ['Mes','Nombre de cuenta','Cuenta ID','Moneda','Método de apertura','Saldo inicial','Saldo inicial USD','Saldo nativo calculado','Saldo contado','Diferencia','Motivo diferencia','Tasa USD/VES apertura','Tasa USDT/VES apertura','Saldo cierre real','Saldo cierre USD','Diferencia cierre','Motivo cierre','Origen saldo']
    const rows = wallets.map(row => [periodo.mes, row.nombre, row.cuentaCustodiaId, row.moneda, row.metodoApertura,
      row.saldoApertura, row.saldoAperturaUsd, row.saldoCalculado, row.saldoContadoApertura, row.diferenciaApertura,
      row.motivoApertura, row.tasaUsdVes, row.tasaUsdtVes, row.saldoCierreReal, row.saldoCierreUsd,
      row.diferenciaCierre, row.motivoCierre, row.origenSaldo])
    csvFile([headers, ...rows], `finanzas-apertura-${periodo.mes}.csv`)
  }

  return <section aria-label="Control mensual de tesorería" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-black text-slate-900">Apertura y cierre mensual</h2>
        <p className="text-sm text-slate-600">{periodo?.mes || '—'} · {periodo?.estado || 'Consultando'}</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onRefresh} disabled={loading} className="min-h-11 px-3 rounded-xl border font-bold"><RefreshCw size={15} className="inline mr-1"/>Actualizar</button>
        {periodo?.estado === 'sin_apertura' && <button type="button" onClick={openWizard} disabled={pending || loading || !canUseRates || activeWallets.length === 0} className="min-h-11 px-4 rounded-xl bg-primary text-white font-bold disabled:opacity-50">Iniciar apertura guiada</button>}
        {periodo?.estado === 'abierto' && <button type="button" onClick={confirmClosing} disabled={pending || loading || missing.length > 0 || !wallets.length || !canUseRates} className="min-h-11 px-4 rounded-xl bg-amber-700 text-white font-bold disabled:opacity-50"><LockKeyhole size={15} className="inline mr-1"/>Cerrar mes</button>}
        {wallets.length > 0 && <button type="button" onClick={downloadPeriod} disabled={loading} className="min-h-11 px-3 rounded-xl border font-bold"><Download size={15} className="inline mr-1"/>CSV de apertura/cierre</button>}
      </div>
    </div>
    {!canUseRates && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">No hay tasas USD/VES y USDT/VES confirmadas; no se puede congelar una valoración USD.</p>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {periodo?.estado === 'sin_apertura' && <div role="status" className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle size={18} className="shrink-0"/><span>El período {periodo.mes} todavía no está aperturado. Registra o egresa solo después de verificar saldos físicos, revisar actividad previa y confirmar la tasa USD congelada.</span></div>}
    {periodo?.estado === 'abierto' && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><CheckCircle2 size={18} className="mr-1 inline"/>Período abierto. La apertura se conserva en moneda nativa y su contravalor USD usa la tasa congelada; la tasa de mercado posterior no reescribe ese valor.
      {missing.length > 0 && <p className="mt-2 font-bold">Hay {missing.length} cuenta(s) nueva(s) sin saldo inicial. Ábrelas y registra su saldo para poder operar el mes.</p>}</div>}
    {message && <p role="status" className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
    {wallets.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="p-2">Cuenta</th><th>Moneda</th><th>Saldo de apertura</th><th>USD congelado</th><th>Saldo calculado</th><th>Diferencia cierre</th></tr></thead><tbody>{wallets.map(row => <tr key={walletKey(row)} className="border-b last:border-0"><td className="p-2 font-semibold">{row.nombre}</td><td>{row.moneda}</td><td>{money(row.saldoApertura)} {row.moneda}</td><td>{row.saldoAperturaUsd == null ? '—' : `$${money(row.saldoAperturaUsd)}`}</td><td>{money(row.saldoCalculado)} {row.moneda}</td><td>{money(row.diferenciaCierre)} {row.diferenciaCierre == null ? '' : row.moneda}</td></tr>)}</tbody></table></div>}
    {periodo?.estado === 'abierto' && wallets.length > 0 && <div className="space-y-3 border-t pt-3"><h3 className="font-bold">Conteo físico de cierre</h3>{wallets.map(row => <div key={walletKey(row)} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-3">
      <div><p className="font-semibold">{row.nombre} · {row.moneda}</p><p className="text-xs text-slate-600">Libro calcula {money(row.saldoCalculado)} {row.moneda}</p></div>
      <label className="text-xs font-bold">Saldo contado<input className="mt-1 w-full rounded-lg border p-2 text-base" inputMode="decimal" value={closing[walletKey(row)]?.saldoReal ?? (row.saldoCalculado ?? '')} disabled={pending} onChange={event => setClosingValue(walletKey(row), 'saldoReal', event.target.value)} /></label>
      <label className="text-xs font-bold">Motivo de diferencia (si aplica)<input className="mt-1 w-full rounded-lg border p-2 text-base" value={closing[walletKey(row)]?.motivo || ''} disabled={pending} maxLength={300} onChange={event => setClosingValue(walletKey(row), 'motivo', event.target.value)} /></label>
    </div>)}</div>}
    {periodo?.estado === 'cerrado' && <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold">Cierre confirmado {periodo.cerradoEn ? `el ${new Date(periodo.cerradoEn).toLocaleString('es-VE')}` : ''}. Revisa/descarga el CSV para mantener el detalle de auditoría.</p>}

    {wizardOpen && <Modal isOpen onClose={() => !pending && setWizardOpen(false)} title="Apertura mensual de tesorería" className="sm:max-w-3xl" footer={<div className="flex w-full justify-between gap-2"><button type="button" onClick={() => step ? setStep(step - 1) : setWizardOpen(false)} disabled={pending} className="min-h-11 px-4 rounded-xl border font-bold">{step ? 'Anterior' : 'Cancelar'}</button>{step < 2 ? <button type="button" onClick={() => setStep(step + 1)} disabled={pending || (step === 0 && !canUseRates) || (step === 1 && activeWallets.some(wallet => opening[wallet.id]?.metodo === 'saldo_real' && (!Number.isFinite(Number(opening[wallet.id]?.saldoReal)) || Number(opening[wallet.id]?.saldoReal) < 0)))} className="min-h-11 px-4 rounded-xl bg-primary text-white font-bold">Siguiente</button> : <button type="button" onClick={confirmOpening} disabled={pending || !canUseRates} className="min-h-11 px-4 rounded-xl bg-emerald-700 text-white font-bold">{pending ? 'Confirmando…' : 'Confirmar apertura'}</button>}</div>}>
      <div className="space-y-4"><ol className="flex gap-2 text-xs font-bold">{['Tasas','Cuentas y saldos','Revisión'].map((label,index) => <li key={label} className={`rounded-full px-3 py-2 ${step===index?'bg-primary text-white':'bg-slate-100 text-slate-600'}`}>{index+1}. {label}</li>)}</ol>
        <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-950">Fecha de apertura {isoToday()}. Las tasas se fijan ahora y no se actualizan en este período.</p>
        {step === 0 && <div className="grid gap-3 sm:grid-cols-2"><p className="rounded-xl border p-3">USD/VES<br/><strong>{rates.usd ? formatNumber(rates.usd) : 'No disponible'}</strong></p><p className="rounded-xl border p-3">USDT/VES<br/><strong>{rates.usdt ? formatNumber(rates.usdt) : 'No disponible'}</strong></p><p className="sm:col-span-2 text-xs text-slate-600">Origen: {rates.source || 'sin fuente'} · Última actualización {rates.lastUpdate || 'desconocida'}{rates.stale ? ' · tasa marcada como vencida' : ''}</p></div>}
        {step === 1 && <div className="max-h-[55vh] space-y-3 overflow-y-auto">{activeWallets.map(wallet => { const entry=opening[wallet.id]||{}; const previous=(periodo?.cierreAnterior||[]).find(row=>row.cuentaCustodiaId===wallet.id); return <div key={wallet.id} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-3"><div><p className="font-semibold">{wallet.nombre} · {wallet.moneda}</p><p className="text-xs text-slate-500">Saldo anterior: {previous ? `${money(previous.saldo)} ${wallet.moneda}` : 'No disponible'}</p></div><div className="text-xs font-bold">Fuente del saldo<div className="mt-1"><CustomSelect aria-label={`Fuente del saldo de ${wallet.nombre}`} value={entry.metodo} disabled={pending} onChange={value=>setOpeningValue(wallet.id,'metodo',value)} showSubInTrigger={false} options={[{ value: 'saldo_real', label: 'Conteo físico verificado' }, ...(previous ? [{ value: 'cierre_anterior', label: 'Cierre anterior' }] : [])]} /></div></div>{entry.metodo==='saldo_real' ? <label className="text-xs font-bold">Saldo contado<input inputMode="decimal" value={entry.saldoReal} disabled={pending} onChange={event=>setOpeningValue(wallet.id,'saldoReal',event.target.value)} className="mt-1 w-full rounded-lg border p-2 text-base" /></label> : <p className="self-center text-sm font-bold">Se hereda: {money(previous?.saldo)} {wallet.moneda}</p>}{previous && entry.metodo==='saldo_real' && <label className="text-xs font-bold sm:col-span-3">Motivo si difiere del cierre anterior<input value={entry.motivo} maxLength={300} disabled={pending} onChange={event=>setOpeningValue(wallet.id,'motivo',event.target.value)} className="mt-1 w-full rounded-lg border p-2 text-base" placeholder="Al menos 8 caracteres" /></label>}</div>})}</div>}
        {step === 2 && <div className="space-y-2 text-sm"><p><strong>{activeWallets.length}</strong> cuentas se aperturarán para {periodo.mes}.</p><p>Tasas congeladas: USD/VES {rates.usd}; USDT/VES {rates.usdt}.</p>{activeWallets.map(wallet => { const row=opening[wallet.id]||{}; const amount=row.metodo==='saldo_real'?Number(row.saldoReal):Number((periodo?.cierreAnterior||[]).find(item=>item.cuentaCustodiaId===wallet.id)?.saldo); const usd=wallet.moneda==='USD'?amount:wallet.moneda==='VES'?amount/tasa(rates.usd):amount*tasa(rates.usdt)/tasa(rates.usd); return <p key={wallet.id} className="rounded-lg bg-slate-50 p-2">{wallet.nombre}: {money(amount)} {wallet.moneda} ≈ ${money(usd)} USD · {row.metodo==='saldo_real'?'conteo físico':'cierre anterior'}</p>})}</div>}
        {message && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{message}</p>}
      </div>
    </Modal>}
  </section>
}
