// src/components/nomina/EmpleadoConfigModal.jsx
// Alta/edición intuitiva de la configuración salarial y de jornada de un empleado.
import { useState, useMemo, useEffect } from 'react'
import { RefreshCw, Clock, DollarSign, Calendar, Sparkles } from 'lucide-react'
import { useNominaEmpleados, useCrearConfigEmpleado, useActualizarConfigEmpleado } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all'

const PREF_KEY_PREFIX = 'nomina_empleado_salario_pref_'

function getSavedSalaryPref(id) {
  if (!id) return null
  try {
    const raw = localStorage.getItem(`${PREF_KEY_PREFIX}${id}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveSalaryPref(id, pref) {
  if (!id || !pref) return
  try {
    localStorage.setItem(`${PREF_KEY_PREFIX}${id}`, JSON.stringify(pref))
  } catch {
    // Ignore storage errors
  }
}

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
  const [nombre, setNombre] = useState(config?.empleado?.nombre ?? '')
  const [documento, setDocumento] = useState(config?.empleado?.documento ?? '')
  const [cargo, setCargo]           = useState(config?.cargo ?? '')
  const [fechaIngreso, setFechaIngreso] = useState(config?.fecha_ingreso ?? '')

  const empKey = config?.empleado_id || config?.id
  const savedPref = useMemo(() => getSavedSalaryPref(empKey), [empKey])

  // Modalidad salarial persistente: 'dia' | 'semana' | 'mes' | 'comision'
  const [modalidad, setModalidad] = useState(() => savedPref?.modalidad || (Number(config?.salario_dia_usd) === 0 ? 'comision' : 'dia'))
  const [diasSemana, setDiasSemana] = useState(() => (savedPref?.diasSemana ? Number(savedPref.diasSemana) : 6))

  const [montoInput, setMontoInput] = useState(() => {
    const daily = Number(config?.salario_dia_usd)
    if (!Number.isFinite(daily) || daily <= 0) {
      if (savedPref?.modalidad === 'comision' || daily === 0) return '0'
      return ''
    }
    const mod = savedPref?.modalidad || 'dia'
    const ds = Number(savedPref?.diasSemana) || 6

    if (mod === 'semana') {
      if (savedPref?.montoInput) {
        const testDaily = Number(savedPref.montoInput) / ds
        if (Math.abs(testDaily - daily) < 0.005) return String(savedPref.montoInput)
      }
      const weekly = Math.round(daily * ds * 100) / 100
      return String(weekly)
    }

    if (mod === 'mes') {
      if (savedPref?.montoInput) {
        const testDaily = Number(savedPref.montoInput) / 30
        if (Math.abs(testDaily - daily) < 0.005) return String(savedPref.montoInput)
      }
      const monthly = Math.round(daily * 30 * 100) / 100
      return String(monthly)
    }

    return String(daily)
  })

  const [horasJornada, setHorasJornada] = useState(config?.horas_jornada ?? 8)
  const [horaInicio, setHoraInicio] = useState(String(config?.hora_inicio ?? '08:00').slice(0, 5))
  const [horaFin, setHoraFin]       = useState(String(config?.hora_fin ?? '17:00').slice(0, 5))
  const [activo, setActivo]         = useState(config?.activo ?? true)
  const [error, setError]           = useState('')

  // Cálculo del salario diario en USD según la modalidad elegida
  const salarioDiaCalculado = useMemo(() => {
    if (modalidad === 'comision') return 0
    const val = Number(montoInput)
    if (!Number.isFinite(val) || val <= 0) return 0
    if (modalidad === 'semana') return val / (diasSemana || 6)
    if (modalidad === 'mes') return val / 30
    return val
  }, [montoInput, modalidad, diasSemana])

  function handleCambioModalidad(nuevoModo) {
    if (nuevoModo === modalidad) return
    if (nuevoModo === 'comision') {
      setMontoInput('0')
    } else if (salarioDiaCalculado > 0 || (modalidad === 'comision' && Number(montoInput) === 0)) {
      const baseDaily = salarioDiaCalculado > 0 ? salarioDiaCalculado : 10
      if (nuevoModo === 'semana') {
        const nuevoMonto = Math.round(baseDaily * (diasSemana || 6) * 100) / 100
        setMontoInput(String(nuevoMonto))
      } else if (nuevoModo === 'mes') {
        const nuevoMonto = Math.round(baseDaily * 30 * 100) / 100
        setMontoInput(String(nuevoMonto))
      } else if (nuevoModo === 'dia') {
        const nuevoMonto = Math.round(baseDaily * 100) / 100
        setMontoInput(String(nuevoMonto))
      }
    }
    setModalidad(nuevoModo)
  }

  const jornadaNum = Number(horasJornada) || 8
  const tarifaHora = salarioDiaCalculado > 0 && jornadaNum > 0 ? salarioDiaCalculado / jornadaNum : 0
  const equivalenteSemanal = salarioDiaCalculado * (diasSemana || 6)
  const equivalenteMensual = salarioDiaCalculado * 30

  // Personas existentes que aún no estén en nómina
  const empleadosPersonales = useMemo(() => (
    (clientes || []).filter(c => c.tipo_cliente === 'personal' && c.activo !== false)
  ), [clientes])

  const opcionesEmpleados = useMemo(() => (
    empleadosPersonales
      .filter(c => !empleadosYaEnNomina.includes(c.id))
      .map(c => ({ value: c.id, label: c.nombre }))
  ), [empleadosPersonales, empleadosYaEnNomina])

  const cargando = crear.isPending || actualizar.isPending

  function aplicarPresetHorarioEstandar() {
    setHoraInicio('08:00')
    setHoraFin('17:00')
    setHorasJornada(8)
  }

  async function guardar(e) {
    if (e) e.preventDefault()
    setError('')

    if (!esEdicion && !empleadoId && !nombre.trim()) { setError('Escribe el nombre del empleado'); return }
    if (modalidad !== 'comision' && salarioDiaCalculado <= 0) { setError('El salario debe ser mayor a 0'); return }
    if (modalidad !== 'comision' && Number(horasJornada) <= 0) { setError('La jornada debe ser mayor a 0 horas'); return }

    try {
      const salarioFinal = modalidad === 'comision' ? 0 : Math.round(salarioDiaCalculado * 10000) / 10000
      const prefData = {
        modalidad,
        montoInput,
        diasSemana,
      }
      if (esEdicion) {
        const res = await actualizar.mutateAsync({
          id: config.id,
          cargo, fechaIngreso: fechaIngreso || null,
          salarioDiaUsd: salarioFinal,
          horasJornada:  Number(horasJornada) || 8,
          horaInicio, horaFin, activo,
        })
        const targetId = res?.config?.empleado_id || config?.empleado_id || config?.id
        saveSalaryPref(targetId, prefData)
        if (config?.id) saveSalaryPref(config.id, prefData)
        if (config?.empleado_id) saveSalaryPref(config.empleado_id, prefData)
      } else {
        const res = await crear.mutateAsync({
          empleadoId: empleadoId || undefined, nombre, documento, cargo, fechaIngreso: fechaIngreso || null,
          salarioDiaUsd: salarioFinal,
          horasJornada:  Number(horasJornada) || 8,
          horaInicio, horaFin,
        })
        const targetId = res?.config?.empleado_id || res?.config?.id || empleadoId
        if (targetId) saveSalaryPref(targetId, prefData)
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
          <div className="bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5 text-xs text-red-700 font-medium">
            {error}
          </div>
        )}

        {/* Selector de empleado (solo al crear) */}
        {!esEdicion && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Datos del empleado</label>
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
                  Volver a intentar
                </button>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3 text-xs text-slate-600">
                  <p className="font-bold text-slate-800">Registra aquí al empleado</p>
                  <p className="mt-0.5 text-slate-500">Ingresa los datos para crear su ficha y asociarlo a Nómina.</p>
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre completo *" className={inputCls} disabled={cargando || Boolean(empleadoId)} />
                  <input value={documento} onChange={e => setDocumento(e.target.value)} placeholder="Cédula (opcional)" className={inputCls} disabled={cargando || Boolean(empleadoId)} />
                </div>
                {opcionesEmpleados.length > 0 && <CustomSelect value={empleadoId} onChange={setEmpleadoId} options={opcionesEmpleados} placeholder="O selecciona una persona ya registrada" disabled={cargando} />}
              </>
            )}
          </div>
        )}

        {/* Cargo y Fecha de Ingreso */}
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600">Cargo u ocupación</label>
              <input
                type="text" value={cargo}
                onChange={e => {
                  const val = e.target.value
                  setCargo(val)
                  if (val.toLowerCase().includes('vendedor') || val.toLowerCase().includes('ventas')) {
                    if (modalidad !== 'comision' && (!montoInput || Number(montoInput) === 0)) {
                      setModalidad('comision')
                      setMontoInput('0')
                    }
                  }
                }}
                placeholder="Ej: Vendedor, Chofer, Soldador"
                className={inputCls} disabled={cargando}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600">Fecha de ingreso</label>
              <DatePicker
                value={fechaIngreso}
                onChange={setFechaIngreso}
                disabled={cargando}
              />
            </div>
          </div>

          {/* Presets rápidos de cargo */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[10px] text-slate-400 font-semibold">Puestos sugeridos:</span>
            {['Vendedor', 'Chofer', 'Operador', 'Soldador', 'Almacenista', 'Ayudante', 'Administración'].map(puesto => (
              <button
                key={puesto}
                type="button"
                onClick={() => {
                  setCargo(puesto)
                  if (puesto === 'Vendedor') {
                    setModalidad('comision')
                    setMontoInput('0')
                  } else if (modalidad === 'comision') {
                    setModalidad('dia')
                    setMontoInput('')
                  }
                }}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-all ${
                  cargo.toLowerCase() === puesto.toLowerCase()
                    ? 'bg-primary text-white'
                    : puesto === 'Vendedor'
                    ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {puesto === 'Vendedor' ? '⭐ Vendedor (Comisión)' : puesto}
              </button>
            ))}
          </div>
        </div>

        {/* Modalidad y Salario */}
        <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
          <div className="flex items-center justify-between">
            <label className="text-xs font-black text-slate-700 flex items-center gap-1.5">
              <DollarSign size={15} className="text-primary" />
              Modalidad de Salario / Pago (USD)
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 rounded-xl bg-slate-200/60 text-xs font-bold">
            {[
              { id: 'dia', label: 'Por Día' },
              { id: 'semana', label: 'Por Semana' },
              { id: 'mes', label: 'Por Mes' },
              { id: 'comision', label: 'Por Comisión (Vendedor)' },
            ].map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  if (m.id === 'comision' && !cargo.trim()) {
                    setCargo('Vendedor')
                  }
                  handleCambioModalidad(m.id)
                }}
                className={`py-2 px-1 text-center rounded-xl transition-all ${modalidad === m.id ? 'bg-white text-slate-900 shadow-sm font-black' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {modalidad === 'comision' ? (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-950 space-y-1.5">
              <div className="flex items-center gap-1.5 font-black text-amber-900">
                <Sparkles size={14} className="text-amber-600" />
                <span>Modalidad: Pago de Comisión (Puesto: Vendedor)</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Asignado a <strong>Vendedores</strong> sin sueldo fijo semanal. Cada comisión cobrada se registra directamente como un <strong>Egreso en Finanzas</strong>.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-slate-500">
                  {modalidad === 'dia' ? 'Monto por día (USD) *' : modalidad === 'semana' ? 'Monto por semana (USD) *' : 'Monto mensual (USD) *'}
                </span>
                <input
                  type="number" min="0" step="0.01" value={montoInput}
                  onChange={e => setMontoInput(e.target.value)}
                  placeholder={modalidad === 'dia' ? 'Ej: 30.00' : modalidad === 'semana' ? 'Ej: 180.00' : 'Ej: 600.00'}
                  className={inputCls} disabled={cargando}
                />
              </div>
              {modalidad === 'semana' && (
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-slate-500">Días laborables / semana</span>
                  <CustomSelect
                    value={String(diasSemana)}
                    onChange={val => setDiasSemana(Number(val))}
                    options={[
                      { value: '5', label: '5 días (Lun-Vie)' },
                      { value: '6', label: '6 días (Lun-Sáb estándar)' },
                      { value: '7', label: '7 días continuos' },
                    ]}
                    disabled={cargando}
                  />
                </div>
              )}
              {modalidad === 'mes' && (
                <div className="flex items-center text-[11px] text-slate-400 pt-5">
                  <span>Base estándar de 30 días mensuales</span>
                </div>
              )}
            </div>
          )}

          {/* Desglose salarial reactivo */}
          {salarioDiaCalculado > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-2 border-t border-slate-200 min-w-0">
              <div className="p-2 rounded-xl bg-white border border-slate-100 text-center">
                <span className="text-[10px] text-slate-400 block font-medium">Por Día</span>
                <strong className="text-xs font-black text-slate-800">${salarioDiaCalculado.toFixed(2)}</strong>
              </div>
              <div className="p-2 rounded-xl bg-white border border-slate-100 text-center">
                <span className="text-[10px] text-slate-400 block font-medium">Por Hora ({horasJornada}h)</span>
                <strong className="text-xs font-black text-emerald-600">${tarifaHora.toFixed(2)}</strong>
              </div>
              <div className="p-2 rounded-xl bg-white border border-slate-100 text-center">
                <span className="text-[10px] text-slate-400 block font-medium">Semanal</span>
                <strong className="text-xs font-black text-slate-800">${equivalenteSemanal.toFixed(2)}</strong>
              </div>
              <div className="p-2 rounded-xl bg-white border border-slate-100 text-center">
                <span className="text-[10px] text-slate-400 block font-medium">Mensual</span>
                <strong className="text-xs font-black text-slate-800">${equivalenteMensual.toFixed(2)}</strong>
              </div>
            </div>
          )}
        </div>

        {/* Horario y Jornada */}
        <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
          <div className="flex items-center justify-between">
            <label className="text-xs font-black text-slate-700 flex items-center gap-1.5">
              <Clock size={15} className="text-primary" />
              Horario Laboral y Jornada
            </label>
            <button
              type="button"
              onClick={aplicarPresetHorarioEstandar}
              className="text-[11px] font-bold text-primary hover:text-primary-hover flex items-center gap-1"
            >
              <Sparkles size={12} />
              Estándar 8:00 a 17:00
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500">Entrada</label>
              <input
                type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)}
                className={inputCls} disabled={cargando}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500">Salida</label>
              <input
                type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)}
                className={inputCls} disabled={cargando}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500">Jornada (h)</label>
              <input
                type="number" min="1" max="24" step="0.5" value={horasJornada}
                onChange={e => setHorasJornada(e.target.value)}
                className={inputCls} disabled={cargando}
              />
            </div>
          </div>
        </div>

        {/* Activo (solo al editar) */}
        {esEdicion && (
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)}
              disabled={cargando}
              className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
            />
            Activo en nómina
            <span className="text-[11px] text-slate-400 font-normal">
              (si se desactiva, no se incluirá en nuevos períodos)
            </span>
          </label>
        )}
      </form>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-3 mt-4 border-t border-slate-100">
        <button onClick={onClose} type="button" disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50 transition-colors">
          Cancelar
        </button>
        <button
          onClick={guardar}
          disabled={cargando}
          className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all active:scale-95"
        >
          {cargando ? 'Guardando...' : 'Guardar empleado'}
        </button>
      </div>
    </Modal>
  )
}
