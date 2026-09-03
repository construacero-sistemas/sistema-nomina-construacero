// src/components/finanzas/CuentasCustodiaGrid.jsx
// Cuadrícula visual de tarjetas de cuentas bancarias, billeteras y cajas de custodia (oculta por defecto)
import { useState } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  DollarSign,
  Edit2,
  ExternalLink,
  Eye,
  Globe,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
} from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function CuentasCustodiaGrid({
  cuentas = [],
  cuentasEliminadas = [],
  onRestaurarEliminada,
  onNuevaCuenta,
  onEditarCuenta,
  onEliminarCuenta,
  onVerDetalle,
  onTransferir,
  onRestaurar,
}) {
  // Ocultas / Colapsadas por defecto según directiva del usuario
  const [expandido, setExpandido] = useState(false)
  const [copiadoId, setCopiadoId] = useState(null)
  // Borrado confirmado con modal en la app (sin window.confirm nativo).
  const [cuentaAEliminar, setCuentaAEliminar] = useState(null)

  // Guarda de borrado seguro: no se puede eliminar una cuenta con fondos.
  // Eliminar TODAS las cuentas es válido (el sistema arranca vacío para que
  // cada negocio cree las suyas); solo se protege el dinero registrado.
  const motivoBloqueo = (cuenta) => {
    if (!cuenta) return ''
    if (Number(cuenta.saldo) !== 0) {
      return `Esta cuenta tiene ${cuenta.moneda === 'VES' ? 'Bs. ' : '$'}${formatMoney(cuenta.saldo)} registrados. Para eliminarla, deja primero el saldo en 0 (mueve los fondos a otra cuenta).`
    }
    return ''
  }

  const bloqueoActual = motivoBloqueo(cuentaAEliminar)

  const handleCopiar = (e, text, id) => {
    e.stopPropagation()
    if (!text) return
    navigator.clipboard?.writeText(text)
    setCopiadoId(id)
    setTimeout(() => setCopiadoId(null), 2000)
  }

  return (
    <div className="space-y-3 bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 transition-all">
      {/* Barra de Encabezado y Toggle de Detalle */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-black shrink-0">
            <Building2 size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-slate-800 truncate">
                Cuentas Bancarias y Custodia Digital
              </h3>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold shrink-0">
                {cuentas.length} cuentas
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate">
              {expandido
                ? 'Detalle de bancos nacionales, billeteras Binance USDT, Zelle y efectivo.'
                : 'Oculto por defecto. Pulsa el botón para ver todas las cuentas y billeteras.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Botón para desplegar / ocultar el detalle de cuentas */}
          <button
            type="button"
            onClick={() => setExpandido(prev => !prev)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer shadow-xs active:scale-95 ${
              expandido
                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                : 'bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            {expandido ? (
              <>
                <ChevronUp size={14} />
                <span>Ocultar cuentas a detalle</span>
              </>
            ) : (
              <>
                <ChevronDown size={14} />
                <span>Ver cuentas a detalle</span>
              </>
            )}
          </button>

          {/* Botón para añadir nueva cuenta */}
          <button
            type="button"
            onClick={onNuevaCuenta}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-black hover:bg-primary-hover active:scale-95 transition-all shadow-md cursor-pointer"
            style={{ touchAction: 'manipulation' }}
          >
            <Plus size={14} />
            <span>Nueva Cuenta</span>
          </button>
        </div>
      </div>

      {/* Grid de Tarjetas de Cuentas (Solo visible cuando expandido === true) */}
      {expandido && cuentas.length === 0 && (
        <div className="pt-3 border-t border-slate-100 animate-in fade-in duration-200">
          <div className="p-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-2xl bg-slate-200 text-slate-500 flex items-center justify-center">
              <Wallet size={18} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-black text-slate-700">Sin cuentas de custodia</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Crea tus cuentas reales (bancos, cajas, billeteras) para llevar el control de saldos.
                Las dos cajas físicas (Bs y $) son permanentes y siempre están disponibles para el efectivo.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={onNuevaCuenta}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-11 rounded-xl bg-primary text-white text-xs font-black hover:bg-primary-hover active:scale-95 transition-all shadow-md cursor-pointer"
                style={{ touchAction: 'manipulation' }}
              >
                <Plus size={14} />
                <span>Crear primera cuenta</span>
              </button>
              {onRestaurar && (
                <button
                  type="button"
                  onClick={onRestaurar}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer"
                  style={{ touchAction: 'manipulation' }}
                >
                  <RotateCcw size={14} />
                  <span>Restaurar cajas físicas</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Papelera: cuentas eliminadas recuperables (borrado lógico) */}
      {expandido && cuentasEliminadas.length > 0 && (
        <div className="pt-3 border-t border-slate-100 animate-in fade-in duration-200">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
            Eliminadas recientemente ({cuentasEliminadas.length}) — recuperables
          </p>
          <div className="flex flex-wrap gap-2">
            {cuentasEliminadas.map(cuenta => (
              <span key={cuenta.id} className="inline-flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs text-slate-500">
                <span className="max-w-[180px] truncate font-semibold text-slate-600">{cuenta.nombre}</span>
                <button
                  type="button"
                  onClick={() => onRestaurarEliminada?.(cuenta.id)}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer"
                  aria-label={`Restaurar ${cuenta.nombre}`}
                >
                  <RotateCcw size={12} /> Restaurar
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {expandido && cuentas.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-3 border-t border-slate-100 animate-in fade-in duration-200">
          {cuentas.map(cuenta => {
            const esVes = cuenta.moneda === 'VES' || cuenta.cartera === 'VES'
            const esCripto = cuenta.tipo === 'cripto_usdt'
            const esZelle = cuenta.tipo === 'zelle'

            return (
              <div
                key={cuenta.id}
                onClick={() => onVerDetalle?.(cuenta)}
                className={`p-3.5 rounded-2xl border bg-white hover:shadow-md transition-all cursor-pointer group relative flex flex-col justify-between ${
                  esVes
                    ? 'border-blue-100 hover:border-blue-300'
                    : 'border-emerald-100 hover:border-emerald-300'
                }`}
              >
                <div>
                  {/* Header de la tarjeta */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 shadow-xs ${
                        esVes
                          ? 'bg-blue-600'
                          : esCripto
                          ? 'bg-cyan-600'
                          : esZelle
                          ? 'bg-purple-600'
                          : 'bg-emerald-600'
                      }`}>
                        {esVes ? <Building2 size={18} /> : esCripto || esZelle ? <Globe size={18} /> : <DollarSign size={18} />}
                      </div>

                      <div className="min-w-0">
                        <h4 className="text-xs font-black text-slate-900 truncate">
                          {cuenta.nombre}
                        </h4>
                        <p className="text-[10px] text-slate-400 font-bold truncate">
                          {cuenta.banco || (esVes ? 'Banco en Bolívares' : 'Dólares USD')}
                        </p>
                      </div>
                    </div>

                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black shrink-0 ${
                      esVes ? 'bg-blue-50 text-blue-800' : 'bg-emerald-50 text-emerald-800'
                    }`}>
                      {cuenta.moneda}
                    </span>
                  </div>

                  {cuenta.permanente && (
                    <p className="mb-2 -mt-1 flex items-center gap-1 text-[10px] font-bold text-slate-400">
                      <Lock size={10} aria-hidden="true" /> Permanente (no eliminable)
                    </p>
                  )}

                  {/* Saldo de la Cuenta */}
                  <div className="py-2 px-3 rounded-xl bg-slate-50 border border-slate-100 mb-2.5">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">
                      Saldo Disponible
                    </span>
                    <span className="text-lg font-black text-slate-900 block truncate">
                      {esVes ? 'Bs. ' : '$'}{formatMoney(cuenta.saldo)}{' '}
                      <span className="text-[10px] font-bold text-slate-400">{cuenta.moneda}</span>
                    </span>
                  </div>

                  {/* Datos de Cuenta / Billetera (si existen) */}
                  {cuenta.numeroCuenta && (
                    <div className="flex items-center justify-between text-[11px] bg-slate-50/70 px-2.5 py-1.5 rounded-lg border border-slate-100 mb-2 text-slate-600">
                      <span className="truncate font-mono font-medium text-[10px]" title={cuenta.numeroCuenta}>
                        {cuenta.numeroCuenta}
                      </span>
                      <button
                        type="button"
                        onClick={e => handleCopiar(e, cuenta.numeroCuenta, cuenta.id)}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors shrink-0 cursor-pointer ml-1"
                        title="Copiar datos al portapapeles"
                      >
                        {copiadoId === cuenta.id ? (
                          <Check size={12} className="text-emerald-600" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Botones de acción inferiores */}
                <div className="flex items-center justify-between gap-1 pt-2 border-t border-slate-100 text-xs">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation()
                      onVerDetalle?.(cuenta)
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-primary transition-colors cursor-pointer"
                  >
                    <Eye size={12} />
                    <span>Detalle</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        onTransferir?.(cuenta)
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[10px] font-bold text-slate-700 transition-all cursor-pointer"
                      title="Mover fondos desde esta cuenta"
                    >
                      <ArrowRightLeft size={11} className="text-primary" />
                      <span>Mover</span>
                    </button>

                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        onEditarCuenta?.(cuenta)
                      }}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                      title="Editar cuenta"
                    >
                      <Edit2 size={12} />
                    </button>

                    {/* Las cajas físicas permanentes (Bs/$) no se eliminan: son
                        el bucket universal del efectivo. Se pueden editar. */}
                    {cuenta.permanente ? (
                      <span
                        className="p-1.5 text-slate-200 select-none"
                        title="La caja física es permanente: garantiza dónde vive el efectivo"
                      >
                        <Lock size={12} aria-hidden="true" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setCuentaAEliminar(cuenta)
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Eliminar cuenta"
                        aria-label={`Eliminar cuenta ${cuenta.nombre}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de confirmación de eliminación (reemplaza window.confirm nativo) */}
      <Modal
        isOpen={Boolean(cuentaAEliminar)}
        onClose={() => setCuentaAEliminar(null)}
        title={bloqueoActual ? 'No se puede eliminar la cuenta' : '¿Eliminar cuenta de custodia?'}
        className="sm:max-w-md"
      >
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
            bloqueoActual ? 'bg-slate-100' : 'bg-rose-100'
          }`}>
            {bloqueoActual ? (
              <AlertTriangle size={18} className="text-slate-500" />
            ) : (
              <AlertTriangle size={18} className="text-rose-600" />
            )}
          </div>
          <div className="min-w-0">
            {bloqueoActual ? (
              <p className="text-sm text-slate-700">{bloqueoActual}</p>
            ) : (
              <>
                <p className="text-sm text-slate-700">
                  ¿Seguro que quieres eliminar <strong className="break-words">{cuentaAEliminar?.nombre}</strong>?
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  La cuenta se quitará de la lista de custodia. Los movimientos ya registrados <strong>no se eliminan</strong>.
                </p>
              </>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setCuentaAEliminar(null)}
            className="h-11 px-4 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            {bloqueoActual ? 'Entendido' : 'Cancelar'}
          </button>
          {!bloqueoActual && (
            <button
              type="button"
              onClick={() => {
                onEliminarCuenta?.(cuentaAEliminar.id)
                setCuentaAEliminar(null)
              }}
              className="h-11 px-4 rounded-xl bg-rose-600 text-sm font-black text-white hover:bg-rose-500 active:scale-95 transition-all shadow-md inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 size={14} />
              <span>Eliminar cuenta</span>
            </button>
          )}
        </div>
      </Modal>
    </div>
  )
}
