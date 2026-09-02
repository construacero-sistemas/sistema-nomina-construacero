// src/components/finanzas/CuentaFormModal.jsx
// Modal para registrar o editar una cuenta bancaria, billetera o caja de custodia
import { useState } from 'react'
import {
  Banknote,
  Building2,
  DollarSign,
  Globe,
  Loader2,
  Plus,
  Save,
  Wallet,
} from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import { BANCOS_VENEZUELA, PLATAFORMAS_INTERNACIONALES } from '../../utils/cuentasCustodiaUtils.js'

const TIPOS_CUENTA = [
  { value: 'banco_ves',    label: 'Banco Nacional (Bolívares Bs)',      moneda: 'VES', cartera: 'VES', subcuentaId: 'Banco en Bolívares' },
  { value: 'efectivo_ves', label: 'Caja Física (Efectivo Bs)',          moneda: 'VES', cartera: 'VES', subcuentaId: 'Efectivo Bs' },
  { value: 'efectivo_usd', label: 'Caja Física (Efectivo Dólares $)',    moneda: 'USD', cartera: 'USD', subcuentaId: 'Efectivo $' },
  { value: 'zelle',        label: 'Zelle / Banco Internacional (USD)',  moneda: 'USD', cartera: 'USD', subcuentaId: 'Zelle' },
  { value: 'cripto_usdt',  label: 'Billetera Cripto / Binance (USDT)',   moneda: 'USDT', cartera: 'USD', subcuentaId: 'USDT' },
]

export default function CuentaFormModal({
  open,
  onClose,
  cuentaEditar = null,
  onGuardar,
}) {
  const [nombre, setNombre] = useState(cuentaEditar?.nombre || '')
  const [tipo, setTipo] = useState(cuentaEditar?.tipo || 'banco_ves')
  const [banco, setBanco] = useState(cuentaEditar?.banco || 'BNC (Banco Nacional de Crédito)')
  const [numeroCuenta, setNumeroCuenta] = useState(cuentaEditar?.numeroCuenta || '')
  const [titular, setTitular] = useState(cuentaEditar?.titular || 'Construacero C.A.')
  const [identificacion, setIdentificacion] = useState(cuentaEditar?.identificacion || '')
  const [error, setError] = useState('')

  // Ajustar sugerencia de banco según el tipo
  const handleTipoChange = (nuevoTipo) => {
    setTipo(nuevoTipo)
    if (nuevoTipo === 'banco_ves') {
      setBanco('BNC (Banco Nacional de Crédito)')
    } else if (nuevoTipo === 'cripto_usdt') {
      setBanco('Binance Pay (USDT)')
    } else if (nuevoTipo === 'zelle') {
      setBanco('Zelle')
    } else if (nuevoTipo === 'efectivo_ves') {
      setBanco('Caja Física Bs')
    } else if (nuevoTipo === 'efectivo_usd') {
      setBanco('Caja Fuerte $')
    }
  }

  const opcionesBancos = tipo === 'banco_ves'
    ? BANCOS_VENEZUELA.map(b => ({ value: b, label: b }))
    : PLATAFORMAS_INTERNACIONALES.map(p => ({ value: p, label: p }))

  const tipoConfig = TIPOS_CUENTA.find(t => t.value === tipo) || TIPOS_CUENTA[0]

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')

    if (!nombre.trim()) {
      setError('El nombre o alias de la cuenta es obligatorio.')
      return
    }

    onGuardar({
      nombre: nombre.trim(),
      tipo,
      cartera: tipoConfig.cartera,
      moneda: tipoConfig.moneda,
      subcuentaId: tipoConfig.subcuentaId,
      banco: banco.trim() || nombre.trim(),
      numeroCuenta: numeroCuenta.trim() || null,
      titular: titular.trim() || null,
      identificacion: identificacion.trim() || null,
    })

    onClose()
  }

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={cuentaEditar ? 'Editar Cuenta de Custodia' : 'Añadir Nueva Cuenta / Billetera'}
      className="sm:max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700">
            {error}
          </div>
        )}

        {/* Tipo de Cuenta */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700">Tipo de cuenta o custodia *</label>
          <CustomSelect
            value={tipo}
            onChange={handleTipoChange}
            options={TIPOS_CUENTA.map(t => ({ value: t.value, label: t.label }))}
          />
        </div>

        {/* Nombre / Alias de la Cuenta */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700">Nombre / Alias de la cuenta *</label>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej: Banco BNC Principal, Binance Empresa, Zelle Wells..."
            className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            required
          />
        </div>

        {/* Banco / Plataforma */}
        {tipo !== 'efectivo_ves' && tipo !== 'efectivo_usd' && (
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Banco / Plataforma *</label>
            <CustomSelect
              value={banco}
              onChange={setBanco}
              options={opcionesBancos}
            />
          </div>
        )}

        {/* Número de Cuenta, Correo Zelle o Pay ID */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700">
            {tipo === 'zelle'
              ? 'Correo electrónico o teléfono de Zelle'
              : tipo === 'cripto_usdt'
              ? 'Pay ID / Dirección de billetera Binance'
              : 'Número de cuenta (20 dígitos) o identificador'}
          </label>
          <input
            type="text"
            value={numeroCuenta}
            onChange={e => setNumeroCuenta(e.target.value)}
            placeholder={
              tipo === 'zelle'
                ? 'pagos@empresa.com'
                : tipo === 'cripto_usdt'
                ? 'Pay ID: 123456789'
                : '0191-0001-23-4567890123'
            }
            className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        {/* Titular y RIF */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600">Nombre del Titular (Opcional)</label>
            <input
              type="text"
              value={titular}
              onChange={e => setTitular(e.target.value)}
              placeholder="Construacero C.A."
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600">RIF / Cédula (Opcional)</label>
            <input
              type="text"
              value={identificacion}
              onChange={e => setIdentificacion(e.target.value)}
              placeholder="J-12345678-9"
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800"
            />
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-primary text-xs font-black text-white hover:bg-primary-hover active:scale-95 transition-all shadow-md inline-flex items-center gap-2 cursor-pointer"
          >
            <Save size={14} />
            {cuentaEditar ? 'Actualizar cuenta' : 'Guardar cuenta'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
