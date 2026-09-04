// src/components/finanzas/SyncPosMetodoItem.jsx
// Tarjeta interactiva refinada para asignar cuenta, dividir entre bancos o activar/desactivar un método de pago del POS
import { useState, useMemo } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  ListFilter,
} from 'lucide-react'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import SyncPosDespachosList from './SyncPosDespachosList.jsx'

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100
}

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatTipoCuenta(tipo) {
  switch (tipo) {
    case 'efectivo_usd': return 'Caja física $'
    case 'efectivo_ves': return 'Caja física Bs'
    case 'banco_ves': return 'Banco nacional'
    case 'cripto_usdt': return 'Billetera cripto'
    case 'zelle': return 'Cuenta Zelle'
    default: return 'Cuenta de custodia'
  }
}

const METODO_THEMES = {
  efectivo_usd: {
    iconBg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    borderActive: 'border-emerald-200/80 hover:border-emerald-300',
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200/60',
  },
  zelle_usd: {
    iconBg: 'bg-purple-50 text-purple-700 border-purple-200/80',
    borderActive: 'border-purple-200/80 hover:border-purple-300',
    badge: 'bg-purple-50 text-purple-800 border-purple-200/60',
  },
  usdt_usd: {
    iconBg: 'bg-amber-50 text-amber-700 border-amber-200/80',
    borderActive: 'border-amber-200/80 hover:border-amber-300',
    badge: 'bg-amber-50 text-amber-800 border-amber-200/60',
  },
  efectivo_ves: {
    iconBg: 'bg-blue-50 text-blue-700 border-blue-200/80',
    borderActive: 'border-blue-200/80 hover:border-blue-300',
    badge: 'bg-blue-50 text-blue-800 border-blue-200/60',
  },
  transferencia_ves: {
    iconBg: 'bg-sky-50 text-sky-700 border-sky-200/80',
    borderActive: 'border-sky-200/80 hover:border-sky-300',
    badge: 'bg-sky-50 text-sky-800 border-sky-200/60',
  },
  pago_movil_ves: {
    iconBg: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
    borderActive: 'border-indigo-200/80 hover:border-indigo-300',
    badge: 'bg-indigo-50 text-indigo-800 border-indigo-200/60',
  },
  punto_venta_ves: {
    iconBg: 'bg-teal-50 text-teal-700 border-teal-200/80',
    borderActive: 'border-teal-200/80 hover:border-teal-300',
    badge: 'bg-teal-50 text-teal-800 border-teal-200/60',
  },
}

const DEFAULT_THEME = {
  iconBg: 'bg-slate-50 text-slate-700 border-slate-200',
  borderActive: 'border-slate-200 hover:border-slate-300',
  badge: 'bg-slate-100 text-slate-700 border-slate-200',
}

export default function SyncPosMetodoItem({
  metodoKey,
  label,
  icon: IconComponent,
  montoOriginal = 0,
  montoOriginalUsd = 0,
  moneda = 'USD',
  tasaBcv = 1,
  despachos = [],
  cuentas = [],
  config = {},
  onChangeConfig,
}) {
  const [mostrarDetalle, setMostrarDetalle] = useState(false)

  const activo = config.activo !== false
  const dividido = Boolean(config.dividido)
  const partes = config.partes || []
  const excluidos = config.excluidos || []

  const theme = METODO_THEMES[metodoKey] || DEFAULT_THEME

  // Calcular el monto descontando despachos excluidos
  const montoEfectivo = useMemo(() => {
    if (despachos.length === 0 || excluidos.length === 0) {
      return round2(montoOriginal)
    }
    const campoMonto = moneda === 'VES' ? 'monto_ves' : 'monto_usd'
    const sumaExcluidos = despachos
      .filter(d => excluidos.includes(d.id))
      .reduce((s, d) => s + Number(d[campoMonto] || 0), 0)
    return Math.max(0, round2(montoOriginal - sumaExcluidos))
  }, [despachos, excluidos, montoOriginal, moneda])

  const montoEfectivoUsd = useMemo(() => {
    if (moneda !== 'VES') return montoEfectivo
    return round2(montoEfectivo / (Number(tasaBcv) || 1))
  }, [montoEfectivo, moneda, tasaBcv])

  // Filtrar cuentas por moneda del método
  const cuentasFiltradas = useMemo(() => {
    const normMoneda = moneda.toUpperCase()
    const match = cuentas.filter(c => String(c.moneda || '').toUpperCase() === normMoneda)
    return match.length > 0 ? match : cuentas
  }, [cuentas, moneda])

  const opcionesCuentas = useMemo(() => {
    return cuentasFiltradas.map(c => ({
      value: c.nombre,
      label: c.nombre,
      sub: `${formatTipoCuenta(c.tipo)} · ${c.moneda || moneda}`,
    }))
  }, [cuentasFiltradas, moneda])

  // Manejadores de configuración
  const handleToggleActivo = () => {
    onChangeConfig({
      ...config,
      activo: !activo,
    })
  }

  const handleSelectCuentaUnica = (nombreCuenta) => {
    onChangeConfig({
      ...config,
      cuenta_origen: nombreCuenta,
    })
  }

  const handleActivarDivision = () => {
    const mitad = round2(montoEfectivo / 2)
    const resto = round2(montoEfectivo - mitad)
    const c1 = config.cuenta_origen || (opcionesCuentas[0]?.value || '')
    const c2 = opcionesCuentas.length > 1 ? opcionesCuentas[1]?.value : c1

    onChangeConfig({
      ...config,
      dividido: true,
      partes: [
        { cuenta_origen: c1, monto: mitad },
        { cuenta_origen: c2, monto: resto },
      ],
    })
  }

  const handleDesactivarDivision = () => {
    const primeraCuenta = partes[0]?.cuenta_origen || config.cuenta_origen || opcionesCuentas[0]?.value || ''
    onChangeConfig({
      ...config,
      dividido: false,
      partes: [],
      cuenta_origen: primeraCuenta,
    })
  }

  const handleUpdateParte = (index, campo, valor) => {
    const nuevasPartes = [...partes]
    nuevasPartes[index] = {
      ...nuevasPartes[index],
      [campo]: campo === 'monto' ? (Number(valor) >= 0 ? Number(valor) : 0) : valor,
    }
    onChangeConfig({
      ...config,
      partes: nuevasPartes,
    })
  }

  const handleAddParte = () => {
    const sumaActual = partes.reduce((s, p) => s + Number(p.monto || 0), 0)
    const faltante = Math.max(0, round2(montoEfectivo - sumaActual))
    const cuentaSugerida = opcionesCuentas.find(opt => !partes.some(p => p.cuenta_origen === opt.value))?.value || opcionesCuentas[0]?.value || ''

    onChangeConfig({
      ...config,
      partes: [
        ...partes,
        { cuenta_origen: cuentaSugerida, monto: faltante },
      ],
    })
  }

  const handleRemoveParte = (index) => {
    if (partes.length <= 1) {
      handleDesactivarDivision()
      return
    }
    const nuevasPartes = partes.filter((_, i) => i !== index)
    onChangeConfig({
      ...config,
      partes: nuevasPartes,
    })
  }

  const handleToggleDespacho = (despachoId) => {
    const yaExcluido = excluidos.includes(despachoId)
    const nuevosExcluidos = yaExcluido
      ? excluidos.filter(id => id !== despachoId)
      : [...excluidos, despachoId]

    onChangeConfig({
      ...config,
      excluidos: nuevosExcluidos,
    })
  }

  const handleToggleTodosDespachos = () => {
    const todosExcluidos = despachos.length > 0 && despachos.every(d => excluidos.includes(d.id))
    onChangeConfig({
      ...config,
      excluidos: todosExcluidos ? [] : despachos.map(d => d.id),
    })
  }

  // Validación de balance en modo dividido
  const sumaPartes = useMemo(() => {
    return round2(partes.reduce((s, p) => s + Number(p.monto || 0), 0))
  }, [partes])

  const restante = round2(montoEfectivo - sumaPartes)
  const cuadreExacto = Math.abs(restante) < 0.01

  return (
    <div
      className={`rounded-2xl border transition-all ${
        activo
          ? `bg-white border-slate-200/90 shadow-xs hover:shadow-sm ${theme.borderActive}`
          : 'bg-slate-50/60 border-slate-200/60 opacity-60'
      }`}
    >
      <div className="p-3.5 sm:p-4 space-y-3">
        {/* Cabecera del Método de Pago */}
        <div className="flex items-center justify-between gap-3">
          {/* Checkbox + Icono + Nombre + Despachos */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleToggleActivo}
              aria-label={activo ? `Desmarcar ${label}` : `Marcar ${label}`}
              className="min-h-11 min-w-11 -m-2 flex items-center justify-center text-slate-700 hover:text-primary transition-transform active:scale-90"
              style={{ touchAction: 'manipulation' }}
            >
              <div
                className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all ${
                  activo
                    ? 'bg-primary border-primary text-white shadow-xs'
                    : 'bg-white border-slate-300 text-transparent hover:border-slate-400'
                }`}
              >
                <Check size={13} className="stroke-[3]" />
              </div>
            </button>

            <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 shadow-2xs ${theme.iconBg}`}>
              <IconComponent size={19} />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-black text-slate-900 tracking-tight">
                  {label}
                </span>
                {despachos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMostrarDetalle(prev => !prev)}
                    className={`min-h-11 -my-2.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl text-xs font-bold transition-all ${
                      mostrarDetalle
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 border border-slate-200/60'
                    }`}
                    style={{ touchAction: 'manipulation' }}
                  >
                    <span>{despachos.length} {despachos.length === 1 ? 'despacho' : 'despachos'}</span>
                    {mostrarDetalle ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                )}
              </div>
              {excluidos.length > 0 && (
                <span className="text-[10px] font-bold text-amber-600 block mt-0.5">
                  {excluidos.length} {excluidos.length === 1 ? 'despacho excluido' : 'despachos excluidos'}
                </span>
              )}
            </div>
          </div>

          {/* Importe grande */}
          <div className="text-right shrink-0">
            <div className="flex items-baseline justify-end gap-1">
              <span className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                {moneda === 'VES' ? `Bs. ${formatMoney(montoEfectivo)}` : `$${formatMoney(montoEfectivo)}`}
              </span>
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 uppercase">
                {moneda}
              </span>
            </div>
            {moneda === 'VES' && (
              <div className="text-[11px] font-semibold text-slate-500">
                ~${formatMoney(montoEfectivoUsd)} USD
              </div>
            )}
          </div>
        </div>

        {/* Configuración de Cuentas de Custodia (solo si está activo) */}
        {activo && (
          <div className="space-y-2.5 pt-2.5 border-t border-slate-100">
            {!dividido ? (
              /* Modo Cuenta Única */
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                    Cuenta de destino
                  </span>
                  <button
                    type="button"
                    onClick={handleActivarDivision}
                    className="min-h-11 inline-flex items-center gap-1.5 text-xs font-black text-primary hover:text-primary-hover px-3 py-1 rounded-xl bg-primary/5 hover:bg-primary/10 border border-primary/20 transition-all active:scale-95"
                    style={{ touchAction: 'manipulation' }}
                  >
                    <Plus size={13} className="stroke-[3]" />
                    <span>Dividir entre cuentas</span>
                  </button>
                </div>

                <CustomSelect
                  options={opcionesCuentas}
                  value={config.cuenta_origen || ''}
                  onChange={handleSelectCuentaUnica}
                  placeholder={`Seleccionar cuenta de destino (${moneda})...`}
                  searchable={opcionesCuentas.length > 4}
                />
              </div>
            ) : (
              /* Modo Multi-cuenta (Dividido) */
              <div className="rounded-2xl bg-slate-50/80 p-3 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <ListFilter size={14} className="text-primary" />
                    Distribución entre Cuentas Bancarias
                  </span>
                  <button
                    type="button"
                    onClick={handleDesactivarDivision}
                    className="min-h-11 inline-flex items-center text-xs font-bold text-slate-500 hover:text-slate-800 px-2.5 py-1 rounded-xl hover:bg-slate-200/60 transition-colors"
                    style={{ touchAction: 'manipulation' }}
                  >
                    Volver a cuenta única
                  </button>
                </div>

                {/* Filas de distribución */}
                <div className="space-y-2">
                  {partes.map((parte, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs"
                    >
                      <div className="sm:col-span-6">
                        <CustomSelect
                          options={opcionesCuentas}
                          value={parte.cuenta_origen || ''}
                          onChange={val => handleUpdateParte(idx, 'cuenta_origen', val)}
                          placeholder="Cuenta..."
                        />
                      </div>
                      <div className="sm:col-span-5 flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-500 shrink-0">
                          {moneda === 'VES' ? 'Bs.' : '$'}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={parte.monto === 0 ? '' : parte.monto}
                          onChange={e => handleUpdateParte(idx, 'monto', e.target.value)}
                          placeholder="0.00"
                          className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2 text-[16px] sm:text-sm font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleRemoveParte(idx)}
                          aria-label={`Quitar parte ${idx + 1}`}
                          className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          style={{ touchAction: 'manipulation' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Botón agregar parte */}
                <button
                  type="button"
                  onClick={handleAddParte}
                  className="min-h-11 w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border border-dashed border-slate-300 bg-white text-xs font-black text-primary hover:bg-primary/5 active:scale-95 transition-all shadow-2xs"
                  style={{ touchAction: 'manipulation' }}
                >
                  <Plus size={14} className="stroke-[3]" />
                  <span>Agregar otra cuenta bancaria</span>
                </button>

                {/* Barra de validación de balance */}
                <div
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs transition-all ${
                    cuadreExacto
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    {cuadreExacto ? (
                      <>
                        <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                        <span>Distribución exacta cuadra al 100%</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={15} className="text-amber-600 shrink-0" />
                        <span>
                          {restante > 0
                            ? `Falta por asignar: ${moneda === 'VES' ? 'Bs.' : '$'} ${formatMoney(restante)}`
                            : `Excedente asignado: ${moneda === 'VES' ? 'Bs.' : '$'} ${formatMoney(Math.abs(restante))}`}
                        </span>
                      </>
                    )}
                  </div>
                  <span className="font-black">
                    Asignado: {moneda === 'VES' ? 'Bs.' : '$'} {formatMoney(sumaPartes)}
                  </span>
                </div>
              </div>
            )}

            {/* Expansión de Despachos */}
            {despachos.length > 0 && !mostrarDetalle && (
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => setMostrarDetalle(true)}
                  className="min-h-11 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50/80 hover:bg-slate-100 text-[11px] font-bold text-slate-600 hover:text-slate-900 border border-slate-200/60 transition-all active:scale-98"
                  style={{ touchAction: 'manipulation' }}
                >
                  <ListFilter size={13} className="text-slate-400" />
                  <span>Ver detalle ({despachos.length} despachos)</span>
                  <ChevronDown size={14} className="text-slate-400" />
                </button>
              </div>
            )}

            {despachos.length > 0 && mostrarDetalle && (
              <div className="space-y-2 pt-1 animate-fadeIn">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <ListFilter size={12} className="text-primary" />
                    Despachos incluidos
                  </span>
                  <button
                    type="button"
                    onClick={() => setMostrarDetalle(false)}
                    className="min-h-11 inline-flex items-center gap-1 px-2 text-xs font-bold text-slate-500 hover:text-slate-700"
                    style={{ touchAction: 'manipulation' }}
                  >
                    <span>Ocultar</span>
                    <ChevronUp size={13} />
                  </button>
                </div>
                <SyncPosDespachosList
                  despachos={despachos}
                  excluidos={excluidos}
                  onToggleDespacho={handleToggleDespacho}
                  onToggleTodos={handleToggleTodosDespachos}
                  moneda={moneda}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
