// src/components/finanzas/MovimientoForm.jsx
// Formulario moderno, intuitivo y simplificado para registro de movimientos financieros
import { useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  DollarSign,
  FolderPlus,
  Loader2,
} from 'lucide-react'
import { useCrearCategoria, useCrearMovimiento } from '../../hooks/useFinanzas.js'
import { BANCOS_VENEZUELA } from '../../hooks/useCuentasCustodia.js'
import MovimientoResumen from './MovimientoResumen.jsx'
import MovimientoPartes from './MovimientoPartes.jsx'
import MovimientoConversion from './MovimientoConversion.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import useTasaCambioNomina from '../../hooks/useTasaCambioNomina.js'
import { FORMAS_PAGO_OPCIONES } from '../../constants/formasPago.js'

const inputClass = 'w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all'

function today() {
  const date = new Date()
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Flag temporal para ocultar el editor de "pago en varias partes" (por ahora).
// Mientras esté en false no se renderiza; al volver a true se rehabilita.
const MOSTRAR_PARTES = false

export default function MovimientoForm({ categorias = [], cuentas = [], onClose }) {
  const crear = useCrearMovimiento()
  const crearCategoria = useCrearCategoria()
  const { usd, eur, usdt } = useTasaCambioNomina()

  const [tipo, setTipo] = useState('egreso')
  const [fecha, setFecha] = useState(today)
  const [metodoPago, setMetodoPago] = useState('Efectivo $')
  const [cuentaOrigen, setCuentaOrigen] = useState('')
  const [categoria, setCategoria] = useState('')
  const [concepto, setConcepto] = useState('')
  const [monto, setMonto] = useState('')
  const [partes, setPartes] = useState([])

  // Selector y ajuste de tasa integrado (oculto por defecto)
  const [mostrarOpcionesTasa, setMostrarOpcionesTasa] = useState(false)
  const [modoTasa, setModoTasa] = useState('bcv')
  const [tasaManual, setTasaManual] = useState('')
  const [observacionTasa, setObservacionTasa] = useState('')

  const [referencia, setReferencia] = useState('')
  const [observaciones, setObservaciones] = useState('')
  // Nota opcional colapsada para simplificar la zona de detalles.
  const [mostrarNota, setMostrarNota] = useState(false)

  // Creación de categorías personalizadas (inline, sin salir del formulario)
  const [creandoCategoria, setCreandoCategoria] = useState(false)
  const [nuevaCategoria, setNuevaCategoria] = useState('')
  // Categorías creadas en esta sesión para que el label se resuelva al instante.
  const [categoriasExtra, setCategoriasExtra] = useState([])

  const [error, setError] = useState('')

  const crearCategoriaPending = crearCategoria.isPending

  const disabled = crear.isPending

  // Derivar la moneda y cartera directamente del método/cuenta seleccionado
  const opcionSeleccionada = useMemo(() => {
    return FORMAS_PAGO_OPCIONES.find(op => op.value === metodoPago) || FORMAS_PAGO_OPCIONES[0]
  }, [metodoPago])

  const moneda = opcionSeleccionada.moneda || 'USD'
  const esVes = moneda === 'VES'

  // Métodos que requieren indicar una cuenta/banco de origen concreto (ej. Banesco)
  const METODOS_CON_CUENTA = ['Banco en Bolívares', 'Transferencia', 'Pago Móvil', 'Punto de Venta']
  const esMetodoBanco = METODOS_CON_CUENTA.includes(metodoPago)

  // Métodos visibles según el tipo: el POS es terminal de cobro, no aplica como egreso.
  const opcionesMetodo = useMemo(
    () => FORMAS_PAGO_OPCIONES.filter(op => !op.soloIngreso || tipo === 'ingreso'),
    [tipo],
  )

  // Opciones de cuenta/banco de origen según el método.
  // Si hay cuentas de custodia registradas, se muestran SOLO esas con su saldo actual;
  // si no (p.ej. falta el hook), se cae en la lista estática de bancos.
  const opcionesCuenta = useMemo(() => {
    if (!esMetodoBanco) return []
    if (Array.isArray(cuentas) && cuentas.length > 0) {
      return cuentas
        .filter(c => c.subcuentaId === 'Banco en Bolívares')
        .map(c => ({
          value: c.id,
          label: c.nombre || c.banco || 'Cuenta sin nombre',
          sub: `${c.moneda === 'VES' ? 'Bs.' : '$'} ${formatNumber(c.saldo)}`,
          saldo: c.saldo,
        }))
    }
    return BANCOS_VENEZUELA.map(b => ({ value: b, label: b }))
  }, [esMetodoBanco, cuentas])

  // Nombre legible de la cuenta seleccionada (para el resumen y el payload)
  const cuentaOrigenNombre = opcionesCuenta.find(o => o.value === cuentaOrigen)?.label || ''

  function handleCambiarMetodo(nuevoMetodo) {
    setMetodoPago(nuevoMetodo)
    if (nuevoMetodo === 'USDT') {
      setModoTasa('usdt')
    } else if (modoTasa === 'usdt') {
      setModoTasa('bcv')
    }
    // Default inteligente: si el método no usa referencia, la limpiamos.
    const nuevaOpcion = FORMAS_PAGO_OPCIONES.find(op => op.value === nuevoMetodo)
    if (nuevaOpcion && !nuevaOpcion.requiereReferencia) setReferencia('')
    // Si el nuevo método no es bancario, la cuenta de origen deja de tener sentido.
    if (!METODOS_CON_CUENTA.includes(nuevoMetodo)) setCuentaOrigen('')
  }

  // Default inteligente al cambiar Ingreso/Egreso: si la categoría elegida ya no
  // es compatible con el nuevo tipo, se limpia para evitar datos inconsistentes.
  // También: si el método actual no aplica al nuevo tipo (ej. POS en egreso), se restablece.
  function seleccionarTipo(nuevo) {
    setTipo(nuevo)
    const compatible = categorias.some(c => (c.tipo === 'ambos' || c.tipo === nuevo) && c.nombre === categoria)
    if (!compatible) setCategoria('')
    if (metodoPago === 'Punto de Venta' && nuevo === 'egreso') {
      handleCambiarMetodo('Banco en Bolívares')
    }
  }

  function handleCambiarCategoria(value) {
    if (value === '__crear__') {
      setCreandoCategoria(true)
      return
    }
    setCategoria(value)
  }

  async function guardarNuevaCategoria() {
    const nombre = nuevaCategoria.trim()
    if (nombre.length < 2) {
      setError('Escribe el nombre de la nueva categoría.')
      return
    }
    try {
      const res = await crearCategoria.mutateAsync({ nombre, tipo })
      const nombreFinal = res?.categoria?.nombre || nombre
      setCategoria(nombreFinal)
      setCategoriasExtra(prev => prev.some(c => c.nombre === nombreFinal) ? prev : [...prev, { nombre: nombreFinal, tipo }])
      setCreandoCategoria(false)
      setNuevaCategoria('')
      setError('')
    } catch (catError) {
      setError(catError.message || 'No se pudo crear la categoría.')
    }
  }

  // Filtrar categorías compatibles según el tipo (ingreso/egreso)
  const categoriasCompatibles = useMemo(() => {
    return categorias.filter(item => item.tipo === 'ambos' || item.tipo === tipo)
  }, [categorias, tipo])

  // Opciones de la lista de categorías, incluyendo las creadas en esta sesión
  // y la entrada para crear una nueva.
  const opcionesCategoria = useMemo(() => {
    const base = categoriasCompatibles.map(item => ({ value: item.nombre, label: item.nombre }))
    const extras = categoriasExtra
      .filter(c => c.tipo === 'ambos' || c.tipo === tipo)
      .map(item => ({ value: item.nombre, label: item.nombre }))
    return [...base, ...extras, { value: '__crear__', label: '+ Crear nueva categoría' }]
  }, [categoriasCompatibles, categoriasExtra, tipo])

  // Tasa efectiva aplicada según el modo seleccionado
  const tasaEfectiva = useMemo(() => {
    if (modoTasa === 'manual') {
      const m = Number(tasaManual)
      return m > 0 ? m : (usd > 0 ? usd : 1)
    }
    if (modoTasa === 'usdt') return usdt > 0 ? usdt : (usd > 0 ? usd : 1)
    if (modoTasa === 'eur') return eur > 0 ? eur : (usd > 0 ? usd : 1)
    return usd > 0 ? usd : 1
  }, [modoTasa, tasaManual, usd, usdt, eur])

  const montoNum = Number(monto) || 0

  // Cálculo de equivalencias en tiempo real
  const equivalenteVes = useMemo(() => {
    if (montoNum <= 0) return null
    if (esVes) return montoNum
    return montoNum * tasaEfectiva
  }, [montoNum, esVes, tasaEfectiva])

  const equivalenteUsd = useMemo(() => {
    if (montoNum <= 0 || tasaEfectiva <= 0) return null
    if (moneda === 'USD' || moneda === 'USDT') return montoNum
    return montoNum / tasaEfectiva
  }, [montoNum, moneda, tasaEfectiva])

  function validate() {
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Selecciona una fecha válida.'
    if (!categoria) return 'Selecciona una categoría.'
    // El motivo es la trazabilidad del movimiento: sin él no se puede saber
    // al final de mes de dónde vienen los ingresos y los egresos.
    if (concepto.trim().length < 3) return 'Escribe el motivo del movimiento (mínimo 3 caracteres).'
    if (!(montoNum > 0)) return 'El monto debe ser mayor que cero.'
    if (!(tasaEfectiva > 0)) return 'No se pudo determinar la tasa de cambio.'
    if (modoTasa === 'manual' && !(Number(tasaManual) > 0)) {
      return 'Ingresa un valor válido para la tasa manual.'
    }
    if (esMetodoBanco && !cuentaOrigen.trim()) return 'Selecciona la cuenta o banco de origen.'
    if (partes.length > 0) {
      const sumaPartes = partes.reduce((acc, p) => acc + (Number(p.monto) || 0), 0)
      if (Math.abs(sumaPartes - montoNum) > 0.01) {
        return 'La suma de las partes debe igualar el monto total.'
      }
    }
    return ''
  }

  async function submit(event) {
    event.preventDefault()
    const validationError = validate()
    setError(validationError)
    if (validationError) return

    const refFinal = referencia.trim()
      ? `${metodoPago} · ${referencia.trim()}`
      : metodoPago

    const fuenteTasaFinal = modoTasa === 'manual'
      ? 'MANUAL'
      : (modoTasa === 'usdt' ? 'USDT' : (modoTasa === 'eur' ? 'EURO' : 'BCV'))

    try {
      await crear.mutateAsync({
        fecha,
        tipo,
        categoria: categoria.trim(),
        concepto: concepto.trim(),
        monto: montoNum,
        moneda,
        tasaVes: esVes ? 1 : tasaEfectiva,
        tasaUsdVes: tasaEfectiva,
        fuenteTasa: esVes ? 'BCV' : fuenteTasaFinal,
        observacionTasa: modoTasa === 'manual'
          ? (observacionTasa.trim() || `Tasa manual fijada en ${tasaEfectiva.toFixed(2)} Bs/$`)
          : `Tasa ${fuenteTasaFinal} registrada (${tasaEfectiva.toFixed(2)} Bs/$)`,
        referencia: refFinal,
        observaciones: observaciones.trim() || null,
        metodoPago,
        cuentaOrigen: esMetodoBanco ? (cuentaOrigenNombre || null) : null,
        partes: partes.length > 0 ? partes.map(p => ({
          monto: Number(p.monto),
          moneda,
          referencia: p.referencia?.trim() || null,
          metodoPago,
          cuentaOrigen: esMetodoBanco ? (cuentaOrigenNombre || null) : null,
        })) : null,
      })
      onClose()
    } catch (submitError) {
      setError(submitError.message || 'No se pudo registrar el movimiento.')
    }
  }

  return (
    <Modal
      isOpen
      onClose={() => { if (!disabled) onClose() }}
      title="Nuevo movimiento financiero"
      className="sm:max-w-xl"
    >
      <form onSubmit={submit} className="space-y-4" aria-busy={disabled}>
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700" role="alert">
            {error}
          </div>
        )}

        {/* 1. Selector de Tipo (Ingreso / Egreso) */}
        <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-100/90 rounded-2xl">
          <button type="button" onClick={() => seleccionarTipo('ingreso')} disabled={disabled}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-12 rounded-xl text-xs font-black transition-all cursor-pointer px-1 ${tipo === 'ingreso' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-600 hover:text-slate-900'}`}>
            <span className="flex items-center gap-1.5 whitespace-nowrap"><ArrowDownRight size={16} className="shrink-0" />Ingreso</span>
            <span className={`text-[10px] font-semibold leading-tight ${tipo === 'ingreso' ? 'text-emerald-100' : 'text-slate-400'}`}>Entrada</span>
          </button>

          <button type="button" onClick={() => seleccionarTipo('egreso')} disabled={disabled}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-12 rounded-xl text-xs font-black transition-all cursor-pointer px-1 ${tipo === 'egreso' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-600 hover:text-slate-900'}`}>
            <span className="flex items-center gap-1.5 whitespace-nowrap"><ArrowUpRight size={16} className="shrink-0" />Egreso</span>
            <span className={`text-[10px] font-semibold leading-tight ${tipo === 'egreso' ? 'text-rose-100' : 'text-slate-400'}`}>Salida / Gasto</span>
          </button>
        </div>

        {/* 2. Bloque Principal: Monto + Cuenta + Conversión y Tasa (Ocultable por defecto) */}
        <div className={`p-4 rounded-2xl border transition-all ${
          esVes ? 'bg-blue-50/40 border-blue-200/80' : 'bg-emerald-50/40 border-emerald-200/80'
        } space-y-3`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            {/* Monto Hero */}
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">
                Monto *
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={monto}
                  onChange={e => setMonto(e.target.value)}
                  className="w-full h-11 pl-3.5 pr-14 rounded-xl border border-slate-200 bg-white text-lg font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
                  placeholder="0.00"
                  disabled={disabled}
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                  {moneda}
                </span>
              </div>
            </div>

            {/* Cuenta / Método */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-700">
                  Cuenta / Medio de pago *
                </label>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                  esVes ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {esVes ? 'Cartera Bs' : 'Cartera USD'}
                </span>
              </div>
              <CustomSelect
                value={metodoPago}
                onChange={handleCambiarMetodo}
                options={opcionesMetodo}
                disabled={disabled}
                showSubInTrigger={false}
              />
            </div>
          </div>

          {/* Fila de Conversión y Tasa (Ocultable por defecto) */}
          <MovimientoConversion
            esVes={esVes}
            equivalenteUsd={equivalenteUsd}
            equivalenteVes={equivalenteVes}
            tasaEfectiva={tasaEfectiva}
            modoTasa={modoTasa}
            usarBcv={() => setModoTasa('bcv')}
            usarUsdt={() => setModoTasa('usdt')}
            usarManual={() => setModoTasa('manual')}
            mostrarOpcionesTasa={mostrarOpcionesTasa}
            abrirSelector={() => setMostrarOpcionesTasa(true)}
            cerrarSelector={() => setMostrarOpcionesTasa(false)}
            tasaManual={tasaManual}
            setTasaManual={setTasaManual}
            observacionTasa={observacionTasa}
            setObservacionTasa={setObservacionTasa}
            usd={usd}
            usdt={usdt}
            disabled={disabled}
          />
        </div>

        {/* 2b. Cuenta de origen (dependiente del método de pago) */}
        {esMetodoBanco && (
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-700">
              Cuenta / Banco de origen *
            </label>
            <CustomSelect
              value={cuentaOrigen}
              onChange={setCuentaOrigen}
              options={opcionesCuenta}
              placeholder="¿Desde qué cuenta?"
              disabled={disabled}
              showSubInTrigger={false}
            />
          </div>
        )}

        {/* 2c. Pago en varias partes (cuántos egresos) — oculto por ahora */}
        {MOSTRAR_PARTES && (
          <MovimientoPartes
            montoTotal={montoNum}
            partes={partes}
            onChange={setPartes}
            disabled={disabled}
            moneda={moneda}
          />
        )}

        {/* 3. Fecha y Categoría */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Fecha del movimiento *">
            <DatePicker value={fecha} onChange={setFecha} disabled={disabled} />
          </Field>

          <Field label="Categoría *">
            <CustomSelect
              value={categoria}
              onChange={handleCambiarCategoria}
              options={opcionesCategoria}
              placeholder="Selecciona una categoría..."
              disabled={disabled}
            />
          </Field>
        </div>

        {/* Crear categoría personalizada (inline, sin cerrar el formulario) */}
        {creandoCategoria && (
          <div className="rounded-2xl border border-primary/25 bg-primary/5 p-3.5 space-y-2.5" role="group" aria-label="Crear nueva categoría">
            <div className="flex items-center gap-2">
              <FolderPlus size={15} className="text-primary shrink-0" />
              <span className="text-xs font-black text-primary">
                Nueva categoría · {tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}
              </span>
            </div>
            <input
              value={nuevaCategoria}
              onChange={e => setNuevaCategoria(e.target.value)}
              maxLength={80}
              placeholder="Ej: Mantenimiento, Publicidad, Comisiones..."
              className={inputClass}
              disabled={crearCategoriaPending}
              aria-label="Nombre de la nueva categoría"
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setCreandoCategoria(false); setNuevaCategoria('') }}
                disabled={crearCategoriaPending}
                className="h-11 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardarNuevaCategoria}
                disabled={crearCategoriaPending}
                className="h-11 px-4 rounded-xl bg-primary text-xs font-black text-white hover:bg-primary-hover disabled:opacity-50 active:scale-95 transition-all inline-flex items-center gap-2 cursor-pointer shadow-sm"
              >
                {crearCategoriaPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Creando...
                  </>
                ) : (
                  'Crear categoría'
                )}
              </button>
            </div>
          </div>
        )}

        {/* 4. Concepto a Ancho Completo */}
        <Field label="Motivo del movimiento (obligatorio) *">
          <input
            value={concepto}
            onChange={e => setConcepto(e.target.value)}
            maxLength={180}
            minLength={3}
            className={inputClass}
            placeholder="Ej: Pago de flete, compra de materiales, cobro de cliente..."
            disabled={disabled}
            required
            aria-label="Motivo del movimiento"
            title="Describe de dónde proviene el ingreso o a qué corresponde el egreso"
          />
        </Field>

        {/* 5. Referencia (solo si el método la usa) — visible, y Nota opcional colapsable */}
        {opcionSeleccionada.requiereReferencia && (
          <Field label="N° de Comprobante / Referencia (Opcional)">
            <input
              value={referencia}
              onChange={e => setReferencia(e.target.value)}
              maxLength={160}
              className={inputClass}
              placeholder="Ej: Transf. #987654, Fact. 001, Ref. Zelle"
              disabled={disabled}
            />
          </Field>
        )}

        {/* Nota opcional (colapsada por defecto) */}
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => setMostrarNota(v => !v)}
            disabled={disabled}
            aria-expanded={mostrarNota}
            className="w-full flex items-center justify-between gap-2 h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <span>Añadir nota (opcional)</span>
            <ChevronDown size={16} className={`shrink-0 transition-transform ${mostrarNota ? 'rotate-180' : ''}`} />
          </button>

          {mostrarNota && (
            <Field label="Observaciones">
              <input
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                maxLength={1000}
                className={inputClass}
                placeholder="Notas o detalles adicionales..."
                disabled={disabled}
              />
            </Field>
          )}
        </div>

        {/* 6. Resumen previo a guardar (vivo) */}
        <MovimientoResumen
          tipo={tipo}
          moneda={moneda}
          montoNum={montoNum}
          esVes={esVes}
          equivalenteUsd={equivalenteUsd}
          equivalenteVes={equivalenteVes}
          tasaEfectiva={tasaEfectiva}
          modoTasa={modoTasa}
          categoria={categoria}
          metodoLabel={opcionSeleccionada.selectedLabel || metodoPago}
          concepto={concepto}
          referencia={referencia}
          cuentaOrigen={esMetodoBanco ? (cuentaOrigenNombre || null) : null}
          numPartes={partes.length}
        />

        {/* 7. Botones de acción */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => { if (!disabled) onClose() }}
            disabled={disabled}
            className="h-11 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={disabled}
            className="h-11 px-5 rounded-xl bg-primary text-xs font-black text-white hover:bg-primary-hover disabled:opacity-50 active:scale-95 transition-all shadow-md inline-flex items-center justify-center gap-2 cursor-pointer"
            style={{ touchAction: 'manipulation' }}
          >
            {disabled ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Guardando...
              </>
            ) : (
              'Guardar movimiento'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <label className="block min-w-0">
      <span className="block mb-1 text-xs font-bold text-slate-700">{label}</span>
      {children}
    </label>
  )
}
