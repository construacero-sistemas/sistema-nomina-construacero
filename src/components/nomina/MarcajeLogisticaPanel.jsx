// src/components/nomina/MarcajeLogisticaPanel.jsx
// Panel operativo de marcaje rápido en tiempo real para el día de hoy.
import { useMemo, useState } from 'react'
import { LogIn, LogOut, RefreshCw, Clock, CheckCircle2 } from 'lucide-react'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import useAuthStore from '../../../compat/store/useAuthStore.js'
import {
  useConfigEmpleados, useMarcajeHoy, useMarcarEntrada, useMarcarSalida,
} from '../../hooks/useNomina'

function fmtHora(h) {
  if (!h) return ''
  return String(h).slice(0, 5)
}

export default function MarcajeLogisticaPanel() {
  const perfil = useAuthStore(state => state.perfil)
  const esAdmin = perfil?.rol === 'administracion'
  const { data: empleados = [] } = useConfigEmpleados()
  const { data, isFetching, refetch } = useMarcajeHoy()
  const marcarEntrada = useMarcarEntrada()
  const marcarSalida = useMarcarSalida()
  const [empleadoId, setEmpleadoId] = useState('')

  const registros = useMemo(
    () => new Map((data?.registros || []).map(r => [r.empleado_id, r])),
    [data?.registros],
  )
  if (!esAdmin) return null

  const registro = empleadoId ? registros.get(empleadoId) : null
  const entradaMarcada = !!registro?.hora_entrada
  const salidaMarcada = !!registro?.hora_salida
  const ocupado = marcarEntrada.isPending || marcarSalida.isPending

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Clock size={16} />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-800">Registrar asistencia de hoy</h3>
            <p className="text-xs text-slate-500">Selecciona un empleado. La hora se toma automáticamente al marcar.</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Actualizar asistencia de hoy"
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} aria-hidden="true" />
          <span>Actualizar</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2.5">
        <CustomSelect
          value={empleadoId}
          onChange={setEmpleadoId}
          placeholder="Selecciona un empleado para marcar"
          options={empleados.map(emp => ({ value: emp.empleado_id, label: emp.empleado?.nombre || 'Empleado' }))}
        />
        <button
          onClick={() => marcarEntrada.mutate({ empleadoId })}
          disabled={!empleadoId || entradaMarcada || ocupado}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-40 shadow-sm transition-all active:scale-95">
          <LogIn size={14} />
          <span>{marcarEntrada.isPending ? 'Marcando...' : 'Entrada'}</span>
        </button>
        <button
          onClick={() => marcarSalida.mutate({ empleadoId })}
          disabled={!empleadoId || !entradaMarcada || salidaMarcada || ocupado}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold disabled:opacity-40 shadow-sm transition-all active:scale-95">
          <LogOut size={14} />
          <span>{marcarSalida.isPending ? 'Marcando...' : 'Salida'}</span>
        </button>
      </div>

      {empleadoId && (
        <div className="pt-1">
          {registro ? (
            <div className={`p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${salidaMarcada ? 'bg-slate-50 border-slate-200' : 'bg-emerald-50/70 border-emerald-200'}`}>
              <div className="flex items-center gap-2">
                {!salidaMarcada ? (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                ) : (
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                )}
                <span className="font-semibold text-slate-700">
                  {!salidaMarcada ? 'Jornada en curso' : 'Jornada completa'}
                </span>
              </div>
              <div className="text-slate-600 font-medium flex items-center gap-3 text-[11px]">
                <span>Entrada: <strong className="text-slate-800">{fmtHora(registro.hora_entrada)}</strong></span>
                <span>·</span>
                <span>Salida: <strong className={registro.hora_salida ? 'text-slate-800' : 'text-amber-600'}>{registro.hora_salida ? fmtHora(registro.hora_salida) : 'Pendiente'}</strong></span>
                {Number(registro.horas_trabajadas) > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-emerald-700 font-bold">{Number(registro.horas_trabajadas).toFixed(1)}h trabajadas</span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-300" />
              <span>Sin marcaje registrado hoy para este empleado. Puedes pulsar <strong>Entrada</strong> para iniciar su jornada.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
