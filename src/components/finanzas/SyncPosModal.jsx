// src/components/finanzas/SyncPosModal.jsx
// Modal de selección de fecha/período y sincronización personalizada del POS con distribución entre cuentas
import { useState, useMemo } from 'react'
import {
  AlertCircle,
  ArrowDownToLine,
  Banknote,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Coins,
  CreditCard,
  DollarSign,
  Globe,
  Loader2,
  Search,
  Smartphone,
  TrendingUp,
} from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import { useEjecutarSyncPos, usePreviewSyncPos } from '../../hooks/useFinanzas.js'
import { useCuentasCustodia } from '../../hooks/useCuentasCustodia.js'
import SyncPosMetodoItem from './SyncPosMetodoItem.jsx'

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100
}

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

const METODOS_CONFIG = [
  { key: 'efectivo_usd', label: 'Efectivo $', icon: DollarSign, moneda: 'USD' },
  { key: 'zelle_usd', label: 'Zelle (USD)', icon: Globe, moneda: 'USD' },
  { key: 'usdt_usd', label: 'USDT (Cripto)', icon: Coins, moneda: 'USDT' },
  { key: 'efectivo_ves', label: 'Efectivo Bs', icon: Banknote, moneda: 'VES' },
  { key: 'transferencia_ves', label: 'Transferencia Bancaria', icon: Building2, moneda: 'VES' },
  { key: 'pago_movil_ves', label: 'Pago Móvil', icon: Smartphone, moneda: 'VES' },
  { key: 'punto_venta_ves', label: 'Punto de Venta', icon: CreditCard, moneda: 'VES' },
]

function sugerirCuentaParaMetodo(metodoDef, cuentas = []) {
  if (!Array.isArray(cuentas) || cuentas.length === 0) return ''
  const moneda = (metodoDef.moneda || 'USD').toUpperCase()
  const cuentasMismaMoneda = cuentas.filter(c => String(c.moneda || '').toUpperCase() === moneda)
  const pool = cuentasMismaMoneda.length > 0 ? cuentasMismaMoneda : cuentas

  const key = metodoDef.key || ''
  if (key === 'efectivo_usd') {
    const found = pool.find(c => c.tipo === 'efectivo_usd' || /efectivo/.test(c.nombre.toLowerCase()))
    if (found) return found.nombre
  }
  if (key === 'zelle_usd') {
    const found = pool.find(c => /zelle/.test(c.nombre.toLowerCase()))
    if (found) return found.nombre
  }
  if (key === 'usdt_usd') {
    const found = pool.find(c => c.tipo === 'cripto_usdt' || /usdt|binance|gaby/.test(c.nombre.toLowerCase()))
    if (found) return found.nombre
  }
  if (key === 'efectivo_ves') {
    const found = pool.find(c => c.tipo === 'efectivo_ves' || /efectivo/.test(c.nombre.toLowerCase()))
    if (found) return found.nombre
  }
  if (key === 'pago_movil_ves' || key === 'transferencia_ves' || key === 'punto_venta_ves') {
    const found = pool.find(c => /venezuela|bdv/.test(c.nombre.toLowerCase())) ||
      pool.find(c => c.tipo === 'banco_ves')
    if (found) return found.nombre
  }
  return pool[0]?.nombre || ''
}

export default function SyncPosModal({ open, onClose }) {
  const [selectedPreset, setSelectedPreset] = useState('hoy')
  const [desde, setDesde] = useState(() => getLocalIsoDate())
  const [hasta, setHasta] = useState(() => getLocalIsoDate())
  const [distribucionOverrides, setDistribucionOverrides] = useState({})

  const { cuentas = [] } = useCuentasCustodia()
  const previewMutation = usePreviewSyncPos()
  const ejecutarMutation = useEjecutarSyncPos()

  const isRangeMode = selectedPreset === 'semana' || selectedPreset === 'mes' || selectedPreset === 'rango_personalizado'

  const handleSelectPreset = (presetId) => {
    setSelectedPreset(presetId)
    const range = getPresetRange(presetId)
    setDesde(range.desde)
    setHasta(range.hasta)
    previewMutation.reset()
    setDistribucionOverrides({})
  }

  const handleSingleDateChange = (val) => {
    setDesde(val)
    setHasta(val)
    previewMutation.reset()
    setDistribucionOverrides({})
  }

  const handleRangeDateChange = (type, val) => {
    setSelectedPreset('rango_personalizado')
    if (type === 'desde') setDesde(val)
    if (type === 'hasta') setHasta(val)
    previewMutation.reset()
    setDistribucionOverrides({})
  }

  const handleConsultar = () => {
    if (desde && hasta) {
      setDistribucionOverrides({})
      previewMutation.mutate({ desde, hasta })
    }
  }

  const data = previewMutation.data?.posData
  const tienePrevio = previewMutation.data?.tienePrevio
  const isLoading = previewMutation.isPending
  const isExecuting = ejecutarMutation.isPending

  // Distribución inteligente combinando datos del POS, cuentas de custodia y personalización del usuario
  const distribucion = useMemo(() => {
    if (!data) return {}
    const dp = data.desglose_pagos || {}
    const res = {}
    for (const m of METODOS_CONFIG) {
      const monto = Number(dp[m.key] || 0)
      if (monto > 0) {
        const override = distribucionOverrides[m.key]
        res[m.key] = {
          activo: override?.activo !== undefined ? override.activo : true,
          cuenta_origen: override?.cuenta_origen !== undefined ? override.cuenta_origen : sugerirCuentaParaMetodo(m, cuentas),
          dividido: Boolean(override?.dividido),
          partes: override?.partes || [],
          excluidos: override?.excluidos || [],
        }
      }
    }
    return res
  }, [data, cuentas, distribucionOverrides])

  const handleUpdateMetodoConfig = (metodoKey, newCfg) => {
    setDistribucionOverrides(prev => ({
      ...prev,
      [metodoKey]: newCfg,
    }))
  }

  // Agrupar despachos por clave de método
  const despachosPorMetodo = useMemo(() => {
    const res = {}
    for (const m of METODOS_CONFIG) {
      res[m.key] = []
    }
    for (const d of (data?.despachos_detalle || [])) {
      if (res[d.metodo_clave]) {
        res[d.metodo_clave].push(d)
      }
    }
    return res
  }, [data])

  // Cálculo en tiempo real del Total Ingresos Empresa a Registrar
  const totalDinamico = useMemo(() => {
    if (!data) return { totalUsd: 0, totalVes: 0, metodosActivos: 0, totalMetodosConVenta: 0, tieneDescuadre: false }
    const tasa = Number(data.tasa_bcv || 1) || 1
    const dp = data.desglose_pagos || {}
    let sumaUsd = 0
    let sumaVes = 0
    let metodosActivos = 0
    let totalMetodosConVenta = 0
    let tieneDescuadre = false

    for (const m of METODOS_CONFIG) {
      const monto = Number(dp[m.key] || 0)
      if (monto <= 0) continue
      totalMetodosConVenta += 1

      const cfg = distribucion[m.key]
      if (!cfg || cfg.activo === false) continue

      metodosActivos += 1

      const despachosMetodo = despachosPorMetodo[m.key] || []
      const excluidos = cfg.excluidos || []
      const campoMonto = m.moneda === 'VES' ? 'monto_ves' : 'monto_usd'
      const sumaExcluidos = despachosMetodo
        .filter(d => excluidos.includes(d.id))
        .reduce((s, d) => s + Number(d[campoMonto] || 0), 0)
      const montoEfectivo = Math.max(0, round2(monto - sumaExcluidos))

      if (cfg.dividido && Array.isArray(cfg.partes) && cfg.partes.length > 0) {
        const sumaPartes = round2(cfg.partes.reduce((s, p) => s + Number(p.monto || 0), 0))
        if (Math.abs(montoEfectivo - sumaPartes) > 0.01) {
          tieneDescuadre = true
        }
      }

      if (m.moneda === 'VES') {
        sumaVes += montoEfectivo
        sumaUsd += (montoEfectivo / tasa)
      } else {
        sumaUsd += montoEfectivo
        sumaVes += (montoEfectivo * tasa)
      }
    }

    return {
      totalUsd: round2(sumaUsd),
      totalVes: round2(sumaVes),
      metodosActivos,
      totalMetodosConVenta,
      tieneDescuadre,
    }
  }, [data, distribucion, despachosPorMetodo])

  const handleConfirmarSync = async () => {
    try {
      await ejecutarMutation.mutateAsync({ desde, hasta, confirm: true, distribucion })
      onClose()
    } catch {
      // Manejado por toast de mutación
    }
  }

  return (
    <Modal
      isOpen={open}
      onClose={isExecuting ? undefined : onClose}
      title="Sincronizar Ventas del POS"
      className="sm:max-w-2xl"
    >
      <div className="space-y-4">
        {/* Paso 1: Selección de Período o Fecha */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 sm:p-4 space-y-3">
          <label className="block text-xs font-bold text-slate-700">
            ¿Qué fecha o período deseas sincronizar?
          </label>

          {/* Presets rápidos */}
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
                  className={`min-h-11 py-2 px-1.5 rounded-xl text-xs font-black transition-all text-center border shadow-xs ${
                    active
                      ? 'bg-primary text-white border-primary shadow-sm ring-2 ring-primary/20'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                  style={{ touchAction: 'manipulation' }}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          {/* Campos de Fecha */}
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
            className="min-h-11 w-full rounded-xl bg-slate-900 text-amber-400 hover:bg-slate-800 text-xs font-black flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95 disabled:opacity-50"
            style={{ touchAction: 'manipulation' }}
          >
            {isLoading ? (
              <>
                <Loader2 size={15} className="animate-spin text-amber-400" />
                Consultando ventas en el POS...
              </>
            ) : (
              <>
                <Search size={15} />
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

        {/* Resumen dinámico y configuración por método */}
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
                  Se crearán los ingresos asignados a sus respectivas Cuentas de Custodia.
                </div>
              </div>
            )}

            {/* Tarjeta de Total Dinámico */}
            <div
              className="rounded-2xl p-4 text-white shadow-md flex items-center justify-between"
              style={{ background: 'linear-gradient(135deg, #1B365D 0%, #0d223f 100%)' }}
            >
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 block">
                  Total Ingresos Empresa a Registrar
                </span>
                <span className="text-2xl font-black tracking-tight">
                  ${formatMoney(totalDinamico.totalUsd)} <span className="text-sm font-bold text-amber-400">USD</span>
                </span>
                <span className="text-[11px] text-slate-300 block mt-0.5">
                  Bs. {formatMoney(totalDinamico.totalVes)} · {totalDinamico.metodosActivos} de {totalDinamico.totalMetodosConVenta} métodos seleccionados
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

            {/* Lista Interactiva de Métodos de Pago */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 px-0.5">
                <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                  Distribución y Asignación por Método
                </span>
                <span className="text-[11px] text-slate-500">
                  Marca qué métodos registrar y su cuenta destino
                </span>
              </div>

              <div className="space-y-2.5">
                {METODOS_CONFIG.map(metodoDef => {
                  const monto = Number(data.desglose_pagos?.[metodoDef.key] || 0)
                  if (monto <= 0) return null

                  return (
                    <SyncPosMetodoItem
                      key={metodoDef.key}
                      metodoKey={metodoDef.key}
                      label={metodoDef.label}
                      icon={metodoDef.icon}
                      montoOriginal={monto}
                      montoOriginalUsd={metodoDef.moneda === 'VES' ? round2(monto / (data.tasa_bcv || 1)) : monto}
                      moneda={metodoDef.moneda}
                      tasaBcv={data.tasa_bcv || 1}
                      despachos={despachosPorMetodo[metodoDef.key] || []}
                      cuentas={cuentas}
                      config={distribucion[metodoDef.key] || {}}
                      onChangeConfig={(newCfg) => handleUpdateMetodoConfig(metodoDef.key, newCfg)}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Advertencia si hay descuadre en división */}
        {totalDinamico.tieneDescuadre && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900 flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-600 shrink-0" />
            <span>Hay diferencias pendientes por asignar en las divisiones entre cuentas bancarias.</span>
          </div>
        )}

        {/* Botones de acción */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isExecuting}
            className="min-h-11 px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            style={{ touchAction: 'manipulation' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmarSync}
            disabled={
              isLoading ||
              isExecuting ||
              !previewMutation.isSuccess ||
              totalDinamico.totalUsd <= 0 ||
              totalDinamico.tieneDescuadre
            }
            className="min-h-11 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-xs font-black text-white hover:bg-primary-hover disabled:opacity-50 active:scale-95 transition-all shadow-md"
            style={{ touchAction: 'manipulation' }}
          >
            {isExecuting ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Registrando en Finanzas...
              </>
            ) : (
              <>
                <ArrowDownToLine size={16} />
                {tienePrevio ? 'Actualizar en Finanzas' : 'Confirmar e Ingresar'}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
