// src/components/nomina/TabEmpleados.jsx
// Gestión de la configuración de nómina por empleado (salario/día, jornada, horario).
import { useState, useMemo } from 'react'
import { Users, Plus, Pencil, DollarSign, Clock, Briefcase, Search, AlertTriangle } from 'lucide-react'
import { useNominaEmpleados, useConfigEmpleados } from '../../hooks/useNomina'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import EmpleadoConfigModal from './EmpleadoConfigModal'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function TabEmpleados({ esAdmin }) {
  const { data: configs = [], isLoading, isError, refetch } = useConfigEmpleados()
  // Solo administración necesita detectar pendientes: es quien puede configurarlos.
  // Logística no necesita descargar otra lista: ya recibe el nombre dentro de config-empleados.
  const { data: clientes = [] } = useNominaEmpleados({ enabled: esAdmin })
  const [modal, setModal] = useState(null) // { modo: 'crear'|'editar', config }
  const [busqueda, setBusqueda] = useState('')

  // Trabajadores dados de alta en Personal que aún no entran en el cálculo de nómina.
  const sinConfigurar = useMemo(() => {
    if (!esAdmin) return []
    const yaEn = new Set(configs.map(c => c.empleado_id))
    return (clientes || []).filter(c =>
      c.tipo_cliente === 'personal' && c.activo !== false && !yaEn.has(c.id)
    )
  }, [clientes, configs, esAdmin])

  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return configs
    const q = normalizar(busqueda)
    return configs.filter(c =>
      normalizar(c.empleado?.nombre).includes(q) ||
      normalizar(c.cargo).includes(q)
    )
  }, [configs, busqueda])

  const kpis = useMemo(() => {
    const masaDiaria = filtrados.reduce((s, c) => s + (Number(c.salario_dia_usd) || 0), 0)
    return {
      total: filtrados.length,
      masaDiaria,
      masaSemanal: masaDiaria * 6, // lunes a sábado
    }
  }, [filtrados])

  return (
    <div className="space-y-4">
      {/* KPIs — la masa salarial solo para quien gestiona el pago */}
      <div className={`grid grid-cols-1 gap-3 ${esAdmin ? 'sm:grid-cols-3' : ''}`}>
        <KpiCard icon={Users} label="Empleados en nómina" value={kpis.total} color="indigo" />
        {esAdmin && (
          <>
            <KpiCard icon={DollarSign} label="Masa salarial / día" value={`$${fmt(kpis.masaDiaria)}`} color="amber" />
            <KpiCard icon={DollarSign} label="Estimado semanal (6d)" value={`$${fmt(kpis.masaSemanal)}`} color="green" />
          </>
        )}
      </div>

      {/* Aviso: trabajadores de Personal que aún no entran en el cálculo */}
      {sinConfigurar.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2.5">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <p className="text-xs text-amber-900 flex-1">
            <strong>{sinConfigurar.length}</strong>{' '}
            trabajador{sinConfigurar.length !== 1 ? 'es' : ''} sin configurar en nómina.
            No entrar{sinConfigurar.length !== 1 ? 'án' : 'á'} en el cálculo del período.
          </p>
          <button onClick={() => setModal({ modo: 'crear' })}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors">
            Configurar
          </button>
        </div>
      )}

      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar empleado o cargo..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        {esAdmin && (
          <button
            onClick={() => setModal({ modo: 'crear' })}
            className="ml-auto flex items-center gap-2 text-white font-bold text-sm px-4 py-2 rounded-xl transition-all shadow-lg active:scale-[0.98] whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
            <Plus size={16} />
            Agregar empleado
          </button>
        )}
      </div>

      {/* Contenido */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Error al cargar empleados. <button onClick={() => refetch()} className="underline font-bold">Reintentar</button>
        </div>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={Users}
          title={configs.length === 0 ? 'No hay empleados en nómina' : 'Sin resultados'}
          description={
            configs.length === 0
              ? 'Agrega empleados del módulo Personal para configurar su salario y jornada.'
              : 'Prueba con otro término de búsqueda.'
          }
          actionLabel={configs.length === 0 && esAdmin ? 'Agregar empleado' : undefined}
          onAction={configs.length === 0 && esAdmin ? () => setModal({ modo: 'crear' }) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtrados.map(c => (
            <EmpleadoNominaCard
              key={c.id}
              config={c}
              esAdmin={esAdmin}
              mostrarMontos={esAdmin}
              onEditar={() => setModal({ modo: 'editar', config: c })}
            />
          ))}
        </div>
      )}

      {modal && (
        <EmpleadoConfigModal
          modo={modal.modo}
          config={modal.config}
          empleadosYaEnNomina={configs.map(c => c.empleado_id)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function EmpleadoNominaCard({ config, esAdmin, mostrarMontos = true, onEditar }) {
  const nombre = config.empleado?.nombre || 'Sin nombre'
  const tarifaHora = (Number(config.salario_dia_usd) || 0) / (Number(config.horas_jornada) || 8)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col hover:shadow-lg transition-all">
      {/* Cabecera */}
      <div className="px-4 pt-3.5 pb-2.5 border-b border-slate-100">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
            <Briefcase size={15} className="text-indigo-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-black text-slate-800 text-sm leading-tight truncate">{nombre}</p>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">
              {config.cargo || 'Sin cargo asignado'}
            </p>
          </div>
        </div>
      </div>

      {/* Datos */}
      <div className="px-4 py-3 space-y-2 flex-1">
        {mostrarMontos && (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Salario / día</span>
              <span className="text-base font-black text-amber-600">${fmt(config.salario_dia_usd)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Tarifa / hora</span>
              <span className="text-xs font-bold text-slate-600">${fmt(tarifaHora)}</span>
            </div>
          </>
        )}
        <div className={`flex items-center justify-between ${mostrarMontos ? 'pt-1.5 border-t border-slate-50' : ''}`}>
          <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
            <Clock size={10} /> Jornada
          </span>
          <span className="text-[11px] font-semibold text-slate-600">
            {Number(config.horas_jornada)}h · {String(config.hora_inicio).slice(0, 5)}–{String(config.hora_fin).slice(0, 5)}
          </span>
        </div>
      </div>

      {/* Acción */}
      {esAdmin && (
        <div className="border-t border-slate-100 px-3 py-2">
          <button onClick={onEditar}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 transition-colors">
            <Pencil size={13} />
            Configurar
          </button>
        </div>
      )}
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, color }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-700',
    amber:  'bg-amber-50 text-amber-700',
    green:  'bg-green-50 text-green-700',
  }
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon size={16} />
        </div>
        <span className="text-xs text-slate-500 font-medium">{label}</span>
      </div>
      <div className="text-lg font-black text-slate-800">{value}</div>
    </div>
  )
}
