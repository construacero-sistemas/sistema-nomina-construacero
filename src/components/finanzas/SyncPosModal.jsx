// src/components/finanzas/SyncPosModal.jsx
// Modal de selección de fecha/período (Hoy, Ayer, Día Específico, Semana, Mes) y sincronización con el POS
import { useState } from 'react'
import {
  AlertCircle,
  ArrowDownToLine,
  Banknote,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  ShoppingCart,
  Smartphone,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import { useEjecutarSyncPos, usePreviewSyncPos } from '../../hooks/useFinanzas.js'

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function getLocalIsoDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getPresetRange(presetId) {
  const now = new Date()
  const todayStr = getLocalIsoDate(now)

  if (presetId === 'ayer') {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const yesterdayStr = getLocalIsoDate(yesterday)
    return { desde: yesterdayStr, hasta: yesterdayStr, isRange: false }
  }

  if (presetId === 'dia_especifico') {
    return { desde: todayStr, hasta: todayStr, isRange: false }
  }

  if (presetId === 'semana') {
    const day = now.getDay() || 7
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1)
    return { desde: getLocalIsoDate(monday), hasta: todayStr, isRange: true }
  }

  if (presetId === 'mes') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    return { desde: getLocalIsoDate(startOfMonth), hasta: todayStr, isRange: true }
  }

  // default: 'hoy'
  return { desde: todayStr, hasta: todayStr, isRange: false }
}

export default function SyncPosModal({ open, onClose }) {
  const [selectedPreset, setSelectedPreset] = useState('hoy')
  const [desde, setDesde] = useState(() => getLocalIsoDate())
  const [hasta, setHasta] = useState(() => getLocalIsoDate())

  const previewMutation = usePreviewSyncPos()
  const ejecutarMutation = useEjecutarSyncPos()

  const isRangeMode = selectedPreset === 'semana' || selectedPreset === 'mes' || selectedPreset === 'rango_personalizado'

  const handleSelectPreset = (presetId) => {
    setSelectedPreset(presetId)
    const range = getPresetRange(presetId)
    setDesde(range.desde)
    setHasta(range.hasta)
    previewMutation.reset()
  }

  // Para cuando se elige un solo día específico
  const handleSingleDateChange = (val) => {
    setDesde(val)
    setHasta(val)
    previewMutation.reset()
  }

  const handleRangeDateChange = (type, val) => {
    setSelectedPreset('rango_personalizado')
    if (type === 'desde') setDesde(val)
    if (type === 'hasta') setHasta(val)
    previewMutation.reset()
  }

  const handleConsultar = () => {
    if (desde && hasta) {
      previewMutation.mutate({ desde, hasta })
    }
  }

  const handleConfirmarSync = async () => {
    try {
      await ejecutarMutation.mutateAsync({ desde, hasta })
      onClose()
    } catch {
      // Manejado por toast de mutación
    }
  }

  const data = previewMutation.data?.posData
  const tienePrevio = previewMutation.data?.tienePrevio
  const isLoading = previewMutation.isPending
  const isExecuting = ejecutarMutation.isPending

  return (
    <Modal
      isOpen={open}
      onClose={isExecuting ? undefined : onClose}
      title="Sincronizar Ventas del POS"
      className="sm:max-w-lg"
    >
      <div className="space-y-4">
        {/* Paso 1: Selección de Período o Fecha */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 sm:p-4 space-y-3">
          <label className="block text-xs font-bold text-slate-700">
            ¿Qué fecha o período deseas sincronizar?
          </label>

          {/* Botones de presets rápidos: Hoy, Ayer, Día Específico, Semana, Mes */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
            {[
              { id: 'hoy', label: 'Hoy' },
              { id: 'ayer', label: 'Ayer' },
              { id: 'dia_especifico', label: 'Día específico' },
              { id: 'semana', label: 'Semana' },
              { id: 'mes', label: 'Mes' },
            ].map(preset => {
              const active = selectedPreset === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.id)}
                  disabled={isLoading || isExecuting}
                  className={`py-2 px-1.5 rounded-xl text-xs font-black transition-all text-center border shadow-xs ${
                    active
                      ? 'bg-primary text-white border-primary shadow-sm ring-2 ring-primary/20'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          {/* Campo de Fecha Única o Rango según el modo */}
          {!isRangeMode ? (
            <div className="space-y-1 pt-1">
              <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                <Calendar size={13} className="text-primary" />
                Fecha a sincronizar
              </span>
              <DatePicker
                value={desde}
                onChange={handleSingleDateChange}
                disabled={isLoading || isExecuting}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500">Desde</span>
                <DatePicker
                  value={desde}
                  onChange={val => handleRangeDateChange('desde', val)}
                  disabled={isLoading || isExecuting}
                />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-500">Hasta</span>
                <DatePicker
                  value={hasta}
                  onChange={val => handleRangeDateChange('hasta', val)}
                  disabled={isLoading || isExecuting}
                />
              </div>
            </div>
          )}

          {/* Botón de consulta */}
          <button
            type="button"
            onClick={handleConsultar}
            disabled={isLoading || isExecuting || !desde || !hasta}
            className="w-full py-2.5 rounded-xl bg-slate-900 text-amber-400 hover:bg-slate-800 text-xs font-black flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 size={14} className="animate-spin text-amber-400" />
                Consultando ventas en el POS...
              </>
            ) : (
              <>
                <Search size={14} />
                Consultar Ventas del POS
              </>
            )}
          </button>
        </div>

        {/* Estado de error */}
        {previewMutation.isError && !isLoading && (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-xs text-rose-700 space-y-2">
            <div className="flex items-center gap-2 font-black text-rose-800">
              <AlertCircle size={16} className="shrink-0" />
              No se pudo obtener el cierre del POS
            </div>
            <p className="text-rose-600 leading-relaxed">
              {previewMutation.error?.message || 'Verifica que el servidor POS esté activo y en línea.'}
            </p>
          </div>
        )}

        {/* Resumen de ventas obtenido */}
        {previewMutation.isSuccess && !isLoading && data && (
          <div className="space-y-3.5 animate-fadeIn">
            {/* Banner de estado */}
            {tienePrevio ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2.5">
                <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-black">Asientos previos detectados</strong>
                  Ya existen registros en Finanzas para este período. Al sincronizar se actualizarán a los nuevos totales sin duplicar movimientos.
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 flex items-start gap-2.5">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-black">Período listo para importar</strong>
                  Se crearán los ingresos en sus respectivas Carteras (USD y Bolívares).
                </div>
              </div>
            )}

            {/* Tarjeta de Total */}
            <div
              className="rounded-2xl p-4 text-white shadow-md flex items-center justify-between"
              style={{ background: 'linear-gradient(135deg, #1B365D 0%, #0d223f 100%)' }}
            >
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 block">
                  Total Ingresos Empresa (Sin Fletes)
                </span>
                <span className="text-2xl font-black tracking-tight">
                  ${formatMoney(data.total_ingresos_usd)} <span className="text-sm font-bold text-amber-400">USD</span>
                </span>
                <span className="text-[11px] text-slate-300 block mt-0.5">
                  {data.total_despachos || 0} despachos procesados
                </span>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-amber-400">
                <TrendingUp size={24} />
              </div>
            </div>

            {/* Ventas a Crédito (CxC y COD) Informativo */}
            {Number(data.creditos_pendientes_usd || data.creditos_otorgados_usd || 0) > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-2.5 flex items-center justify-between text-xs text-slate-700 shadow-2xs">
                <span className="font-bold flex items-center gap-1.5 text-[11px] text-slate-600">
                  <Clock size={14} className="text-amber-600 shrink-0" />
                  Ventas a Crédito (CxC y COD):
                </span>
                <span className="font-black text-slate-800">
                  ${formatMoney(data.creditos_pendientes_usd || data.creditos_otorgados_usd)} USD{' '}
                  <span className="text-[10px] font-normal text-slate-500">
                    (no están incluidas · dinero aún no entrado)
                  </span>
                </span>
              </div>
            )}

            {/* Desglose por método de pago y carteras */}
            {data.desglose_pagos && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider block">
                  Entradas por Cartera y Método
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {Number(data.desglose_pagos.efectivo_usd) > 0 && (
                    <div className="p-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200 font-bold text-emerald-900 shadow-xs">
                      <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-1 mb-1">
                        <DollarSign size={13} className="shrink-0 text-emerald-600" />
                        Efectivo $
                      </span>
                      <div className="text-sm font-black text-emerald-950">
                        ${formatMoney(data.desglose_pagos.efectivo_usd)}
                      </div>
                    </div>
                  )}
                  {Number(data.desglose_pagos.zelle_usd) > 0 && (
                    <div className="p-2.5 rounded-xl bg-purple-50/90 border border-purple-200 font-bold text-purple-900 shadow-xs">
                      <span className="text-[10px] font-bold text-purple-700 flex items-center gap-1 mb-1">
                        <Globe size={13} className="shrink-0 text-purple-600" />
                        Zelle (USD)
                      </span>
                      <div className="text-sm font-black text-purple-950">
                        ${formatMoney(data.desglose_pagos.zelle_usd)}
                      </div>
                    </div>
                  )}
                  {Number(data.desglose_pagos.usdt_usd) > 0 && (
                    <div className="p-2.5 rounded-xl bg-cyan-50/90 border border-cyan-200 font-bold text-cyan-900 shadow-xs">
                      <span className="text-[10px] font-bold text-cyan-700 flex items-center gap-1 mb-1">
                        <Globe size={13} className="shrink-0 text-cyan-600" />
                        USDT (Cripto)
                      </span>
                      <div className="text-sm font-black text-cyan-950">
                        ${formatMoney(data.desglose_pagos.usdt_usd)}
                      </div>
                    </div>
                  )}
                  {Number(data.desglose_pagos.efectivo_ves) > 0 && (
                    <div className="p-2.5 rounded-xl bg-blue-50/90 border border-blue-200 font-bold text-blue-900 shadow-xs">
                      <span className="text-[10px] font-bold text-blue-700 flex items-center gap-1 mb-1">
                        <Banknote size={13} className="shrink-0 text-blue-600" />
                        Efectivo Bs
                      </span>
                      <div className="text-sm font-black text-blue-950">
                        Bs. {formatMoney(data.desglose_pagos.efectivo_ves)}
                      </div>
                    </div>
                  )}
                  {Number(data.desglose_pagos.transferencia_ves) > 0 && (
                    <div className="p-2.5 rounded-xl bg-blue-50/90 border border-blue-200 font-bold text-blue-900 shadow-xs">
                      <span className="text-[10px] font-bold text-blue-700 flex items-center gap-1 mb-1">
                        <Building2 size={13} className="shrink-0 text-blue-600" />
                        Transferencia
                      </span>
                      <div className="text-sm font-black text-blue-950">
                        Bs. {formatMoney(data.desglose_pagos.transferencia_ves)}
                      </div>
                    </div>
                  )}
                  {Number(data.desglose_pagos.pago_movil_ves) > 0 && (
                    <div className="p-2.5 rounded-xl bg-indigo-50/90 border border-indigo-200 font-bold text-indigo-900 shadow-xs">
                      <span className="text-[10px] font-bold text-indigo-700 flex items-center gap-1 mb-1">
                        <Smartphone size={13} className="shrink-0 text-indigo-600" />
                        Pago Móvil
                      </span>
                      <div className="text-sm font-black text-indigo-950">
                        Bs. {formatMoney(data.desglose_pagos.pago_movil_ves)}
                      </div>
                    </div>
                  )}
                  {Number(data.desglose_pagos.punto_venta_ves) > 0 && (
                    <div className="p-2.5 rounded-xl bg-teal-50/90 border border-teal-200 font-bold text-teal-900 shadow-xs">
                      <span className="text-[10px] font-bold text-teal-700 flex items-center gap-1 mb-1">
                        <CreditCard size={13} className="shrink-0 text-teal-600" />
                        Punto Venta
                      </span>
                      <div className="text-sm font-black text-teal-950">
                        Bs. {formatMoney(data.desglose_pagos.punto_venta_ves)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Botones de acción */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isExecuting}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmarSync}
            disabled={isLoading || isExecuting || !previewMutation.isSuccess || Number(data?.total_ingresos_usd || 0) <= 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-xs font-black text-white hover:bg-primary-hover disabled:opacity-50 active:scale-95 transition-all shadow-md"
            style={{ touchAction: 'manipulation' }}
          >
            {isExecuting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Registrando en Finanzas...
              </>
            ) : (
              <>
                <ArrowDownToLine size={15} />
                {tienePrevio ? 'Actualizar en Finanzas' : 'Confirmar e Ingresar'}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
