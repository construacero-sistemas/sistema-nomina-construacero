// src/components/finanzas/FinanzasView.jsx
// Libro financiero administrativo: ingresos, egresos, reportes y gestión por Carteras (USD & Bolívares).
import { useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRightLeft,
  BarChart3,
  Download,
  Landmark,
  Plus,
  ReceiptText,
  RefreshCw,
  Wallet,
} from 'lucide-react'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import PageHeader from '../../../compat/components/ui/PageHeader.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import useAuthStore from '../../../compat/store/useAuthStore.js'
import useMonedaNomina from '../../hooks/useMonedaNomina.js'
import {
  useAnularMovimiento,
  useFinanzasCategorias,
  useFinanzasMovimientos,
  useFinanzasResumen,
  usePuedeFinanzas,
  useReasignarCuenta,
} from '../../hooks/useFinanzas.js'
import { useCuentasCustodia } from '../../hooks/useCuentasCustodia.js'
import MovimientoForm from './MovimientoForm.jsx'
import MovimientoTable from './MovimientoTable.jsx'
import SyncPosModal from './SyncPosModal.jsx'
import CarterasHeader from './CarterasHeader.jsx'
import TransferenciaCarterasModal from './TransferenciaCarterasModal.jsx'
import DetalleCuentaModal from './DetalleCuentaModal.jsx'
import ReasignarCuentaModal from './ReasignarCuentaModal.jsx'
import CuentasCustodiaGrid from './CuentasCustodiaGrid.jsx'
import CuentaFormModal from './CuentaFormModal.jsx'
import { calcularSaldosCarteras, clasificarMovimientoEnCartera, contarMovimientosSinCuenta } from '../../utils/carterasHelper.js'

function getLocalIsoDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isoToday() {
  return getLocalIsoDate()
}

function monthStart() {
  const date = new Date()
  return getLocalIsoDate(new Date(date.getFullYear(), date.getMonth(), 1))
}

// Export CSV: oculto por ahora (se reactiva poniendo true).
const MOSTRAR_CSV = false

export default function FinanzasView() {
  const perfil = useAuthStore(state => state.perfil)
  const puede = usePuedeFinanzas()
  const { tasaActiva } = useMonedaNomina()

  // Pestaña activa: 'movimientos' (operación diaria) o 'tesoreria' (saldos y carteras)
  const [activeTab, setActiveTab] = useState('movimientos')

  const [desde, setDesde] = useState(monthStart)
  const [hasta, setHasta] = useState(isoToday)
  const [tipo, setTipo] = useState('')
  const [categoria, setCategoria] = useState('')
  const [moneda, setMoneda] = useState('')
  const [filtroCartera, setFiltroCartera] = useState('')
  const [mostrarAnulados, setMostrarAnulados] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [syncPosOpen, setSyncPosOpen] = useState(false)
  const [transferenciaOpen, setTransferenciaOpen] = useState(false)
  const [cuentaDetalle, setCuentaDetalle] = useState(null)
  const [cuentaFormOpen, setCuentaFormOpen] = useState(false)
  const [cuentaEditar, setCuentaEditar] = useState(null)
  const [anular, setAnular] = useState(null)
  const [reasignarOpen, setReasignarOpen] = useState(false)

  const categorias = useFinanzasCategorias()
  const movimientos = useFinanzasMovimientos({ desde, hasta, tipo, categoria, moneda, mostrarAnulados })
  const resumen = useFinanzasResumen({ desde, hasta, tipo, categoria, moneda })
  const anularMutation = useAnularMovimiento()
  const reasignarMutation = useReasignarCuenta()

  const categoriasVisibles = categorias.data?.categorias || []
  const summary = resumen.data?.resumen

  const movimientosList = useMemo(
    () => movimientos.data?.pages.flatMap(page => page.movimientos) || [],
    [movimientos.data],
  )

  // Cuentas bancarias, Binance, Zelle y cajas de custodia
  const {
    cuentas,
    agregarCuenta,
    editarCuenta,
    eliminarCuenta,
    restaurarPredeterminadas,
  } = useCuentasCustodia(movimientosList)

  // Saldos consolidados de las Carteras en vivo
  const saldosCarteras = useMemo(() => {
    return calcularSaldosCarteras(movimientosList, tasaActiva)
  }, [movimientosList, tasaActiva])

  // Cuántos movimientos del período quedan sin cuenta de custodia explícita (auditable)
  const sinCuentaInfo = useMemo(() => {
    return contarMovimientosSinCuenta(movimientosList, cuentas)
  }, [movimientosList, cuentas])

  // Filtrado de movimientos por Cartera activa (USD / VES / Todas)
  const movimientosFiltrados = useMemo(() => {
    if (!filtroCartera) return movimientosList
    return movimientosList.filter(m => {
      const { carteraId } = clasificarMovimientoEnCartera(m)
      return carteraId === filtroCartera
    })
  }, [movimientosList, filtroCartera])

  const fechaValida = desde && hasta && desde <= hasta

  const resetFiltros = () => {
    setDesde(monthStart())
    setHasta(isoToday())
    setTipo('')
    setCategoria('')
    setMoneda('')
    setFiltroCartera('')
    setMostrarAnulados(false)
  }

  const handleGuardarCuenta = (cuentaData) => {
    if (cuentaEditar) {
      editarCuenta(cuentaEditar.id, cuentaData)
    } else {
      agregarCuenta(cuentaData)
    }
  }

  if (!puede) {
    return (
      <div className="p-4 md:p-6">
        <PageHeader icon={Landmark} title="Finanzas" subtitle="Gestiona ingresos, gastos y balance" />
        <div className="mt-5 bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-900">
          Este módulo está disponible para la cuenta activa.
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-4 md:space-y-5 min-w-0 pb-12 md:pb-4">
      <PageHeader
        icon={Landmark}
        title="Finanzas y Tesorería"
        subtitle="Administración de carteras en Dólares y Bolívares, ingresos, egresos y flujo de caja"
        action={(
          <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
            <button
              type="button"
              onClick={() => setTransferenciaOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all shadow-xs cursor-pointer whitespace-nowrap"
              style={{ touchAction: 'manipulation' }}
            >
              <ArrowRightLeft size={14} className="text-primary" /> Mover entre carteras
            </button>
            <button
              type="button"
              onClick={() => setSyncPosOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-11 rounded-xl border border-primary/20 bg-primary/10 text-xs font-black text-primary hover:bg-primary/20 active:scale-95 transition-all shadow-xs cursor-pointer whitespace-nowrap"
              style={{ touchAction: 'manipulation' }}
            >
              <ArrowDownToLine size={14} /> Sincronizar POS
            </button>
            {MOSTRAR_CSV && (
              <button
                type="button"
                onClick={() => exportarCsv(movimientosFiltrados)}
                disabled={!movimientosFiltrados.length}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                style={{ touchAction: 'manipulation' }}
              >
                <Download size={14} /> CSV
              </button>
            )}
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-11 rounded-xl text-sm font-black text-white shadow-lg active:scale-[.98] cursor-pointer w-full sm:w-auto"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)', touchAction: 'manipulation' }}
            >
              <Plus size={16} /> Nuevo movimiento
            </button>
          </div>
        )}
      />

      {/* Barra de Pestañas Segmentada (Flujo de Movimientos vs. Tesorería) */}
      <div className="space-y-2.5 pt-1">
        {/* Control segmentado a ancho completo (2 columnas iguales) */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 border border-slate-200 rounded-2xl">
          <button
            type="button"
            onClick={() => setActiveTab('movimientos')}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 min-h-11 rounded-xl text-xs font-black transition-all cursor-pointer ${
              activeTab === 'movimientos'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            <ReceiptText size={15} className={`shrink-0 ${activeTab === 'movimientos' ? 'text-primary' : 'text-slate-400'}`} />
            <span className="truncate">
              <span className="sm:hidden">Movimientos</span>
              <span className="hidden sm:inline">Movimientos y Flujo</span>
            </span>
            {movimientosList.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold shrink-0">
                {movimientosList.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tesoreria')}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 min-h-11 rounded-xl text-xs font-black transition-all cursor-pointer ${
              activeTab === 'tesoreria'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            <Landmark size={15} className={`shrink-0 ${activeTab === 'tesoreria' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span className="truncate">
              <span className="sm:hidden">Tesorería</span>
              <span className="hidden sm:inline">Tesorería y Carteras</span>
            </span>
            {saldosCarteras?.patrimonioTotalUsd != null && (
              <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold whitespace-nowrap shrink-0">
                ${formatNumber(saldosCarteras.patrimonioTotalUsd)} USD
              </span>
            )}
          </button>
        </div>

        {/* Resumen rápido de patrimonio cuando estás en la pestaña de movimientos */}
        {activeTab === 'movimientos' && saldosCarteras?.patrimonioTotalUsd != null && (
          <button
            type="button"
            onClick={() => setActiveTab('tesoreria')}
            className="text-xs text-slate-500 hover:text-primary transition-colors flex items-center gap-1.5 font-bold cursor-pointer min-h-11"
          >
            <Wallet size={14} className="text-amber-500 shrink-0" />
            <span className="min-w-0 break-words">Patrimonio en custodia: <strong className="text-slate-800 font-black">${formatNumber(saldosCarteras.patrimonioTotalUsd)} USD</strong></span>
          </button>
        )}
      </div>

      {/* =========================================================
          PESTAÑA 1: MOVIMIENTOS Y FLUJO DE CAJA (OPERACIÓN DIARIA)
         ========================================================= */}
      {activeTab === 'movimientos' && (
        <div className="space-y-4">
          {/* Sección de Filtros */}
          <section aria-label="Filtros y rango del reporte" className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black text-slate-800">Filtros y Período</h2>
                <p className="mt-0.5 text-xs text-slate-400">Filtra las fechas, tipo de movimiento o categoría.</p>
              </div>
              {filtroCartera && (
                <button
                  type="button"
                  onClick={() => setFiltroCartera('')}
                  className="text-xs font-bold text-primary hover:underline cursor-pointer"
                >
                  Mostrar todas las carteras
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <FilterField label="Desde"><DatePicker value={desde} onChange={setDesde} /></FilterField>
              <FilterField label="Hasta"><DatePicker value={hasta} onChange={setHasta} /></FilterField>
              <FilterField label="Tipo"><Choice value={tipo} onChange={setTipo} placeholder="Todos" options={[{ value: 'ingreso', label: 'Ingresos' }, { value: 'egreso', label: 'Egresos' }]} /></FilterField>
              <FilterField label="Categoría"><Choice value={categoria} onChange={setCategoria} placeholder="Todas" options={categoriasVisibles.map(item => ({ value: item.nombre, label: item.nombre }))} /></FilterField>
              <FilterField label="Moneda"><Choice value={moneda} onChange={setMoneda} placeholder="Todas" options={['USD', 'VES', 'EUR', 'USDT'].map(value => ({ value, label: value }))} /></FilterField>
              <div className="flex items-end gap-2">
                <button type="button" onClick={resetFiltros} className="flex-1 h-11 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer">Limpiar</button>
                <button type="button" onClick={() => { movimientos.refetch(); resumen.refetch() }} className="h-11 w-11 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center cursor-pointer" aria-label="Actualizar reportes"><RefreshCw size={15} /></button>
              </div>
            </div>

            <label className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 cursor-pointer">
              <input type="checkbox" checked={mostrarAnulados} onChange={e => setMostrarAnulados(e.target.checked)} className="rounded border-slate-300 text-primary focus:ring-primary" />
              Mostrar movimientos anulados también
            </label>
            {!fechaValida && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">El rango de fechas no es válido.</p>}
          </section>

          {/* KPI Cards Globales del período */}
          <section aria-label="Resumen financiero" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard icon={BarChart3} label="Ingresos del período" value={formatUsd(summary?.ingresos_usd)} sub={`Bs. ${formatNumber(summary?.ingresos_ves)}`} color="green" loading={resumen.isLoading} />
            <KpiCard icon={Wallet} label="Gastos del período" value={formatUsd(summary?.egresos_usd)} sub={`Bs. ${formatNumber(summary?.egresos_ves)}`} color="red" loading={resumen.isLoading} />
            <KpiCard
              icon={Landmark}
              label="Flujo neto del período"
              value={formatUsd(summary?.balance_usd)}
              sub={`Bs. ${formatNumber(summary?.balance_ves)}`}
              color={Number(summary?.balance_usd) >= 0 ? 'blue' : 'red'}
              loading={resumen.isLoading}
            />
          </section>

          {resumen.isError && <InlineError message="No se pudo cargar el resumen." onRetry={() => resumen.refetch()} />}

          {/* Tabla de Movimientos Filtrada */}
          <section aria-label="Movimientos financieros">
            {movimientos.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-12 w-full rounded-xl" /><Skeleton className="h-12 w-full rounded-xl" /><Skeleton className="h-12 w-full rounded-xl" /></div>
            ) : movimientosFiltrados.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8">
                <EmptyState
                  icon={Landmark}
                  title={filtroCartera ? `Sin movimientos en Cartera ${filtroCartera}` : 'No hay movimientos para este filtro'}
                  description="Ajusta el rango de fechas o registra un nuevo movimiento para empezar."
                  actionLabel="Registrar movimiento"
                  onAction={() => setFormOpen(true)}
                />
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <MovimientoTable
                  movimientos={movimientosFiltrados}
                  onAnular={movimiento => setAnular(movimiento)}
                />
              </div>
            )}
          </section>
        </div>
      )}

      {/* =========================================================
          PESTAÑA 2: TESORERÍA Y CARTERAS EN CUSTODIA (ESTRATÉGICO)
         ========================================================= */}
      {activeTab === 'tesoreria' && (
        <div className="space-y-5">
          {/* 1. Panel de Carteras Maestras en Vivo (Fichas Resumidas) */}
          <CarterasHeader
            saldos={saldosCarteras}
            filtroCartera={filtroCartera}
            sinCuenta={sinCuentaInfo}
            desglosePorCuenta={cuentas}
            onReasignarSinCuenta={() => setReasignarOpen(true)}
            onSelectCartera={setFiltroCartera}
            onOpenTransferencia={() => setTransferenciaOpen(true)}
            onSelectSubcuenta={cuenta => setCuentaDetalle(cuenta)}
          />

          {/* 2. Zona de Cuentas Bancarias, Binance, Zelle y Cajas de Custodia */}
          <CuentasCustodiaGrid
            cuentas={cuentas}
            onNuevaCuenta={() => {
              setCuentaEditar(null)
              setCuentaFormOpen(true)
            }}
            onEditarCuenta={cuenta => {
              setCuentaEditar(cuenta)
              setCuentaFormOpen(true)
            }}
            onEliminarCuenta={eliminarCuenta}
            onVerDetalle={cuenta => setCuentaDetalle(cuenta)}
            onTransferir={() => setTransferenciaOpen(true)}
            onRestaurar={restaurarPredeterminadas}
          />

          {/* 3. Tabla de Movimientos de Tesorería */}
          <section aria-label="Movimientos de tesorería" className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider">
                {filtroCartera ? `Movimientos de Cartera ${filtroCartera === 'USD' ? 'Dólares' : 'Bolívares'}` : 'Movimientos de Tesorería'}
              </h3>
              {filtroCartera && (
                <button
                  type="button"
                  onClick={() => setFiltroCartera('')}
                  className="text-xs font-bold text-primary hover:underline cursor-pointer"
                >
                  Ver todas las carteras
                </button>
              )}
            </div>

            {movimientos.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-12 w-full rounded-xl" /><Skeleton className="h-12 w-full rounded-xl" /></div>
            ) : movimientosFiltrados.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8">
                <EmptyState
                  icon={Landmark}
                  title="Sin movimientos registrados"
                  description="No hay movimientos en esta cartera para el período actual."
                  actionLabel="Realizar traspaso"
                  onAction={() => setTransferenciaOpen(true)}
                />
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <MovimientoTable
                  movimientos={movimientosFiltrados}
                  onAnular={movimiento => setAnular(movimiento)}
                />
              </div>
            )}
          </section>
        </div>
      )}

      {formOpen && <MovimientoForm categorias={categoriasVisibles} cuentas={cuentas} onClose={() => setFormOpen(false)} />}
      {syncPosOpen && <SyncPosModal open={syncPosOpen} onClose={() => setSyncPosOpen(false)} />}
      {transferenciaOpen && <TransferenciaCarterasModal open={transferenciaOpen} onClose={() => setTransferenciaOpen(false)} saldos={saldosCarteras} />}
      {cuentaFormOpen && (
        <CuentaFormModal
          key={cuentaEditar?.id || 'nueva'}
          open={cuentaFormOpen}
          cuentaEditar={cuentaEditar}
          onClose={() => {
            setCuentaFormOpen(false)
            setCuentaEditar(null)
          }}
          onGuardar={handleGuardarCuenta}
        />
      )}
      {cuentaDetalle && (
        <DetalleCuentaModal
          open={Boolean(cuentaDetalle)}
          cuenta={cuentaDetalle}
          onClose={() => setCuentaDetalle(null)}
          movimientos={movimientosList}
          cuentas={cuentas}
          tasaBcv={tasaActiva}
          onOpenTransferencia={() => {
            setCuentaDetalle(null)
            setTransferenciaOpen(true)
          }}
        />
      )}
      {anular && <AnularDialog movimiento={anular} pending={anularMutation.isPending} onClose={() => setAnular(null)} onConfirm={motivo => { anularMutation.mutate({ id: anular.id, motivo }, { onSuccess: () => setAnular(null) }) }} />}
      <ReasignarCuentaModal
        open={reasignarOpen}
        onClose={() => setReasignarOpen(false)}
        movimientos={movimientosList}
        cuentas={cuentas}
        confirmando={reasignarMutation.isPending}
        onConfirm={({ ids, cuentaOrigen }) => reasignarMutation.mutate({ ids, cuentaOrigen })}
      />
    </div>
  )
}

function FilterField({ label, children }) {
  return (
    <label className="space-y-1 min-w-0">
      <span className="block text-[11px] font-bold text-slate-500">{label}</span>
      <span className="block [&>input]:w-full [&>input]:h-11 [&>input]:rounded-xl [&>input]:border [&>input]:border-slate-200 [&>input]:bg-slate-50 [&>input]:px-2.5 [&>input]:text-xs [&>input]:text-slate-700 [&>select]:w-full [&>select]:h-11 [&>select]:rounded-xl [&>select]:border [&>select]:border-slate-200 [&>select]:bg-slate-50 [&>select]:px-2.5 [&>select]:text-xs [&>select]:text-slate-700">
        {children}
      </span>
    </label>
  )
}

function Choice({ value, onChange, placeholder, options }) {
  return <CustomSelect value={value} onChange={onChange} placeholder={placeholder} options={options} clearable />
}

function InlineError({ message, onRetry }) {
  return <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700" role="alert">{message} <button type="button" onClick={onRetry} className="underline font-black">Volver a intentar</button></div>
}

function AnularDialog({ movimiento, pending, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('')
  return (
    <Modal isOpen onClose={onClose} title="¿Anular este movimiento?" className="sm:max-w-md">
      <p className="text-sm text-slate-500">No se borrará. Quedará fuera del balance vigente y conservará su historial.</p>
      <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><strong>{movimiento.concepto}</strong> · {formatUsd(movimiento.monto)} {movimiento.moneda}</p>
      <label className="block mt-4 text-xs font-bold text-slate-600">¿Por qué quieres anularlo? *<textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={300} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" placeholder="Describe por qué se anula..." /></label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={pending} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
        <button type="button" onClick={() => onConfirm(motivo.trim())} disabled={pending || motivo.trim().length < 3} className="px-4 py-2 rounded-xl bg-red-600 text-sm font-black text-white disabled:opacity-50">{pending ? 'Guardando...' : 'Sí, anular movimiento'}</button>
      </div>
    </Modal>
  )
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatUsd(value) {
  return `$${formatNumber(value)}`
}

function exportarCsv(rows) {
  if (!rows.length || typeof window === 'undefined') return
  const headers = [
    'Fecha',
    'Tipo',
    'Categoría',
    'Cartera',
    'Subcuenta / Método',
    'Concepto',
    'Monto',
    'Moneda',
    'Tasa de Cambio (Bs/$)',
    'Monto en Bs',
    'Referencia',
    'Estado',
    'Observaciones',
  ]

  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`

  const rowsData = rows.map(row => {
    const { carteraId, subcuentaNombre } = clasificarMovimientoEnCartera(row)
    const monto = Number(row.monto) || 0
    const tasa = Number(row.tasa_usd_ves || row.tasa_ves || 1)
    const montoVes = row.moneda === 'VES'
      ? (Number(row.monto_ves) || monto)
      : (Number(row.monto_ves) || (monto * tasa))

    return [
      row.fecha || '',
      row.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
      row.categoria || 'Sin categoría',
      carteraId === 'USD' ? 'Cartera Dólares (USD)' : 'Cartera Bolívares (VES)',
      subcuentaNombre || '',
      row.concepto || '',
      monto.toFixed(2),
      row.moneda || 'USD',
      tasa > 1 ? tasa.toFixed(2) : '1.00',
      montoVes.toFixed(2),
      row.referencia || '',
      row.estado === 'anulado' ? 'Anulado' : 'Activo',
      row.observaciones || '',
    ]
  })

  const csv = [headers, ...rowsData]
    .map(row => row.map(escape).join(';'))
    .join('\n')

  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `finanzas-construacero-${getLocalIsoDate()}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
