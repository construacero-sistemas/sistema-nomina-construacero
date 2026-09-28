// src/components/nomina/TabEmpleados.jsx
// Fichas de empleados con soporte de nómina fija y comisiones exclusivas para Vendedores.
import { useState, useMemo } from 'react'
import {
  Users, Plus, Pencil, DollarSign, Clock, Briefcase, Search, RotateCcw,
  AlertTriangle, CalendarDays, Sparkles, Filter, Trash2
} from 'lucide-react'
import { useNominaEmpleados, useConfigEmpleados, useActualizarConfigEmpleado, useEliminarConfigEmpleado } from '../../hooks/useNomina'
import useMonedaNomina from '../../hooks/useMonedaNomina.js'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import KpiCard from '../../../compat/components/ui/KpiCard.jsx'

import RateSelector from './RateSelector.jsx'
import EmpleadoConfigModal from './EmpleadoConfigModal'
import ComisionPagoModal from './ComisionPagoModal.jsx'
import EmpleadoBajaModal from './EmpleadoBajaModal.jsx'
import EmpleadoEliminarModal from './EmpleadoEliminarModal.jsx'
import ControlAsistenciaToggle from './ControlAsistenciaToggle.jsx'
import { logClientError } from '../../../compat/utils/errorLogger.js'
import { formatRangoHoras12 } from '../../utils/timeUtils'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { diasLaborablesTexto } from '../../utils/diasLaborables.js'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function esVendedor(config) {
  const cargo = String(config?.cargo || '').toLowerCase()
  return cargo.includes('vendedor') || cargo.includes('ventas')
}

// `esAdmin` (administrarNomina) es lectura: plantilla, montos y vista de Bajas.
// `puedeGestionarNomina` (gestionarUsuarios) habilita alta, edición, baja, reactivación,
// eliminación y el interruptor de asistencia; `puedePagarComision` refleja `operarFinanzas`,
// porque pagar una comisión crea un egreso en Finanzas. El servidor exige exactamente esas
// capacidades, así que el rol de nómina no debe ver ninguno de esos botones.
export default function TabEmpleados({ esAdmin, puedePagarComision = false, puedeGestionarNomina = false }) {
  const { data: allConfigs = [], isLoading, isError, refetch } = useConfigEmpleados({ incluirInactivas: true })
  const { data: clientes = [] } = useNominaEmpleados({ enabled: esAdmin && puedeGestionarNomina })
  const { fmtBs, shortLabelTasa } = useMonedaNomina()
  const actualizarConfig = useActualizarConfigEmpleado()
  const eliminarConfig = useEliminarConfigEmpleado()
  const [modal, setModal] = useState(null)
  const [modalComision, setModalComision] = useState(null)
  const [empleadoParaBaja, setEmpleadoParaBaja] = useState(null)
  const [empleadoParaEliminar, setEmpleadoParaEliminar] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos') // 'todos' | 'fijos' | 'vendedores'
  const [verBajas, setVerBajas] = useState(false)

  const configs = useMemo(() => (allConfigs || []).filter(c => c.activo !== false), [allConfigs])
  const bajas   = useMemo(() => (allConfigs || []).filter(c => c.activo === false), [allConfigs])

  const empleadosYaConfigurados = useMemo(() => {
    return new Set((allConfigs || []).map(c => c.empleado_id))
  }, [allConfigs])

  const sinConfigurar = useMemo(() => {
    if (!esAdmin) return []
    return (clientes || []).filter(c => c.tipo_cliente === 'personal' && c.activo !== false && !empleadosYaConfigurados.has(c.id))
  }, [clientes, empleadosYaConfigurados, esAdmin])

  const filtrados = useMemo(() => {
    if (verBajas) {
      if (!busqueda.trim()) return bajas
      const q = normalizar(busqueda)
      return bajas.filter(c => normalizar(c.empleado?.nombre).includes(q) || normalizar(c.cargo).includes(q))
    }
    let list = configs
    if (filtroTipo === 'fijos') {
      list = list.filter(c => !esVendedor(c))
    } else if (filtroTipo === 'vendedores') {
      list = list.filter(c => esVendedor(c))
    }

    if (!busqueda.trim()) return list
    const q = normalizar(busqueda)
    return list.filter(c => normalizar(c.empleado?.nombre).includes(q) || normalizar(c.cargo).includes(q))
  }, [configs, busqueda, filtroTipo, verBajas, bajas])

  const kpis = useMemo(() => {
    const vendedores = configs.filter(esVendedor)
    const fijos = configs.filter(c => !esVendedor(c))
    const masaDiaria = fijos.reduce((s, c) => s + (Number(c.salario_dia_usd) || 0), 0)
    return {
      total: configs.length,
      fijosCount: fijos.length,
      vendedoresCount: vendedores.length,
      masaDiaria,
      masaSemanal: masaDiaria * 6,
    }
  }, [configs])

  const reactivar = async (config) => {
    try {
      await actualizarConfig.mutateAsync({ id: config.id, activo: true })
    } catch (err) {
      console.error('Error al reactivar empleado:', err)
    }
  }

  // Control de asistencia: solo cambia la visibilidad en la zona de Asistencia.
  // El aviso de las consecuencias lo muestra el propio interruptor antes de apagarlo.
  const cambiarAsistencia = async (config, valor) => {
    try {
      await actualizarConfig.mutateAsync({ id: config.id, controlaAsistencia: valor })
    } catch (err) {
      // El hook ya avisa al usuario con un toast; aquí queda la traza para diagnóstico.
      logClientError({ mensaje: `Error al cambiar el control de asistencia: ${err?.message || err}`, stack: err?.stack, categoria: 'NOMINA_ASISTENCIA' })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <details className="rounded-2xl border border-slate-200 bg-white p-3">
        <summary className="min-h-11 flex items-center cursor-pointer text-sm font-bold text-slate-700">Resumen de plantilla · {kpis.total} empleados</summary>
      <div className={`grid grid-cols-2 gap-3 pt-3 ${esAdmin ? 'sm:grid-cols-4' : 'sm:grid-cols-2'}`}>
        <KpiCard icon={Users} label="Total en plantilla" value={kpis.total} color="indigo" />
        <KpiCard icon={Briefcase} label="Nómina fija semanal" value={kpis.fijosCount} color="green" />
        <KpiCard icon={Sparkles} label="Vendedores (Comisión)" value={kpis.vendedoresCount} sub="Egresos directos" color="amber" />
        {esAdmin && (
          <KpiCard
            icon={DollarSign}
            label="Masa salarial fija / día"
            value={`$${fmt(kpis.masaDiaria)}`}
            sub={`~ ${fmtBs(kpis.masaDiaria)} (${shortLabelTasa})`}
            color="indigo"
          />
        )}
      </div>
      </details>

      {puedeGestionarNomina && sinConfigurar.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2.5">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <p className="text-xs text-amber-900 flex-1">
            <strong>{sinConfigurar.length}</strong> trabajador{sinConfigurar.length !== 1 ? 'es' : ''} sin configurar en nómina.
          </p>
          <button
            type="button"
            onClick={() => setModal({ modo: 'crear' })}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold"
          >
            Configurar
          </button>
        </div>
      )}

      {/* Barra de Filtros y Acciones */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar empleado o cargo..."
              aria-label="Buscar empleado o cargo"
              className="w-full min-h-11 pl-9 pr-3 py-2 rounded-xl border border-slate-300 bg-white text-base focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {esAdmin && bajas.length > 0 && (
            <button
              type="button"
              onClick={() => setVerBajas(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all border ${verBajas ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              title="Ver empleados dados de baja"
            >
              Bajas ({bajas.length})
            </button>
          )}

          {/* Filtro por tipo de contrato */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => { setFiltroTipo('todos'); setVerBajas(false) }}
              className={`px-2.5 py-1.5 rounded-lg transition-all ${filtroTipo === 'todos' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Todos ({configs.length})
            </button>
            <button
              type="button"
              onClick={() => { setFiltroTipo('fijos'); setVerBajas(false) }}
              className={`px-2.5 py-1.5 rounded-lg transition-all ${filtroTipo === 'fijos' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Nómina Fija ({kpis.fijosCount})
            </button>
            <button
              type="button"
              onClick={() => { setFiltroTipo('vendedores'); setVerBajas(false) }}
              className={`px-2.5 py-1.5 rounded-lg transition-all ${filtroTipo === 'vendedores' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Vendedores ({kpis.vendedoresCount})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <div className="hidden xl:flex items-center gap-1">
            <span className="text-[11px] text-slate-400 font-medium">Tasa:</span>
            <RateSelector light />
          </div>

          {puedePagarComision && kpis.vendedoresCount > 0 && (
            <button
              type="button"
              onClick={() => setModalComision({})}
              className="flex items-center gap-1.5 text-amber-900 bg-amber-100 hover:bg-amber-200 font-black text-xs px-3.5 py-2 rounded-xl transition-all shadow-xs active:scale-95 border border-amber-300"
              title="Registrar comisión a un vendedor"
            >
              <DollarSign size={14} className="text-amber-700" />
              <span>Pagar Comisión</span>
            </button>
          )}

          {puedeGestionarNomina && (
            <button
              type="button"
              onClick={() => setModal({ modo: 'crear' })}
              className="flex items-center gap-1.5 text-white font-black text-xs px-3.5 py-2 rounded-xl transition-all shadow-md shadow-primary/20 hover:brightness-110 active:scale-95 bg-primary"
            >
              <Plus size={14} />
              <span>Nuevo Empleado</span>
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          No se pudieron cargar los empleados. <button type="button" onClick={() => refetch()} className="underline font-bold">Volver a intentar</button>
        </div>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={Users}
          title={verBajas
            ? (busqueda.trim() ? 'Sin resultados' : 'Sin empleados dados de baja')
            : configs.length === 0 ? 'No hay empleados en nómina' : 'Sin resultados'}
          description={verBajas
            ? (busqueda.trim() ? 'Prueba con otro término de búsqueda.' : 'Los empleados que des de baja aparecerán aquí y podrás reactivarlos.')
            : configs.length === 0 ? 'Registra aquí al empleado para configurar su salario y jornada o puesto de vendedor.' : 'Prueba con otro término de búsqueda o filtro.'}
          actionLabel={!verBajas && configs.length === 0 && puedeGestionarNomina ? 'Agregar a nómina' : undefined}
          onAction={!verBajas && configs.length === 0 && puedeGestionarNomina ? () => setModal({ modo: 'crear' }) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {verBajas ? filtrados.map(c => (
            <EmpleadoBajaCard
              key={c.id}
              config={c}
              puedeGestionar={puedeGestionarNomina}
              cargando={actualizarConfig.isPending || eliminarConfig.isPending}
              onReactivar={() => reactivar(c)}
              onEliminar={() => setEmpleadoParaEliminar(c)}
            />
          )) : filtrados.map(c => (
            <EmpleadoNominaCard
              key={c.id}
              config={c}
              esAdmin={esAdmin}
              puedeGestionar={puedeGestionarNomina}
              puedePagarComision={puedePagarComision}
              mostrarMontos={esAdmin}
              cargando={actualizarConfig.isPending}
              onEditar={() => setModal({ modo: 'editar', config: c })}
              onPagarComision={() => setModalComision(c)}
              onDarDeBaja={() => setEmpleadoParaBaja(c)}
              onCambiarAsistencia={valor => cambiarAsistencia(c, valor)}
            />
          ))}
        </div>
      )}

      {modal && (
        <EmpleadoConfigModal
          modo={modal.modo}
          config={modal.config}
          empleadosYaEnNomina={Array.from(empleadosYaConfigurados)}
          onClose={() => setModal(null)}
        />
      )}

      {modalComision && (
        <ComisionPagoModal
          empleadoInicial={modalComision}
          onClose={() => setModalComision(null)}
          onSuccess={() => refetch()}
        />
      )}

      {empleadoParaBaja && (
        <EmpleadoBajaModal
          isOpen
          empleado={empleadoParaBaja}
          onClose={() => setEmpleadoParaBaja(null)}
          onConfirm={async () => {
            try {
              await actualizarConfig.mutateAsync({ id: empleadoParaBaja.id, activo: false })
              setEmpleadoParaBaja(null)
            } catch (err) {
              console.error('Error al dar de baja al empleado:', err)
            }
          }}
          cargando={actualizarConfig.isPending}
        />
      )}

      {empleadoParaEliminar && (
        <EmpleadoEliminarModal
          isOpen
          empleado={empleadoParaEliminar}
          onClose={() => setEmpleadoParaEliminar(null)}
          onConfirm={async options => {
            await eliminarConfig.mutateAsync({ id: empleadoParaEliminar.id, ...options })
            setEmpleadoParaEliminar(null)
          }}
          cargando={eliminarConfig.isPending}
        />
      )}
    </div>
  )
}

function EmpleadoBajaCard({ config, puedeGestionar, cargando, onReactivar, onEliminar }) {
  const nombre = capitalizarPalabras(config.empleado?.nombre) || 'Sin nombre'
  return (
    <article className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden min-w-0 opacity-90">
      <div className="shrink-0 px-3 py-2.5 rounded-t-2xl bg-slate-400">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-white/20 border border-white/30 flex items-center justify-center shrink-0">
              <Users size={14} className="text-white" />
            </span>
            <p className="font-black text-white leading-tight truncate text-sm" title={nombre}>{nombre}</p>
          </div>
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-slate-700 text-white shrink-0">
            Dado de baja
          </span>
        </div>
        <p className="text-[11px] text-white/80 mt-1 truncate">{config.cargo || 'Sin cargo asignado'}</p>
      </div>

      <div className="px-3 py-2.5 text-xs text-slate-500 flex-1">
        Sin acceso a asistencia, períodos ni pagos mientras esté de baja.
      </div>

      {puedeGestionar && (
        <div className="border-t border-slate-100 px-3 py-2 bg-white flex items-center gap-2">
          <button
            type="button"
            onClick={onReactivar}
            disabled={cargando}
            style={{ touchAction: 'manipulation' }}
            className="flex-1 min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 transition-colors disabled:opacity-50 cursor-pointer"
            title="Volver a activar en la nómina"
          >
            <RotateCcw size={14} />
            <span>Reactivar</span>
          </button>
          <button
            type="button"
            onClick={onEliminar}
            disabled={cargando}
            style={{ touchAction: 'manipulation' }}
            className="min-h-11 px-3 py-2 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5 cursor-pointer"
            title="Eliminar definitivamente de la nómina si no tiene historial"
          >
            <Trash2 size={14} />
            <span>Eliminar</span>
          </button>
        </div>
      )}
    </article>
  )
}

function EmpleadoNominaCard({ config, esAdmin, puedeGestionar = false, puedePagarComision = false, mostrarMontos = true, cargando = false, onEditar, onPagarComision, onDarDeBaja, onCambiarAsistencia }) {
  const { fmtBs } = useMonedaNomina()
  const nombre = capitalizarPalabras(config.empleado?.nombre) || 'Sin nombre'
  const salarioDia = Number(config.salario_dia_usd) || 0
  const esVendedorRol = esVendedor(config)
  const tarifaHora = salarioDia / (Number(config.horas_jornada) || 8)
  const color = esVendedorRol ? '#0d2238' : '#1B365D'

  return (
    <article className="group bg-white rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-200 flex flex-col overflow-hidden min-w-0">
      <div className="relative shrink-0 flex flex-col gap-1.5 px-3 py-2.5 rounded-t-2xl overflow-hidden" style={{ background: `linear-gradient(135deg, ${color} 0%, #315782 100%)` }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
        <div className="relative z-10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
              <Briefcase size={14} className="text-white" />
            </span>
            <p className="font-black text-white leading-tight truncate text-sm" title={nombre}>{nombre}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {config.pos_vendedor_id && (
              <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-black bg-white/20 text-white border border-white/30" title="Vinculado al POS">
                POS
              </span>
            )}
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shrink-0 ${esVendedorRol ? 'bg-amber-500' : 'bg-emerald-500/90'}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              {esVendedorRol ? 'Vendedor' : 'Activo'}
            </span>
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-1.5 text-[11px] text-white/75">
          <Users size={11} />{config.cargo || 'Sin cargo asignado'}
        </div>
      </div>

      <div className="px-3 pt-2 pb-1.5 space-y-1.5 text-xs text-slate-500">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <CalendarDays size={11} />Ingreso: {config.fecha_ingreso || 'Sin fecha'}
        </div>
        {!esVendedorRol && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Clock size={11} />Jornada: {Number(config.horas_jornada) || 0}h ({formatRangoHoras12(config.hora_inicio || '08:00', config.hora_fin || '17:00')})
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <CalendarDays size={11} />Trabaja: {diasLaborablesTexto(config.dias_laborables)}
          {config.horario_configurado === false && (
            <span className="text-[10px] font-bold text-amber-700">(sin fijar)</span>
          )}
        </div>
        {puedeGestionar && (
          <ControlAsistenciaToggle
            config={config}
            cargando={cargando}
            onCambiar={onCambiarAsistencia}
          />
        )}
      </div>

      {mostrarMontos && (
        esVendedorRol ? (
          <div className="mx-3 mb-2 rounded-xl bg-amber-500/[0.08] border border-amber-500/20 p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-amber-900 font-black uppercase flex items-center gap-1">
                <Sparkles size={12} className="text-amber-600" />
                Ventas y Comisiones
              </span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-200/60 text-amber-900">
                Cobro por comisión
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-tight">
              Ingresos variables liquidados como egresos de comisiones.
            </p>
          </div>
        ) : (
          <div className="mx-3 mb-2 rounded-xl bg-slate-50 border border-slate-100 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-bold uppercase">Salario / día</span>
              <div className="text-right">
                <span className="text-sm font-black text-amber-600 block">${fmt(salarioDia)}</span>
                <span className="text-[10px] text-slate-400 font-mono block">{fmtBs(salarioDia)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
              <span className="text-[10px] text-slate-400">Tarifa / hora</span>
              <span className="text-xs font-bold text-slate-600 font-mono">${fmt(tarifaHora)}</span>
            </div>
          </div>
        )
      )}

      {(puedeGestionar || (esVendedorRol && puedePagarComision)) && (
        <div className={`mt-auto border-t border-slate-100 px-3 py-2 bg-white flex items-center ${esVendedorRol ? 'justify-between' : 'justify-end'} gap-1.5`}>
          {esVendedorRol && puedePagarComision && (
            <button
              type="button"
              onClick={onPagarComision}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-black text-amber-900 bg-amber-100 hover:bg-amber-200 transition-colors border border-amber-300 shadow-2xs"
              title="Registrar pago de comisión a este vendedor"
            >
              <DollarSign size={13} className="text-amber-700" />
              <span>Pagar Comisión</span>
            </button>
          )}

          {puedeGestionar && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onDarDeBaja}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Dar de baja de la nómina"
            >
              <Trash2 size={12} />
              <span className="hidden sm:inline">Baja</span>
            </button>

            <button
              type="button"
              onClick={onEditar}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:text-sky-700 hover:bg-sky-50 transition-colors"
            >
              <Pencil size={12} />
              <span>Configurar</span>
            </button>
          </div>
          )}
        </div>
      )}
    </article>
  )
}

