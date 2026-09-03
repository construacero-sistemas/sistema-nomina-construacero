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
  Printer,
} from 'lucide-react'
import { useCandados } from '../../config/candadosRuntime.js'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import PageHeader from '../../../compat/components/ui/PageHeader.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import ResumenPeriodoKpis from './ResumenPeriodoKpis.jsx'
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
  useCrearCategoria,
  useCrearMovimiento,
} from '../../hooks/useFinanzas.js'
import { showToast } from '../../../compat/components/ui/toastBus.js'
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
import { FinanzasFiltrosSeccion, InlineError } from './FinanzasFiltrosUI.jsx'
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
  const { syncPos: syncPosBloqueado } = useCandados()
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
  const crearCategoriaM = useCrearCategoria()
  const reasignarMutation = useReasignarCuenta()
  const crearMovimiento = useCrearMovimiento()

  const categoriasVisibles = categorias.data?.categorias || []
  const categoriasEliminadas = categorias.data?.eliminadas || []
  const pendingCategoriaId = eliminarCategoriaM.isPending || restaurarCategoriaM.isPending
    ? (eliminarCategoriaM.variables?.id || restaurarCategoriaM.variables?.id || null)
    : null
  const summary = resumen.data?.resumen

  const opcionesCategoriaFiltro = useMemo(() => [
    ...categoriasVisibles.map(item => ({
      value: item.nombre,
      label: item.nombre,
      sub: item.movimientos_count > 0 ? `${item.movimientos_count} movs` : undefined,
    })),
    { value: '__crear__', label: '+ Crear nueva categoría...' },
    { value: '__gestionar__', label: 'Gestionar categorías...' },
  ], [categoriasVisibles])

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
    descartarCuentaEliminada,
    vaciarPapelera,
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

  const handleGuardarCuenta = async (cuentaData, saldoInicial = 0) => {
    if (cuentaEditar) {
      await editarCuenta(cuentaEditar.id, cuentaData)
    } else {
      const nueva = await agregarCuenta(cuentaData)
      if (Number(saldoInicial) > 0) {
        const metodoPagoSugerido = cuentaData.tipo === 'banco_ves'
          ? 'Banco en Bolívares'
          : cuentaData.tipo === 'cripto_usdt'
          ? 'USDT'
          : cuentaData.tipo === 'zelle'
          ? 'Zelle'
          : cuentaData.tipo === 'efectivo_usd'
          ? 'Efectivo $'
          : 'Efectivo Bs'

        try {
          await crearMovimiento.mutateAsync({
            tipo: 'ingreso',
            categoria: 'Saldo Inicial',
            concepto: `Saldo inicial / Apertura de cuenta (${cuentaData.nombre})`,
            monto: Number(saldoInicial),
            moneda: cuentaData.moneda || 'USD',
            cuentaOrigen: cuentaData.nombre,
            cuenta_id: nueva?.id || null,
            metodoPago: metodoPagoSugerido,
            fecha: isoToday(),
            referencia: 'Apertura',
          })
          showToast.success(`Cuenta creada con saldo inicial de ${cuentaData.moneda === 'VES' ? 'Bs. ' : '$'}${saldoInicial}`)
        } catch (err) {
          logClientError({ mensaje: `Error registrando saldo inicial: ${err?.message || err}`, categoria: 'FINANZAS_SALDO_INICIAL' })
        }
      }
    }
  }

  // Reporte PDF del rango/filtros activos (resumen + detalle línea por línea).
  const handleExportarPdf = async (action = 'download') => {
    setExportandoPdf(action)
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
        action,
      })
    } catch (error) {
      logClientError({ mensaje: `Error exportando reporte financiero: ${error?.message || error}`, stack: error?.stack, categoria: 'FINANZAS_PDF' })
    } finally {
      setExportandoPdf(null)
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
              onClick={syncPosBloqueado ? undefined : () => setSyncPosOpen(true)}
              aria-disabled={syncPosBloqueado}
              title={syncPosBloqueado ? 'Disponible próximamente' : undefined}
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-11 rounded-xl border border-primary/20 bg-primary/10 text-xs font-black text-primary hover:bg-primary/20 active:scale-95 transition-all shadow-xs cursor-pointer whitespace-nowrap ${syncPosBloqueado ? 'opacity-60 cursor-not-allowed' : ''}`}
              style={{ touchAction: 'manipulation' }}
            >
              {syncPosBloqueado && <Lock size={14} className="text-primary/60" aria-hidden="true" />}
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
          <FinanzasFiltrosSeccion
            filtroCartera={filtroCartera}
            setFiltroCartera={setFiltroCartera}
            rangosRapidos={RANGOS_RAPIDOS}
            chipActivo={chipActivo}
            aplicarRangoRapido={aplicarRangoRapido}
            desde={desde}
            setDesde={setDesde}
            hasta={hasta}
            setHasta={setHasta}
            tipo={tipo}
            setTipo={setTipo}
            categoria={categoria}
            setCategoria={setCategoria}
            opcionesCategoriaFiltro={opcionesCategoriaFiltro}
            setCategoriasOpen={setCategoriasOpen}
            moneda={moneda}
            setMoneda={setMoneda}
            resetFiltros={resetFiltros}
            onRefresh={() => { movimientos.refetch(); resumen.refetch() }}
            mostrarAnulados={mostrarAnulados}
            setMostrarAnulados={setMostrarAnulados}
          />

            {/* Exportación del reporte del período filtrado */}
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400 font-semibold">
                El PDF refleja los filtros activos: {fechaCorta(desde)} – {fechaCorta(hasta)}{tipo ? ` · ${tipo === 'ingreso' ? 'ingresos' : 'egresos'}` : ''} · {movimientosFiltrados.length} movimiento(s)
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExportarPdf('print')}
                  disabled={!fechaValida || !!exportandoPdf || movimientosFiltrados.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-11 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-black text-slate-700 disabled:opacity-40 active:scale-95 transition-all cursor-pointer"
                  style={{ touchAction: 'manipulation' }}
                >
                  <Printer size={14} />
                  <span>{exportandoPdf === 'print' ? 'Preparando...' : 'Imprimir'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportarPdf('download')}
                  disabled={!fechaValida || !!exportandoPdf || movimientosFiltrados.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 min-h-11 rounded-xl bg-primary/10 border border-primary/20 text-xs font-black text-primary hover:bg-primary/20 disabled:opacity-40 active:scale-95 transition-all shadow-xs cursor-pointer"
                  style={{ touchAction: 'manipulation' }}
                >
                  <FileText size={14} />
                  <span>{exportandoPdf === 'download' ? 'Generando PDF...' : 'Descargar PDF'}</span>
                </button>
              </div>
            </div>

            {!fechaValida && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">El rango de fechas no es válido.</p>}

          {/* KPI Cards Globales del período */}
          <ResumenPeriodoKpis summary={summary} loading={resumen.isLoading} />

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
            onDescartarEliminada={descartarCuentaEliminada}
            onVaciarPapelera={vaciarPapelera}
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
      {syncPosOpen && <SyncPosModal open={syncPosOpen} onClose={() => setSyncPosOpen(false)} />}
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
          onCrear={crearCategoriaM.mutateAsync}
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
