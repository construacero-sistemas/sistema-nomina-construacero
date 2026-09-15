import { useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import { BANCOS_VENEZUELA, PLATAFORMAS_CRIPTO, PLATAFORMAS_ZELLE_USD, capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { normalizarMontoInput } from './formatos.js'

const TIPOS_CUENTA = [
  { value: 'banco_ves', label: 'Banco Nacional (Bolívares Bs)', moneda: 'VES', cartera: 'VES', subcuentaId: 'Banco en Bolívares' },
  { value: 'efectivo_ves', label: 'Caja Física (Efectivo Bs)', moneda: 'VES', cartera: 'VES', subcuentaId: 'Efectivo Bs' },
  { value: 'efectivo_usd', label: 'Caja Física (Efectivo Dólares $)', moneda: 'USD', cartera: 'USD', subcuentaId: 'Efectivo $' },
  { value: 'zelle', label: 'Zelle / Banco Internacional (USD)', moneda: 'USD', cartera: 'USD', subcuentaId: 'Zelle' },
  { value: 'cripto_usdt', label: 'Billetera Cripto / Binance (USDT)', moneda: 'USDT', cartera: 'USD', subcuentaId: 'USDT' },
]
const inputClass = 'mt-1 w-full min-h-11 px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-800 disabled:opacity-60'
const bancosPorTipo = { banco_ves: BANCOS_VENEZUELA, cripto_usdt: PLATAFORMAS_CRIPTO, zelle: PLATAFORMAS_ZELLE_USD }
const bancoInicial = tipo => ({ banco_ves: 'BNC (Banco Nacional de Crédito)', cripto_usdt: 'Binance Pay (USDT)', zelle: 'Zelle', efectivo_ves: 'Caja Física Bs', efectivo_usd: 'Caja Fuerte $' })[tipo]

export default function CuentaFormModal({ open, onClose, cuentaEditar = null, onGuardar }) {
  const [nombre, setNombre] = useState(cuentaEditar?.nombre || '')
  const [tipo, setTipo] = useState(cuentaEditar?.tipo || 'banco_ves')
  const [banco, setBanco] = useState(cuentaEditar?.banco || bancoInicial(cuentaEditar?.tipo || 'banco_ves'))
  const [otroBanco, setOtroBanco] = useState('')
  const [saldoInicial, setSaldoInicial] = useState('')
  const [numeroCuenta, setNumeroCuenta] = useState(cuentaEditar?.numeroCuenta || '')
  const [titular, setTitular] = useState(cuentaEditar?.titular || 'Construacero C.A.')
  const [identificacion, setIdentificacion] = useState(cuentaEditar?.identificacion || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [operationId] = useState(() => crypto.randomUUID())
  const [dirty, setDirty] = useState(false)
  const [closeRequested, setCloseRequested] = useState(false)
  const tipoConfig = TIPOS_CUENTA.find(t => t.value === tipo) || TIPOS_CUENTA[0]
  const close = () => { if (!savingRef.current) { if (dirty) setCloseRequested(true); else onClose() } }
  async function handleSubmit(event) {
    event.preventDefault()
    if (savingRef.current) return
    setError('')
    const nombreLimpio = capitalizarPalabras(nombre.trim())
    if (!nombreLimpio) { setError('El nombre o alias de la cuenta es obligatorio.'); return }
    if (banco === 'Otro Banco' && !otroBanco.trim()) { setError('Indica el nombre del banco.'); return }
    const bancoFinal = banco === 'Otro Banco' ? otroBanco.trim() : banco.trim() || nombreLimpio
    savingRef.current = true; setSaving(true)
    try {
      await onGuardar({ nombre: nombreLimpio, tipo, cartera: tipoConfig.cartera, moneda: tipoConfig.moneda,
        subcuentaId: tipoConfig.subcuentaId, banco: capitalizarPalabras(bancoFinal),
        numeroCuenta: numeroCuenta.trim() || null, titular: titular.trim() ? capitalizarPalabras(titular.trim()) : null,
        identificacion: identificacion.trim() || null,
      }, Number(saldoInicial) || 0, operationId)
      onClose()
    } catch (cause) { setError(cause.message || 'No se confirmó el guardado. Conserva los datos y reintenta.') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const footer = <>
    <button type="button" onClick={close} disabled={saving} className="min-h-11 px-4 py-2 rounded-xl border border-slate-300 font-bold">Cancelar</button>
    <button type="submit" form="cuenta-form" disabled={saving} className="min-h-11 px-4 py-2 rounded-xl bg-primary text-white font-bold inline-flex items-center gap-2 disabled:opacity-60"><Save size={18} aria-hidden="true" />{saving ? 'Confirmando...' : cuentaEditar ? 'Actualizar cuenta' : 'Guardar cuenta'}</button>
  </>
  return <>
    <Modal isOpen={open} onClose={close} busy={saving} title={cuentaEditar ? 'Editar Cuenta de Custodia' : 'Añadir Nueva Cuenta / Billetera'} className="sm:max-w-lg" footer={footer}>
      <form id="cuenta-form" onSubmit={handleSubmit} onChange={() => setDirty(true)} className="space-y-4" aria-busy={saving}>
        {error && <p role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800">{error}</p>}
        <div><span id="tipo-cuenta-label" className="block text-sm font-bold mb-1">Tipo de cuenta o custodia *</span>
          <CustomSelect aria-labelledby="tipo-cuenta-label" value={tipo} disabled={saving || !!cuentaEditar} onChange={value => { setTipo(value); setBanco(bancoInicial(value)); setDirty(true) }} options={TIPOS_CUENTA} />
          {cuentaEditar && <p className="text-xs text-slate-600 mt-1">El tipo y la moneda se conservan para proteger su historial.</p>}
        </div>
        <label className="block text-sm font-bold">Nombre / Alias de la cuenta *<input className={inputClass} value={nombre} onChange={e => setNombre(e.target.value)} maxLength={80} required disabled={saving} placeholder="Ej: Banco BNC Principal, Binance Empresa, Zelle Wells..." /></label>
        {bancosPorTipo[tipo] && <div><span id="banco-cuenta-label" className="block text-sm font-bold mb-1">Banco / Plataforma *</span>
          <CustomSelect aria-labelledby="banco-cuenta-label" value={banco} disabled={saving} onChange={value => { setBanco(value); setDirty(true) }} options={bancosPorTipo[tipo].map(b => ({ value: b, label: b }))} />
          {banco === 'Otro Banco' && <label className="block text-sm mt-2">Nombre del banco<input className={inputClass} value={otroBanco} onChange={e => setOtroBanco(e.target.value)} required disabled={saving} maxLength={80} /></label>}
        </div>}
        <label className="block text-sm font-bold">{tipo === 'zelle' ? 'Correo o teléfono de Zelle' : tipo === 'cripto_usdt' ? 'Pay ID / Dirección de billetera' : 'Número de cuenta o identificador'}<input className={inputClass} value={numeroCuenta} onChange={e => setNumeroCuenta(e.target.value)} maxLength={120} disabled={saving} /></label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm font-bold">Titular (opcional)<input className={inputClass} value={titular} onChange={e => setTitular(e.target.value)} maxLength={120} disabled={saving} /></label>
          <label className="block text-sm font-bold">RIF / Cédula (opcional)<input className={inputClass} value={identificacion} onChange={e => setIdentificacion(e.target.value)} maxLength={40} disabled={saving} /></label>
        </div>
        {!cuentaEditar && <section className="p-3 rounded-xl border border-amber-300 bg-amber-50 space-y-2">
          <label className="block text-sm font-bold text-amber-900">Saldo inicial de apertura (opcional) · {tipoConfig.moneda}<input className={inputClass} type="text" inputMode="decimal" value={saldoInicial} disabled={saving} placeholder="0.00" onChange={e => { const value = normalizarMontoInput(e.target.value); if (value !== null) setSaldoInicial(value) }} /></label>
          <p className="text-xs text-amber-900">La cuenta y el movimiento de apertura se confirman por separado. Si la apertura falla, el formulario conserva la cuenta y permite reintentar sin duplicarla.</p>
        </section>}
      </form>
    </Modal>
    {closeRequested && <Modal isOpen onClose={() => setCloseRequested(false)} title="¿Descartar los cambios sin guardar?" footer={<><button type="button" onClick={() => setCloseRequested(false)} className="min-h-11 px-3 py-2 border rounded-xl">Seguir editando</button><button type="button" onClick={onClose} className="min-h-11 px-3 py-2 bg-rose-700 text-white rounded-xl">Descartar cambios</button></>}><p className="text-sm text-slate-700">Una cuenta o apertura ya confirmada no se deshace al cerrar. Revisa su estado antes de volver a registrarla.</p></Modal>}
  </>
}
