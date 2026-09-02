// src/components/nomina/ComisionPagoModal.jsx
// Modal para registrar el pago de comisiones a trabajadores sin nómina fija.
// Registra el egreso automáticamente en Finanzas y genera el comprobante en PDF.
import { useState, useMemo } from 'react'
import { DollarSign, FileText, CheckCircle2, RefreshCw, Sparkles, User, Calendar, CreditCard } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import { useCrearMovimiento } from '../../hooks/useFinanzas.js'
import { useNominaEmpleados, useConfigEmpleados } from '../../hooks/useNomina.js'
import useMonedaNomina from '../../hooks/useMonedaNomina.js'
import { logClientError } from '../../../compat/utils/errorLogger.js'
import { useConfigNegocio } from '../../../compat/hooks/useConfigNegocio.js'
import useTasaCambioNomina from '../../hooks/useTasaCambioNomina.js'

import { FORMAS_PAGO_OPCIONES } from '../../constants/formasPago.js'

const inputCls = 'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all'

const METODOS_PAGO = FORMAS_PAGO_OPCIONES

export default function ComisionPagoModal({ empleadoInicial, onClose, onSuccess }) {
  const crearMovimiento = useCrearMovimiento()
  const { data: configs = [] } = useConfigEmpleados()
  const { data: clientes = [] } = useNominaEmpleados()
  const { data: configNegocio } = useConfigNegocio()
  const { fmtBs, shortLabelTasa } = useMonedaNomina()
  const { usd, eur, usdt } = useTasaCambioNomina()

  // Lista de personal con puesto de Vendedor
  const listaVendedores = useMemo(() => {
    return configs
      .filter(c => {
        const cargo = String(c?.cargo || '').toLowerCase()
        return cargo.includes('vendedor') || cargo.includes('ventas') || Number(c?.salario_dia_usd) === 0
      })
      .map(c => ({
        id: c.empleado_id,
        nombre: c.empleado?.nombre || 'Sin nombre',
        documento: c.empleado?.documento || '',
        cargo: c.cargo || 'Vendedor',
        config: c,
      }))
  }, [configs])

  const [empleadoId, setEmpleadoId] = useState(() => {
    if (empleadoInicial?.empleado_id || empleadoInicial?.id) {
      return empleadoInicial.empleado_id || empleadoInicial.id
    }
    return ''
  })
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [concepto, setConcepto] = useState('Comisión por ventas de productos / estructuras')
  const [metodoPago, setMetodoPago] = useState('Efectivo $')
  const [referencia, setReferencia] = useState('')
  const [observaciones, setObservaciones] = useState('')

  const [error, setError] = useState('')
  const [comisionCreada, setComisionCreada] = useState(null)
  const [exportando, setExportando] = useState(false)

  const empSeleccionado = useMemo(() => {
    return listaVendedores.find(p => p.id === empleadoId) || {
      nombre: empleadoInicial?.empleado?.nombre || empleadoInicial?.nombre || 'Vendedor',
      documento: empleadoInicial?.empleado?.documento || empleadoInicial?.documento || '',
      cargo: empleadoInicial?.cargo || 'Vendedor',
    }
  }, [listaVendedores, empleadoId, empleadoInicial])

  const montoNum = Number(monto) || 0
  const tasaActiva = usd > 0 ? usd : 1
  const equivalenteBs = montoNum * tasaActiva

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!empleadoId && !empleadoInicial) {
      return setError('Selecciona el trabajador comisionista.')
    }
    if (!(montoNum > 0)) {
      return setError('Ingresa un monto válido para la comisión.')
    }
    if (!concepto.trim()) {
      return setError('Ingresa el motivo o concepto de la comisión.')
    }

    try {
      const payloadMovimiento = {
        fecha,
        tipo: 'egreso',
        categoria: 'Comisiones',
        concepto: `Comisión — ${empSeleccionado.nombre}: ${concepto.trim()}`,
        monto: montoNum,
        moneda: 'USD',
        tasaVes: tasaActiva,
        fuenteTasa: 'BCV',
        observacionTasa: 'Tasa BCV de nómina',
        referencia: referencia.trim() ? `${metodoPago} - Ref: ${referencia.trim()}` : metodoPago,
        observaciones: `Comisionista: ${empSeleccionado.nombre} (${empSeleccionado.documento || 'Sin doc'}). Cargo: ${empSeleccionado.cargo}. ${observaciones.trim()}`.trim(),
      }

      await crearMovimiento.mutateAsync(payloadMovimiento)

      const comisionData = {
        ...payloadMovimiento,
        monto_usd: montoNum,
        monto_bs: equivalenteBs,
        empleado_nombre: empSeleccionado.nombre,
        empleado_documento: empSeleccionado.documento,
        cargo: empSeleccionado.cargo,
        metodo_pago: metodoPago,
      }

      setComisionCreada(comisionData)
      onSuccess?.(comisionData)
    } catch (err) {
      setError(err.message || 'Error al registrar el egreso de comisión.')
    }
  }

  async function handleDescargarPDF() {
    if (!comisionCreada) return
    setExportando(true)
    try {
      const { generarComisionReciboPDF } = await import('../../services/pdf/comisionReciboPDF.js')
      await generarComisionReciboPDF({
        comision: comisionCreada,
        config: configNegocio ?? {},
        action: 'download',
      })
    } catch (e) {
      logClientError({ mensaje: `Error generando PDF de comisión: ${e?.message || e}`, stack: e?.stack, categoria: 'NOMINA_PDF' })
    } finally {
      setExportando(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={comisionCreada ? 'Comisión Registrada Exitosamente' : 'Registrar Pago de Comisión'}
      className="max-w-xl w-full"
    >
      {comisionCreada ? (
        <div className="space-y-4 py-2">
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-md shadow-emerald-600/20">
              <CheckCircle2 size={24} />
            </div>
            <h4 className="text-base font-black text-emerald-900">¡Egreso Financiero Registrado!</h4>
            <p className="text-xs text-emerald-700 max-w-md mx-auto">
              Se ha contabilizado el pago de comisión de <strong>${montoNum.toFixed(2)} USD</strong> a favor de <strong>{comisionCreada.empleado_nombre}</strong> en el libro diario de Finanzas.
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 text-xs space-y-1.5">
            <div className="flex justify-between text-slate-500">
              <span>Beneficiario:</span>
              <strong className="text-slate-800">{comisionCreada.empleado_nombre}</strong>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Monto en USD:</span>
              <strong className="text-emerald-600 font-black">${comisionCreada.monto_usd.toFixed(2)}</strong>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Equivalente en Bs:</span>
              <span className="font-mono font-bold text-slate-700">{fmtBs(comisionCreada.monto_usd)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Método:</span>
              <span className="font-medium text-slate-700">{comisionCreada.metodo_pago}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleDescargarPDF}
              disabled={exportando}
              className="w-full sm:flex-1 h-11 flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-black shadow-md shadow-primary/20 transition-all active:scale-95 disabled:opacity-60"
            >
              {exportando ? <RefreshCw size={15} className="animate-spin" /> : <FileText size={15} />}
              <span>{exportando ? 'Generando PDF...' : 'Descargar Recibo PDF'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-5 h-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80 flex items-start gap-2.5 text-xs text-amber-900">
            <Sparkles size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p>
              Este registro creará un <strong>Egreso en Finanzas</strong> bajo la categoría <em>Comisiones</em> con la tasa activa del día.
            </p>
          </div>

          {/* Selector de Trabajador (Vendedor) */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
              <User size={13} className="text-primary" />
              <span>Vendedor Comisionista</span>
            </label>
            {empleadoInicial ? (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 flex justify-between items-center">
                <span>{empSeleccionado.nombre}</span>
                <span className="text-[10px] text-amber-800 bg-amber-100 font-bold px-2 py-0.5 rounded-md">{empSeleccionado.cargo}</span>
              </div>
            ) : listaVendedores.length === 0 ? (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                No hay colaboradores registrados con el puesto de <strong>Vendedor</strong>. Configura a un empleado con cargo Vendedor para registrar sus comisiones.
              </div>
            ) : (
              <CustomSelect
                value={empleadoId}
                onChange={setEmpleadoId}
                options={listaVendedores.map(p => ({
                  value: p.id,
                  label: `${p.nombre} — ${p.cargo}`,
                }))}
                placeholder="Selecciona un vendedor..."
              />
            )}
          </div>

          {/* Monto y Conversión */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <DollarSign size={13} className="text-emerald-600" />
                <span>Monto Comisión ($ USD)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                className={inputCls}
                required
                autoFocus
              />
              {montoNum > 0 && (
                <p className="text-[11px] text-slate-500 font-medium">
                  ~ {fmtBs(montoNum)} ({shortLabelTasa})
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <Calendar size={13} className="text-slate-500" />
                <span>Fecha del Pago</span>
              </label>
              <DatePicker
                value={fecha}
                onChange={setFecha}
              />
            </div>
          </div>

          {/* Concepto / Motivo */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600">
              Motivo o Concepto de la Comisión
            </label>
            <input
              type="text"
              placeholder="Ej: Comisión por venta de estructuras / montaje"
              value={concepto}
              onChange={e => setConcepto(e.target.value)}
              className={inputCls}
              required
            />
          </div>

          {/* Método de Pago y Referencia */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <CreditCard size={13} className="text-slate-500" />
                <span>Método de Pago</span>
              </label>
              <CustomSelect
                value={metodoPago}
                onChange={setMetodoPago}
                options={METODOS_PAGO}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600">
                Referencia (Opcional)
              </label>
              <input
                type="text"
                placeholder="Ej: #123456"
                value={referencia}
                onChange={e => setReferencia(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {/* Observaciones */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">
              Observaciones adicionales (Opcional)
            </label>
            <textarea
              rows={2}
              placeholder="Detalles sobre metas, porcentaje o cliente..."
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            />
          </div>

          {/* Botones de Acción */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 min-h-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={crearMovimiento.isPending}
              className="px-5 py-2.5 min-h-11 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-black shadow-md shadow-primary/20 transition-all active:scale-95 disabled:opacity-60 flex items-center gap-2"
            >
              {crearMovimiento.isPending ? <RefreshCw size={14} className="animate-spin" /> : <DollarSign size={14} />}
              <span>{crearMovimiento.isPending ? 'Registrando...' : 'Registrar Egreso de Comisión'}</span>
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
