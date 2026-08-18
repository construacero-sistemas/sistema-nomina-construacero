// src/components/nomina/EmpleadoConfigModal.jsx
// Alta/edición de la configuración de nómina de un empleado.
import { useState, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { useNominaEmpleados, useCrearConfigEmpleado, useActualizarConfigEmpleado } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

export default function EmpleadoConfigModal({ modo, config, empleadosYaEnNomina = [], onClose }) {
  const esEdicion = modo === 'editar'
  const crear      = useCrearConfigEmpleado()
  const actualizar = useActualizarConfigEmpleado()

  const {
    data: clientes = [],
    isLoading: clientesCargando,
    isError: clientesError,
    refetch: recargarClientes,
  } = useNominaEmpleados()

  const [empleadoId, setEmpleadoId] = useState(config?.empleado_id ?? '')
  const [cargo, setCargo]           = useState(config?.cargo ?? '')
  const [fechaIngreso, setFechaIngreso] = useState(config?.fecha_ingreso ?? '')
  const [salarioDia, setSalarioDia] = useState(config?.salario_dia_usd ?? '')
  const [horasJornada, setHorasJornada] = useState(config?.horas_jornada ?? 8)
  const [horaInicio, setHoraInicio] = useState(String(config?.hora_inicio ?? '08:00').slice(0, 5))
  const [horaFin, setHoraFin]       = useState(String(config?.hora_fin ?? '17:00').slice(0, 5))
  const [activo, setActivo]         = useState(config?.activo ?? true)
  const [error, setError]           = useState('')

  // Solo empleados (tipo_cliente = 'personal') que aún no estén en nómina.
  // Esta pantalla configura una ficha existente; no crea personas en Personal.
  const empleadosPersonales = useMemo(() => (
    (clientes || []).filter(c => c.tipo_cliente === 'personal' && c.activo !== false)
  ), [clientes])

  const opcionesEmpleados = useMemo(() => (
    empleadosPersonales
      .filter(c => !empleadosYaEnNomina.includes(c.id))
      .map(c => ({ value: c.id, label: c.nombre }))
  ), [empleadosPersonales, empleadosYaEnNomina])

  const tarifaHora = (Number(salarioDia) || 0) / (Number(horasJornada) || 8)
  const cargando = crear.isPending || actualizar.isPending

  async function guardar(e) {
    if (e) e.preventDefault()
    setError('')

    if (!esEdicion && !empleadoId) { setError('Selecciona un empleado'); return }
    if (Number(salarioDia) <= 0)   { setError('El salario por día debe ser mayor a 0'); return }
    if (Number(horasJornada) <= 0) { setError('La jornada debe ser mayor a 0 horas'); return }

    try {
      if (esEdicion) {
        await actualizar.mutateAsync({
          id: config.id,
          cargo, fechaIngreso: fechaIngreso || null,
          salarioDiaUsd: Number(salarioDia),
          horasJornada:  Number(horasJornada),
          horaInicio, horaFin, activo,
        })
      } else {
        await crear.mutateAsync({
          empleadoId, cargo, fechaIngreso: fechaIngreso || null,
          salarioDiaUsd: Number(salarioDia),
          horasJornada:  Number(horasJornada),
          horaInicio, horaFin,
        })
      }
      onClose()
    } catch (err) {
      setError(err.message || 'Error al guardar')
    }
  }

  return (
    <Modal
      isOpen onClose={onClose}
      title={esEdicion ? `Configurar: ${config?.empleado?.nombre ?? 'empleado'}` : 'Agregar empleado a nómina'}
      className="max-w-lg">
      <form onSubmit={guardar} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Selector de empleado (solo al crear) */}
        {!esEdicion && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Empleado *</label>
            {clientesCargando ? (
              <div className="text-xs text-slate-400 py-2">Cargando empleados...</div>
            ) : clientesError ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800" role="alert">
                <p>No se pudo cargar el personal disponible.</p>
                <button
                  type="button"
                  onClick={() => recargarClientes()}
                  disabled={cargando}
                  className="mt-2 inline-flex items-center gap-1.5 text-red-700 font-bold hover:text-red-900 disabled:opacity-50"
                >
                  <RefreshCw size={13} />
                  Reintentar
                </button>
              </div>
            ) : opcionesEmpleados.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800" role="status">
                <p>
                  {empleadosPersonales.length === 0
                    ? 'No hay empleados disponibles.'
                    : 'Todos los empleados de Personal ya están configurados en nómina.'}
                </p>
                <p className="mt-1 text-amber-700">
                  Este formulario solo configura una persona existente; no crea fichas nuevas.
                  {empleadosPersonales.length === 0 && <> Registra primero al personal en la sección <strong>Personal</strong> con tipo de cliente <strong>personal</strong>.</>}
                </p>
                <button
                  type="button"
                  onClick={() => recargarClientes()}
                  disabled={cargando}
                  className="mt-2 inline-flex items-center gap-1.5 text-amber-800 font-bold hover:text-amber-950 disabled:opacity-50"
                >
                  <RefreshCw size={13} />
                  Actualizar lista
                </button>
              </div>
            ) : (
              <CustomSelect
                value={empleadoId}
                onChange={setEmpleadoId}
                options={opcionesEmpleados}
                placeholder="Selecciona un empleado..."
                disabled={cargando}
              />
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Cargo</label>
            <input
              type="text" value={cargo} onChange={e => setCargo(e.target.value)}
              placeholder="Ej: Almacenista, Chofer"
              className={inputCls} disabled={cargando}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Fecha de ingreso</label>
            <input
              type="date" value={fechaIngreso} onChange={e => setFechaIngreso(e.target.value)}
              className={inputCls} disabled={cargando}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Salario por día (USD) *</label>
            <input
              type="number" min="0" step="0.01" value={salarioDia}
              onChange={e => setSalarioDia(e.target.value)}
              placeholder="30.00"
              className={inputCls} disabled={cargando}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Horas de jornada *</label>
            <input
              type="number" min="1" max="24" step="0.5" value={horasJornada}
              onChange={e => setHorasJornada(e.target.value)}
              className={inputCls} disabled={cargando}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Hora de entrada</label>
            <input
              type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)}
              className={inputCls} disabled={cargando}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Hora de salida</label>
            <input
              type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)}
              className={inputCls} disabled={cargando}
            />
          </div>
        </div>

        {/* Preview de tarifa */}
        {Number(salarioDia) > 0 && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
            Tarifa base: <strong className="text-slate-800">${tarifaHora.toFixed(2)}/hora</strong>
            {' '}· Los recargos por hora extra, sábado y feriado se aplican con los factores
            configurados en Configuración → Nómina.
          </div>
        )}

        {/* Activo (solo al editar) */}
        {esEdicion && (
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer w-fit">
            <input
              type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)}
              disabled={cargando}
              className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
            />
            Activo en nómina
            <span className="text-[11px] text-slate-400 font-normal">
              (si se desactiva, no entra en nuevos períodos)
            </span>
          </label>
        )}
      </form>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
        <button onClick={onClose} type="button" disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button
          onClick={guardar}
          disabled={cargando || (!esEdicion && opcionesEmpleados.length === 0)}
          title={!esEdicion && opcionesEmpleados.length === 0 ? 'Primero registra o sincroniza un empleado de Personal' : undefined}
          className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-bold"
        >
          {cargando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}
