// src/components/finanzas/SyncPosMetodoItem.jsx
// Tarjeta interactiva para asignar cuenta, dividir entre bancos o activar/desactivar un método de pago del POS
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

export default function SyncPosMetodoItem({
  metodoKey,
  label,
  icon: IconComponent,
  colorScheme = 'blue',
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
      sub: `${c.tipo || 'cuenta'} · ${c.moneda || moneda}`,
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
    // Inicializar con 2 partes dividiendo el monto
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
          ? 'bg-white border-slate-200 shadow-sm'
          : 'bg-slate-50/70 border-slate-200/80 opacity-60'
      }`}
    >
      {/* Cabecera del Método de Pago */}
      <div className="p-3.5 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Checkbox y Nombre */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={handleToggleActivo}
              aria-label={activo ? `Desmarcar ${label}` : `Marcar ${label}`}
              className="min-h-11 min-w-11 -m-2 flex items-center justify-center text-slate-700 hover:text-primary transition-colors"
              style={{ touchAction: 'manipulation' }}
            >
              <div
                className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                  activo
                    ? 'bg-primary border-primary text-white'
                    : 'bg-white border-slate-300 text-transparent'
                }`}
              >
                <Check size={14} className="stroke-[3]" />
              </div>
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
                <IconComponent size={16} />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-black text-slate-900 block truncate">
                  {label}
                </span>
                <span className="text-[10px] text-slate-500 block">
                  {despachos.length} {despachos.length === 1 ? 'despacho' : 'despachos'}
                  {excluidos.length > 0 && ` (${excluidos.length} excluidos)`}
                </span>
              </div>
            </div>
          </div>

          {/* Importe */}
          <div className="text-right shrink-0">
            <div className="text-sm font-black text-slate-900">
              {moneda === 'VES'
                ? `Bs. ${formatMoney(montoEfectivo)}`
                : `$${formatMoney(montoEfectivo)} USD`}
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
          <div className="space-y-2.5 pt-1 border-t border-slate-100">
            {!dividido ? (
              /* Modo Cuenta Única */
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-600">
                    Cuenta de destino:
                  </span>
                  <button
                    type="button"
                    onClick={handleActivarDivision}
                    className="min-h-11 inline-flex items-center gap-1 text-[11px] font-black text-primary hover:text-primary-hover px-2 py-1 rounded-lg hover:bg-primary/5 transition-colors"
                    style={{ touchAction: 'manipulation' }}
                  >
                    <Plus size={13} />
                    <span>Dividir entre cuentas</span>
                  </button>
                </div>

                <CustomSelect
                  options={opcionesCuentas}
                  value={config.cuenta_origen || ''}
                  onChange={handleSelectCuentaUnica}
                  placeholder={`Seleccionar cuenta (${moneda})...`}
                  searchable={opcionesCuentas.length > 4}
                />
              </div>
            ) : (
              /* Modo Multi-cuenta (Dividido) */
              <div className="rounded-xl bg-slate-50 p-3 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <ListFilter size={14} className="text-primary" />
                    Distribución entre Cuentas Bancarias
                  </span>
                  <button
                    type="button"
                    onClick={handleDesactivarDivision}
                    className="min-h-11 inline-flex items-center text-[11px] font-bold text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-200/60 transition-colors"
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
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-white p-2 rounded-xl border border-slate-200 shadow-2xs"
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
                  className="min-h-11 w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-dashed border-slate-300 bg-white text-xs font-bold text-primary hover:bg-primary/5 active:scale-95 transition-all"
                  style={{ touchAction: 'manipulation' }}
                >
                  <Plus size={14} />
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

            {/* Botón Ver Despachos Detallados */}
            {despachos.length > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setMostrarDetalle(prev => !prev)}
                  className="min-h-11 w-full inline-flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-xs font-bold text-slate-700 hover:bg-slate-100/70 active:scale-98 transition-all"
                  style={{ touchAction: 'manipulation' }}
                >
                  <span className="flex items-center gap-1.5">
                    <ListFilter size={13} className="text-slate-500" />
                    <span>Ver detalle ({despachos.length} despachos)</span>
                  </span>
                  {mostrarDetalle ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {mostrarDetalle && (
                  <div className="mt-2 animate-fadeIn">
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
        )}
      </div>
    </div>
  )
}
