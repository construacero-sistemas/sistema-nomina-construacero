import { useState, useMemo, useEffect } from 'react'
import { RefreshCw, Clock, Calendar, Sparkles, ShoppingBag, Trash2, AlertTriangle } from 'lucide-react'
import {
  useNominaEmpleados,
  useCrearConfigEmpleado,
  useActualizarConfigEmpleado,
  useGuardarHorarioEmpleado,
  useHorarios,
  usePosVendedores,
} from '../../hooks/useNomina'
import { diasActivosSemana, semanaEditable } from '../../utils/diasLaborables.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import EmpleadoBajaModal from './EmpleadoBajaModal.jsx'
import ModalidadSalarioSection from './ModalidadSalarioSection.jsx'
import SemanaLaborableSection from './SemanaLaborableSection.jsx'

const inputCls = 'w-full min-h-11 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[16px] sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all'

const PREF_KEY_PREFIX = 'nomina_empleado_salario_pref_'

/**
 * Semana mostrada en la ficha: días y horas guardados en `nomina_horarios` y, si la
 * consulta aún no llegó, los días que el listado ya conoce. `hayHorario` evita el
 * aviso de "sin semana guardada" cuando la ficha sí la tiene.
 */
function semanaBaseDe(config, horarios) {
  const base = semanaEditable(horarios, {
    horaInicio: config?.hora_inicio, horaFin: config?.hora_fin, horasJornada: config?.horas_jornada,
  })
  const dias = config?.dias_laborables
  const conDias = Array.isArray(dias)
    ? { ...base, dias: base.dias.map(dia => ({ ...dia, activo: dias.includes(dia.diaSemana) })) }
    : base
  return { ...conDias, hayHorario: base.hayHorario || config?.horario_configurado === true }
}

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
  const guardarHorario = useGuardarHorarioEmpleado()

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
  const [posVendedorId, setPosVendedorId] = useState(config?.pos_vendedor_id ?? '')

  const { data: posVendedores = [], isLoading: posVendedoresCargando } = usePosVendedores()

  const opcionesVendedoresPos = useMemo(() => [
    { value: '', label: 'Sin vincular al POS' },
    ...(Array.isArray(posVendedores) ? posVendedores : []).map(v => ({
      value: v.id,
      label: `${v.nombre}${v.codigo ? ` (${v.codigo})` : ''}`,
    })),
  ], [posVendedores])

  const empKey = config?.empleado_id || config?.id
  const savedPref = useMemo(() => getSavedSalaryPref(empKey), [empKey])

  // Semana laboral de la persona: qué días trabaja y con qué jornada cada uno.
  // De ella depende el estado «Libre» de la asistencia, del reloj real y el
  // guardarraíl de la carga masiva, así que se guarda junto con la ficha. Se
  // declara ANTES del salario porque el divisor del monto semanal sale de aquí.
  const horariosEmpleadoId = esEdicion ? (config?.empleado_id || '') : ''
  const { data: horarios = [] } = useHorarios(horariosEmpleadoId)
  // La semana se deriva de sus horarios guardados; `semanaOverride` solo existe si
  // el usuario ya marcado o editado algún día en este formulario.
  const semanaBase = useMemo(() => semanaBaseDe(config, horarios), [config, horarios])
  const [semanaOverride, setSemanaOverride] = useState(null)
  const semana = semanaOverride ?? semanaBase
  const semanaTocada = semanaOverride !== null

  // UNA sola fuente de verdad para el divisor semanal (F-3): SIEMPRE son los días
  // marcados en «Días que trabaja». Antes había un selector 5/6/7 independiente y
  // el monto semanal acordado se pagaba a 5/6 sin aviso. Sin días marcados la
  // ficha no se puede guardar; entretanto se usa el default histórico (6).
  const diasSemana = useMemo(() => diasActivosSemana(semana.dias).length, [semana])
  const divisorSemana = diasSemana || 6

  // Modalidad salarial persistente: 'dia' | 'semana' | 'mes' | 'comision'
  const [modalidad, setModalidad] = useState(() => savedPref?.modalidad || (Number(config?.salario_dia_usd) === 0 ? 'comision' : 'dia'))

  const [montoInput, setMontoInput] = useState(() => {
    const daily = Number(config?.salario_dia_usd)
    if (!Number.isFinite(daily) || daily <= 0) {
      if (savedPref?.modalidad === 'comision' || daily === 0) return '0'
      return ''
    }
    const mod = savedPref?.modalidad || 'dia'
    const ds = divisorSemana

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
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)
  const [error, setError]           = useState('')

  function actualizarSemana(transformar) {
    setSemanaOverride(actual => transformar(actual ?? semanaBase))
  }

  function alternarDiaLaborable(diaSemana) {
    actualizarSemana(actual => ({
      ...actual,
      dias: actual.dias.map(dia => (dia.diaSemana === diaSemana ? { ...dia, activo: !dia.activo } : dia)),
    }))
  }

  function cambiarJornadaDelDia(diaSemana, campo, valor) {
    actualizarSemana(actual => ({
      ...actual,
      dias: actual.dias.map(dia => (dia.diaSemana === diaSemana ? { ...dia, [campo]: valor } : dia)),
    }))
  }

  function copiarJornadaAlResto() {
    actualizarSemana(actual => {
      const [modelo] = actual.dias.filter(dia => dia.activo)
      if (!modelo) return actual
      return {
        ...actual,
        dias: actual.dias.map(dia => (dia.activo
          ? { ...dia, horaInicio: modelo.horaInicio, horaFin: modelo.horaFin, horasJornada: modelo.horasJornada }
          : dia)),
      }
    })
  }

  // Cálculo del salario diario en USD según la modalidad elegida
  const salarioDiaCalculado = useMemo(() => {
    if (modalidad === 'comision') return 0
    const val = Number(montoInput)
    if (!Number.isFinite(val) || val <= 0) return 0
    if (modalidad === 'semana') return val / divisorSemana
    if (modalidad === 'mes') return val / 30
    return val
  }, [montoInput, modalidad, divisorSemana])

  function handleCambioModalidad(nuevoModo) {
    if (nuevoModo === modalidad) return
    if (nuevoModo === 'comision') {
      setMontoInput('0')
    } else if (salarioDiaCalculado > 0 || (modalidad === 'comision' && Number(montoInput) === 0)) {
      const baseDaily = salarioDiaCalculado > 0 ? salarioDiaCalculado : 10
      if (nuevoModo === 'semana') {
        const nuevoMonto = Math.round(baseDaily * divisorSemana * 100) / 100
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

  // Personas existentes que aún no estén en nómina
  const empleadosPersonales = useMemo(() => (
    (clientes || []).filter(c => c.tipo_cliente === 'personal' && c.activo !== false)
  ), [clientes])

  const opcionesEmpleados = useMemo(() => {
    const yaEnSet = new Set(empleadosYaEnNomina)
    return empleadosPersonales
      .filter(c => !yaEnSet.has(c.id))
      .map(c => ({ value: c.id, label: c.nombre }))
  }, [empleadosPersonales, empleadosYaEnNomina])

  const cargando = crear.isPending || actualizar.isPending || guardarHorario.isPending

  // Elegir "comisión" implica el puesto de Vendedor; el resto de la modalidad solo
  // cambia el monto convertido.
  function seleccionarModalidad(nuevoModo) {
    if (nuevoModo === 'comision' && !cargo.trim()) setCargo('Vendedor')
    handleCambioModalidad(nuevoModo)
  }

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
    // Si nadie tocó la semana, los días activos toman el horario de la ficha.
    const jornadaFicha = Number(horasJornada) || 8
    const diasPayload = diasActivosSemana(semana.dias).map(dia => (semanaTocada
      ? dia
      : { ...dia, horaInicio: String(horaInicio).slice(0, 5), horaFin: String(horaFin).slice(0, 5), horasJornada: jornadaFicha }))
    if (!diasPayload.length) {
      setError('Marca al menos un día laborable. Si esta persona no debe controlar asistencia, desactiva el interruptor de Asistencia en su ficha.')
      return
    }

    try {
      const salarioFinal = modalidad === 'comision' ? 0 : Math.round(salarioDiaCalculado * 10000) / 10000
      // El divisor no se persiste: se recalcula de los días marcados (F-3).
      const prefData = { modalidad, montoInput }
      if (esEdicion) {
        const res = await actualizar.mutateAsync({
          id: config.id,
          cargo, fechaIngreso: fechaIngreso || null,
          salarioDiaUsd: salarioFinal,
          horasJornada:  Number(horasJornada) || 8,
          horaInicio, horaFin, activo,
          posVendedorId: posVendedorId || null,
        })
        const targetId = res?.config?.empleado_id || config?.empleado_id || config?.id
        saveSalaryPref(targetId, prefData)
        if (config?.id) saveSalaryPref(config.id, prefData)
        if (config?.empleado_id) saveSalaryPref(config.empleado_id, prefData)
        await guardarSemana(res?.config?.empleado_id || config?.empleado_id, diasPayload)
      } else {
        const res = await crear.mutateAsync({
          empleadoId: empleadoId || undefined, nombre, documento, cargo, fechaIngreso: fechaIngreso || null,
          salarioDiaUsd: salarioFinal,
          horasJornada:  Number(horasJornada) || 8,
          horaInicio, horaFin,
          posVendedorId: posVendedorId || null,
        })
        const targetId = res?.config?.empleado_id || res?.config?.id || empleadoId
        if (targetId) saveSalaryPref(targetId, prefData)
        await guardarSemana(targetId, diasPayload)
      }
      onClose()
    } catch (err) {
      setError(err.message || 'Error al guardar')
    }
  }

  // La ficha se guardó: si los días laborables fallan, se avisa sin perder el resto.
  // El guardado de la semana es idempotente (cada día se actualiza en su fila), así
  // que reintentar completa el cambio sin duplicar días (F-7).
  async function guardarSemana(empleadoIdDestino, dias) {
    if (!empleadoIdDestino || !dias.length) return
    let res
    try {
      res = await guardarHorario.mutateAsync({ empleadoId: empleadoIdDestino, dias })
    } catch (err) {
      throw new Error(`La ficha se guardó, pero no se pudieron guardar sus días laborables: ${err.message}`)
    }
    // Si el servidor no pudo retirar los días anteriores, la semana nueva igual quedó
    // guardada: se dice en voz alta en vez de cerrar como si todo hubiera salido bien.
    if (res?.aviso) throw new Error(res.aviso)
  }

  async function ejecutarDarDeBaja() {
    setError('')
    try {
      await actualizar.mutateAsync({
        id: config.id,
        activo: false,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Error al dar de baja al empleado')
      setConfirmandoBaja(false)
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
                {puesto === 'Vendedor' ? (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles size={11} className="text-amber-700" />
                    Vendedor (Comisión)
                  </span>
                ) : puesto}
              </button>
            ))}
          </div>
        </div>

        <ModalidadSalarioSection
          modalidad={modalidad}
          montoInput={montoInput}
          diasSemana={diasSemana}
          salarioDiaCalculado={salarioDiaCalculado}
          horasJornada={horasJornada}
          cargando={cargando}
          onSeleccionarModalidad={seleccionarModalidad}
          onCambiarMonto={setMontoInput}
        />

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
              Estándar 08:00 AM a 05:00 PM
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

        <SemanaLaborableSection
          semana={semana}
          cargando={cargando}
          onAlternarDia={alternarDiaLaborable}
          onCambiarJornada={cambiarJornadaDelDia}
          onCopiarJornada={copiarJornadaAlResto}
        />

        {/* Vinculación con Vendedor en POS */}
        <div className="space-y-2 p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200/70">
          <div className="flex items-center justify-between">
            <label className="text-xs font-black text-amber-900 flex items-center gap-1.5">
              <ShoppingBag size={15} className="text-amber-700" />
              Vendedor en Sistema POS (Opcional)
            </label>
            {posVendedorId && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                Vinculado
              </span>
            )}
          </div>
          <p className="text-[11px] text-amber-800/80 leading-relaxed">
            Asocia a este empleado con su usuario vendedor en el POS para importar automáticamente sus comisiones liberadas por ventas y cobranzas en cada nómina.
          </p>
          {posVendedoresCargando ? (
            <div className="text-xs text-slate-400 py-2">Cargando vendedores del POS...</div>
          ) : (
            <CustomSelect
              value={posVendedorId}
              onChange={setPosVendedorId}
              options={opcionesVendedoresPos}
              placeholder="Seleccionar vendedor del POS..."
              disabled={cargando}
            />
          )}
        </div>

        {/* Activo (solo al editar) */}
        {esEdicion && (
          <label className="min-h-11 flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer pt-1">
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
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-4 border-t border-slate-100">
        {esEdicion ? (
          <button
            type="button"
            onClick={() => setConfirmandoBaja(true)}
            disabled={cargando}
            style={{ touchAction: 'manipulation' }}
            className="min-h-11 px-3.5 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold transition-all flex items-center gap-1.5"
            title="Dar de baja este trabajador de la nómina"
          >
            <Trash2 size={14} />
            <span>Dar de baja</span>
          </button>
        ) : <div />}

        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            type="button"
            disabled={cargando}
            style={{ touchAction: 'manipulation' }}
            className="min-h-11 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={cargando}
            style={{ touchAction: 'manipulation' }}
            className="min-h-11 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all active:scale-95"
          >
            {cargando ? 'Guardando...' : 'Guardar empleado'}
          </button>
        </div>
      </div>

      {confirmandoBaja && (
        <EmpleadoBajaModal
          isOpen
          empleado={config}
          onClose={() => setConfirmandoBaja(false)}
          onConfirm={ejecutarDarDeBaja}
          cargando={cargando}
        />
      )}
    </Modal>
  )
}
