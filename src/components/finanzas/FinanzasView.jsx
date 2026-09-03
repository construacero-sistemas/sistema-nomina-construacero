// src/components/finanzas/FinanzasView.jsx
// Libro financiero administrativo: ingresos, egresos, reportes y gestión por Carteras (USD & Bolívares).
import { useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRightLeft,
  BarChart3,
  Download,
  FileText,
  Landmark,
  Plus,
  ReceiptText,
  RefreshCw,
  Wallet,
  Lock,
} from 'lucide-react'
import { SYNC_POS_BLOQUEADO } from '../../config/modulos.js'
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
  useRevertirAnulacion,
  useFinanzasCategorias,
  useFinanzasMovimientos,
  useFinanzasResumen,
  usePuedeFinanzas,
  useReasignarCuenta,
  useEliminarCategoria,
  useRestaurarCategoria,
} from '../../hooks/useFinanzas.js'
import { useCuentasCustodia } from '../../hooks/useCuentasCustodia.js'
import MovimientoForm from './MovimientoForm.jsx'
import { Settings2 } from 'lucide-react'
import MovimientoTable from './MovimientoTable.jsx'
import SyncPosModal from './SyncPosModal.jsx'
import CarterasHeader from './CarterasHeader.jsx'
import TransferenciaCarterasModal from './TransferenciaCarterasModal.jsx'
import DetalleCuentaModal from './DetalleCuentaModal.jsx'
import ReasignarCuentaModal from './ReasignarCuentaModal.jsx'
import CuentasCustodiaGrid from './CuentasCustodiaGrid.jsx'
import CuentaFormModal from './CuentaFormModal.jsx'
import CategoriasModal from './CategoriasModal.jsx'
import AnularDialog from './AnularDialog.jsx'
import { FilterField, Choice, InlineError } from './FinanzasFiltrosUI.jsx'
import { exportarCsv } from './exportarMovimientosCsv.js'
import { isoToday, monthStart, RANGOS_RAPIDOS, rangoRapidoActivo, aplicarRangoRapido as resolverRango } from './fechasRapidas.js'
import { fechaCorta, formatNumber, formatUsd } from './formatos.js'
import { logClientError } from '../../../compat/utils/errorLogger.js'
import { calcularSaldosCarteras, clasificarMovimientoEnCartera, contarMovimientosSinCuenta } from '../../utils/carterasHelper.js'

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
  const [exportandoPdf, setExportandoPdf] = useState(false)
  const [categoriasOpen, setCategoriasOpen] = useState(false)
  const [cuentaTransferir, setCuentaTransferir] = useState(null)

  const categorias = useFinanzasCategorias()
  const movimientos = useFinanzasMovimientos({ desde, hasta, tipo, categoria, moneda, mostrarAnulados })
  const resumen = useFinanzasResumen({ desde, hasta, tipo, categoria, moneda })
  const anularMutation = useAnularMovimiento()
  const revertirAnulacion = useRevertirAnulacion()
  const eliminarCategoriaM = useEliminarCategoria()
  const restaurarCategoriaM = useRestaurarCategoria()
  const reasignarMutation = useReasignarCuenta()

  const categoriasVisibles = categorias.data?.categorias || []
  const categoriasEliminadas = categorias.data?.eliminadas || []
  const pendingCategoriaId = eliminarCategoriaM.isPending || restaurarCategoriaM.isPending
    ? (eliminarCategoriaM.variables?.id || restaurarCategoriaM.variables?.id || null)
    : null
  const summary = resumen.data?.resumen

  const movimientosList = useMemo(
    () => movimientos.data?.pages.flatMap(page => page.movimientos) || [],
    [movimientos.data],
  )

  // Cuentas bancarias, Binance, Zelle y cajas de custodia
  const {
    cuentas,
    cuentasEliminadas,
    agregarCuenta,
    editarCuenta,
    eliminarCuenta,
    restaurarCuentaEliminada,
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
  const chipActivo = rangoRapidoActivo(desde, hasta)

  const aplicarRangoRapido = id => {
    const rango = resolverRango(id)
    setDesde(rango.desde)
    setHasta(rango.hasta)
  }

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

  // Reporte PDF del rango/filtros activos (resumen + detalle línea por línea).
  const handleExportarPdf = async () => {
    setExportandoPdf(true)
    try {
      const { generarFinanzasResumenPDF } = await import('../../services/pdf/finanzasResumenPDF.js')
      await generarFinanzasResumenPDF({
        movimientos: movimientosFiltrados,
        resumen: {
          ingresos_usd: summary?.ingresos_usd,
          egresos_usd: summary?.egresos_usd,
          balance_usd: summary?.balance_usd,
          balance_ves: summary?.balance_ves,
          tipoFiltro: tipo || '',
        },
        rango: { desde, hasta },
        action: 'download',
      })
    } catch (error) {
      logClientError({ mensaje: `Error exportando reporte financiero: ${error?.message || error}`, stack: error?.stack, categoria: 'FINANZAS_PDF' })
    } finally {
      setExportandoPdf(false)
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
              onClick={SYNC_POS_BLOQUEADO ? undefined : () => setSyncPosOpen(true)}
              aria-disabled={SYNC_POS_BLOQUEADO}
              title={SYNC_POS_BLOQUEADO ? 'Disponible próximamente' : undefined}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-11 rounded-xl border border-primary/20 bg-primary/10 text-xs font-black text-primary hover:bg-primary/20 active:scale-95 transition-all shadow-xs cursor-pointer whitespace-nowrap opacity-60 disabled:cursor-not-allowed"
              style={{ touchAction: 'manipulation' }}
            >
              {SYNC_POS_BLOQUEADO && <Lock size={14} className="text-primary/60" aria-hidden="true" />}
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
                <p className="mt-0.5 text-xs text-slate-400 hidden sm:block">Filtra las fechas, tipo de movimiento o categoría.</p>
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

            {/* Rangos rápidos: la acción más común a un toque (especialmente en móvil) */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Rangos de fecha rápidos">
              {RANGOS_RAPIDOS.map(rango => (
                <button
                  key={rango.id}
                  type="button"
                  onClick={() => aplicarRangoRapido(rango.id)}
                  aria-pressed={chipActivo === rango.id}
                  className={`px-3 h-8 rounded-full text-xs font-bold border transition-colors cursor-pointer ${
                    chipActivo === rango.id
                      ? 'bg-primary text-white border-primary'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                  style={{ touchAction: 'manipulation' }}
                >
                  {rango.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <FilterField label="Desde"><DatePicker value={desde} onChange={setDesde} /></FilterField>
              <FilterField label="Hasta"><DatePicker value={hasta} onChange={setHasta} /></FilterField>
              <FilterField label="Tipo"><Choice value={tipo} onChange={setTipo} placeholder="Todos" options={[{ value: 'ingreso', label: 'Ingresos' }, { value: 'egreso', label: 'Egresos' }]} /></FilterField>
              <FilterField label="Categoría">
                <div className="flex gap-1.5">
                  <div className="flex-1 min-w-0"><Choice value={categoria} onChange={setCategoria} placeholder="Todas" options={categoriasVisibles.map(item => ({ value: item.nombre, label: item.nombre }))} /></div>
                  <button
                    type="button"
                    onClick={() => setCategoriasOpen(true)}
                    className="shrink-0 h-11 w-11 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700 flex items-center justify-center cursor-pointer"
                    aria-label="Gestionar categorías"
                    title="Gestionar categorías"
                  >
                    <Settings2 size={15} />
                  </button>
                </div>
              </FilterField>
              <FilterField label="Moneda"><Choice value={moneda} onChange={setMoneda} placeholder="Todas" options={['USD', 'VES', 'USDT'].map(value => ({ value, label: value }))} /></FilterField>
              <div className="flex items-end gap-2">
                <button type="button" onClick={resetFiltros} className="flex-1 h-11 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer">Limpiar</button>
                <button type="button" onClick={() => { movimientos.refetch(); resumen.refetch() }} className="h-11 w-11 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center cursor-pointer" aria-label="Actualizar reportes"><RefreshCw size={15} /></button>
              </div>
            </div>            <label className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 cursor-pointer">
              <input type="checkbox" checked={mostrarAnulados} onChange={e => setMostrarAnulados(e.target.checked)} className="rounded border-slate-300 text-primary focus:ring-primary" />
              Mostrar movimientos anulados también
            </label>

            {/* Exportación del reporte del período filtrado */}
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400 font-semibold">
                El PDF refleja los filtros activos: {fechaCorta(desde)} – {fechaCorta(hasta)}{tipo ? ` · ${tipo === 'ingreso' ? 'ingresos' : 'egresos'}` : ''} · {movimientosFiltrados.length} movimiento(s)
              </p>
              <button
                type="button"
                onClick={handleExportarPdf}
                disabled={!fechaValida || exportandoPdf || movimientosFiltrados.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 min-h-11 rounded-xl bg-primary/10 border border-primary/20 text-xs font-black text-primary hover:bg-primary/20 disabled:opacity-40 active:scale-95 transition-all shadow-xs cursor-pointer"
                style={{ touchAction: 'manipulation' }}
              >
                <FileText size={14} />
                <span>{exportandoPdf ? 'Generando PDF...' : 'Descargar reporte PDF'}</span>
              </button>
            </div>

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
                  onRevertir={movimiento => revertirAnulacion.mutate({ id: movimiento.id })}
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
          {/* 1. Panel de Carteras Maestras en Vivo (Fichas Resumidas Macro) */}
          <CarterasHeader
            saldos={saldosCarteras}
            filtroCartera={filtroCartera}
            sinCuenta={sinCuentaInfo}
            onReasignarSinCuenta={() => setReasignarOpen(true)}
            onSelectCartera={setFiltroCartera}
            onOpenTransferencia={() => {
              setCuentaTransferir(null)
              setTransferenciaOpen(true)
            }}
          />

          {/* 2. Zona Unificada de Cuentas Bancarias, Binance, Zelle y Cajas de Custodia */}
          <CuentasCustodiaGrid
            cuentas={cuentas}
            cuentasEliminadas={cuentasEliminadas}
            onRestaurarEliminada={restaurarCuentaEliminada}
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
            onTransferir={cuenta => {
              setCuentaTransferir(cuenta)
              setTransferenciaOpen(true)
            }}
            onRestaurar={restaurarPredeterminadas}
            tasaBcv={tasaActiva}
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
                  onRevertir={movimiento => revertirAnulacion.mutate({ id: movimiento.id })}
                />
              </div>
            )}
          </section>
        </div>
      )}

      {formOpen && <MovimientoForm categorias={categoriasVisibles} cuentas={cuentas} onClose={() => setFormOpen(false)} />}
      {transferenciaOpen && (
        <TransferenciaCarterasModal
          key={cuentaTransferir?.id || 'transferencia-default'}
          open={transferenciaOpen}
          onClose={() => {
            setTransferenciaOpen(false)
            setCuentaTransferir(null)
          }}
          saldos={saldosCarteras}
          cuentas={cuentas}
          cuentaInicial={cuentaTransferir}
        />
      )}
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
      {categoriasOpen && (
        <CategoriasModal
          categorias={categoriasVisibles}
          eliminadas={categoriasEliminadas}
          pendingId={pendingCategoriaId}
          onDelete={id => eliminarCategoriaM.mutate({ id })}
          onRestore={id => restaurarCategoriaM.mutate({ id })}
          onClose={() => setCategoriasOpen(false)}
        />
      )}
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
