import { useMemo, useState } from 'react'
import { LogIn, LogOut, RefreshCw } from 'lucide-react'
import useAuthStore from '../../../compat/store/useAuthStore.js'
import {
  useConfigEmpleados, useMarcajeHoy, useMarcarEntrada, useMarcarSalida,
} from '../../hooks/useNomina'

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
    <div className="bg-white border border-primary/20 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-800">Marcaje operativo</h3>
          <p className="text-xs text-slate-500">Administración registra por el empleado. La hora la fija el servidor.</p>
        </div>
        <button onClick={() => refetch()} disabled={isFetching} title="Actualizar marcajes"
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
        <select value={empleadoId} onChange={e => setEmpleadoId(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800">
          <option value="">Seleccionar empleado</option>
          {empleados.map(emp => (
            <option key={emp.empleado_id} value={emp.empleado_id}>
              {emp.empleado?.nombre || 'Empleado'}
            </option>
          ))}
        </select>
        <button
          onClick={() => marcarEntrada.mutate({ empleadoId })}
          disabled={!empleadoId || entradaMarcada || ocupado}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40">
          <LogIn size={14} /> Entrada
        </button>
        <button
          onClick={() => marcarSalida.mutate({ empleadoId })}
          disabled={!empleadoId || !entradaMarcada || salidaMarcada || ocupado}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-700 text-white text-xs font-bold disabled:opacity-40">
          <LogOut size={14} /> Salida
        </button>
      </div>

      {registro && (
        <p className="text-xs text-slate-500">
          Hoy: entrada <strong>{registro.hora_entrada || '—'}</strong>
          {' · '}salida <strong>{registro.hora_salida || 'pendiente'}</strong>
        </p>
      )}
    </div>
  )
}
