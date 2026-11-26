// src/components/nomina/PeriodoDetalleModal.jsx
// Detalle simplificado del período: muestra directamente la Hoja semanal
// (planilla), exportación PDF/Excel, descuentos, cierre con tasa y reapertura.
import { useState, useMemo } from 'react'
import { FileText, Lock, RotateCcw, ShoppingBag } from 'lucide-react'
import { useNominaLineas, useReabrirPeriodo, useTasasPeriodo } from '../../hooks/useNomina'
import useHojaSemanal from '../../hooks/useHojaSemanal.js'
import { formatBs } from '../../hooks/useMonedaNomina.js'
import { useConfigNegocio } from '../../../compat/hooks/useConfigNegocio.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import LiquidacionModal from './LiquidacionModal'
import HojaSemanal from './HojaSemanal.jsx'
import ImportarComisionesPosModal from './ImportarComisionesPosModal.jsx'
import CerrarPeriodoModal from './CerrarPeriodoModal.jsx'
import { VENDEDORES_EN_NOMINA } from '../../config/comisionesVendedores.js'
import { logClientError } from '../../../compat/utils/errorLogger.js'
import useAutoCalculoPeriodo from '../../hooks/useAutoCalculoPeriodo.js'
import { EstadoAutoCalculo } from './PeriodoDetallePartes.jsx'
import { fmt } from './periodoDetalleUtils.js'

export default function PeriodoDetalleModal({ periodo, puedeGestionarNomina = false, onClose }) {
  const { data: lineas = [], isLoading, isError, refetch } = useNominaLineas(periodo.id)
  const { data: hojaData } = useHojaSemanal(periodo.id)
  const { data: configNegocio } = useConfigNegocio()
  const reabrir = useReabrirPeriodo()

  const [confirmandoReabrir, setConfirmandoReabrir] = useState(false)
  const [cerrandoPeriodo, setCerrandoPeriodo] = useState(false)
  const [liquidando, setLiquidando] = useState(null)
  const [exportando, setExportando] = useState(false)
  const [importandoComisiones, setImportandoComisiones] = useState(false)

  const abierto = periodo.estado === 'abierto'
  const autoCalculo = useAutoCalculoPeriodo(periodo, puedeGestionarNomina)

  const { data: tasasCierre = [] } = useTasasPeriodo(abierto ? null : periodo.id)
  const tasaCongelada = useMemo(() => {
    if (abierto || !tasasCierre.length) return null
    return tasasCierre.find(t => t.moneda_origen === 'USD') || tasasCierre[0] || null
  }, [abierto, tasasCierre])

  const netoReciboUsd = fila => {
    const linea = lineas.find(l => l.id === fila.lineaId)
    return Number(linea ? linea.total_neto_usd : fila.neto) || 0
  }
  const tasaPeriodo = tasaCongelada ? (Number(tasaCongelada.valor) || 0) : 0
  const origenTasaPeriodo = 'cierre'
  const bsDeFilaHoja = fila => {
    if (fila.pagado && Number(fila.tasaPago) > 0 && fila.totalPagadoBs != null) {
      return Number(fila.totalPagadoBs)
    }
    return tasaPeriodo > 0 ? netoReciboUsd(fila) * tasaPeriodo : 0
  }

  const totales = useMemo(() => ({
    empleados: lineas.length,
    bruto: lineas.reduce((s, l) => s + Number(l.total_bruto_usd || 0), 0),
    neto: lineas.reduce((s, l) => s + Number(l.total_neto_usd || 0), 0),
    deduc: lineas.reduce((s, l) => s + Number(l.deducciones_usd || 0), 0),
    bonos: lineas.reduce((s, l) => s + Number(l.bonos_usd || 0), 0),
    comisiones: lineas.reduce((s, l) => s + Number(l.comisiones_pos_usd || 0), 0),
  }), [lineas])

  async function exportarPlanilla() {
    setExportando(true)
    try {
      const { generarNominaResumenPDF } = await import('../../services/pdf/nominaResumenPDF')
      await generarNominaResumenPDF({
        periodo,
        lineas,
        hoja: hojaData || null,
        tasaCongelada: tasaCongelada || null,
        config: configNegocio ?? {},
        action: 'download',
      })
    } catch (e) {
      logClientError({ mensaje: `Error exportando planilla: ${e?.message || e}`, stack: e?.stack, categoria: 'NOMINA_PDF' })
    } finally {
      setExportando(false)
    }
  }

  if (isError) {
    return (
      <Modal isOpen onClose={onClose} title={periodo.nombre}>
        <div role="alert" className="space-y-3 text-sm text-rose-800">
          <p>No se pudieron consultar los cálculos del período. No se muestran totales en cero.</p>
          <button type="button" onClick={() => refetch()} className="min-h-11 rounded-xl border px-4 py-2 font-bold">
            Volver a intentar
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <>
      <Modal isOpen onClose={onClose} title={periodo.nombre} className="max-w-7xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Personal</span>
              <span className="mt-0.5 block text-sm font-black text-slate-800">{totales.empleados} trabajadores</span>
              <span className="text-[10px] text-slate-500 capitalize">Estado: {periodo.estado}</span>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Bruto (USD)</span>
              <span className="mt-0.5 block text-sm font-black text-slate-800">${fmt(totales.bruto)}</span>
              <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                <span className="font-semibold text-emerald-600">+{fmt(totales.bonos)} bonos</span>
                {totales.comisiones > 0 && (
                  <span className="font-semibold text-amber-800">+{fmt(totales.comisiones)} comisiones</span>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Deducciones (USD)</span>
              <span className="mt-0.5 block text-sm font-black text-red-600">${fmt(totales.deduc)}</span>
              <span className="text-[10px] text-slate-400">Anticipos y préstamos</span>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="flex items-center justify-between">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-700">Neto a Liquidar</span>
                <span className="text-[9px] font-bold uppercase text-emerald-600">Principal: USD</span>
              </div>
              <span className="mt-0.5 block text-sm font-black text-emerald-800">${fmt(totales.neto)}</span>
              <span className="block font-mono text-[11px] font-bold text-emerald-700">
                {tasaCongelada ? formatBs((Number(totales.neto) || 0) * (Number(tasaCongelada.valor) || 0)) : 'Bs: se define al cerrar'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {tasaCongelada && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-slate-500">Tasa de cierre:</span>
                <span
                  title={`Tasa congelada al cierre el ${tasaCongelada.fecha} (${tasaCongelada.fuente})`}
                  className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-black text-emerald-800"
                >
                  {Number(tasaCongelada.valor).toLocaleString('es-VE')} Bs/$ · {tasaCongelada.fuente}
                </span>
              </div>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {VENDEDORES_EN_NOMINA && puedeGestionarNomina && abierto && lineas.length > 0 && (
                <button
                  type="button"
                  onClick={() => setImportandoComisiones(true)}
                  style={{ touchAction: 'manipulation' }}
                  className="flex min-h-11 items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-bold text-amber-900 shadow-xs transition-all hover:bg-amber-100 active:scale-95"
                >
                  <ShoppingBag size={14} className="text-amber-700" />
                  <span>Importar Comisiones POS</span>
                </button>
              )}

              <button
                type="button"
                onClick={exportarPlanilla}
                disabled={exportando || lineas.length === 0}
                className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-50"
              >
                <FileText size={14} className="text-rose-600" />
                <span>{exportando ? 'Generando...' : 'Descargar Planilla PDF'}</span>
              </button>

              {puedeGestionarNomina && (abierto || periodo.estado === 'cerrado') && (
                <button
                  type="button"
                  onClick={() => setCerrandoPeriodo(true)}
                  style={{ touchAction: 'manipulation' }}
                  className="flex min-h-11 items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-black text-white shadow-sm transition-all hover:bg-emerald-800"
                >
                  <Lock size={14} />
                  <span>Cerrar período</span>
                </button>
              )}

              {puedeGestionarNomina && periodo.estado === 'pagado' && (
                <button
                  type="button"
                  onClick={() => setConfirmandoReabrir(true)}
                  className="flex min-h-11 items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-bold text-amber-900 shadow-sm transition-all hover:bg-amber-50"
                >
                  <RotateCcw size={14} />
                  <span>Reabrir período</span>
                </button>
              )}
            </div>
          </div>

          {abierto && (
            <div className="rounded-2xl border border-amber-200/80 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900">
              El período está <strong>abierto</strong>. Puedes agregar bonos o descuentos en cualquier fila y cerrar el período confirmando la tasa de pago.
            </div>
          )}
          {tasaCongelada && (
            <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50 p-3.5 text-xs leading-relaxed text-emerald-900">
              Los montos en Bs de este período usan la tasa congelada al cierre ({Number(tasaCongelada.valor).toLocaleString('es-VE')} Bs/$ · {tasaCongelada.fuente} · {tasaCongelada.fecha}); no cambian con el mercado actual.
            </div>
          )}

          <EstadoAutoCalculo resultado={autoCalculo} />

          {isLoading ? (
            <Skeleton className="h-64 rounded-2xl" />
          ) : (
            <HojaSemanal
              periodo={periodo}
              lineas={lineas}
              abierto={abierto}
              puedeGestionarNomina={puedeGestionarNomina}
              bsDe={bsDeFilaHoja}
              tasa={tasaPeriodo}
              tasaOrigen={origenTasaPeriodo}
              onAgregarDescuento={setLiquidando}
            />
          )}
        </div>

        <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
          <button
            onClick={onClose}
            type="button"
            style={{ touchAction: 'manipulation' }}
            className="min-h-11 rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cerrar
          </button>
        </div>
      </Modal>

      {confirmandoReabrir && (
        <Modal
          isOpen
          title="Reabrir período"
          onClose={() => setConfirmandoReabrir(false)}
          busy={reabrir.isPending}
          className="max-w-md"
          footer={
            <div className="flex w-full flex-col-reverse gap-2 pb-3 sm:flex-row sm:justify-end sm:pb-4">
              <button type="button" disabled={reabrir.isPending} onClick={() => setConfirmandoReabrir(false)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">Cancelar</button>
              <button type="button" disabled={reabrir.isPending} onClick={() => reabrir.mutate(periodo.id, { onSuccess: () => { setConfirmandoReabrir(false); onClose() } })} className="min-h-11 rounded-xl bg-amber-700 px-4 text-sm font-black text-white hover:bg-amber-800 disabled:opacity-50">{reabrir.isPending ? 'Reabriendo…' : 'Sí, reabrir'}</button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-slate-700">
            Se quitará el cierre de <strong>{periodo.nombre}</strong> y el período volverá a quedar abierto para corregirlo. Úsalo solo si se cerró por error.
          </p>
        </Modal>
      )}

      {cerrandoPeriodo && (
        <CerrarPeriodoModal
          periodo={periodo}
          onClose={() => { setCerrandoPeriodo(false); onClose() }}
        />
      )}

      {VENDEDORES_EN_NOMINA && importandoComisiones && (
        <ImportarComisionesPosModal
          periodo={periodo}
          onClose={() => setImportandoComisiones(false)}
        />
      )}

      {liquidando && (
        <LiquidacionModal
          linea={liquidando}
          onClose={() => setLiquidando(null)}
        />
      )}
    </>
  )
}
