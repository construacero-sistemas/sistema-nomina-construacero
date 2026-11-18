import { useState, useMemo, useEffect } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import {
  useNominaEmpleados,
  useCrearConfigEmpleado,
  useActualizarConfigEmpleado,
  useGuardarHorarioEmpleado,
  useHorarios,
} from '../../hooks/useNomina'
import { diasActivosSemana, semanaEditable } from '../../utils/diasLaborables.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import EmpleadoBajaModal from './EmpleadoBajaModal.jsx'
import ModalidadSalarioSection from './ModalidadSalarioSection.jsx'
import PuestosSugeridos from './PuestosSugeridos.jsx'
import { VENDEDORES_EN_NOMINA } from '../../config/comisionesVendedores.js'
import SemanaLaborableSection from './SemanaLaborableSection.jsx'
import useReglasLey from '../../hooks/useReglasLey.js'

// D-1: la semana pagada son 7 días (laborables + descanso), como la hoja semanal.
const DIAS_SEMANA_PAGADOS = 7

const inputCls = 'w-full min-h-11 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[16px] sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all'

/**
 * Semana mostrada en la ficha: días y horas guardados en `nomina_horarios` y, si la
 * consulta aún no llegó, los días que el listado ya conoce. `hayHorario` evita el
 * aviso de "sin semana guardada" cuando la ficha sí la tiene.
 */
function semanaBaseDe(config, horarios, diasDefecto) {
  const base = semanaEditable(horarios, {
    horaInicio: config?.hora_inicio, horaFin: config?.hora_fin, horasJornada: config?.horas_jornada, diasDefecto,
  })
  const dias = config?.dias_laborables
  const conDias = Array.isArray(dias)
    ? { ...base, dias: base.dias.map(dia => ({ ...dia, activo: dias.includes(dia.diaSemana) })) }
    : base
  return { ...conDias, hayHorario: base.hayHorario || config?.horario_configurado === true }
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
  const [posVendedorId] = useState(config?.pos_vendedor_id ?? '')

  // Reglas de la ley editables (divisor mensual, días por defecto).
  const reglasLey = useReglasLey()
  const divisorMensual = reglasLey.divisorMensual

  // Semana laboral de la persona: qué días trabaja y con qué jornada cada uno.
  // De ella depende el estado «Libre» de la asistencia, del reloj real y el
  // guardarraíl de la carga masiva, así que se guarda junto con la ficha. Se
  // declara ANTES del salario porque el divisor del monto semanal sale de aquí.
  const horariosEmpleadoId = esEdicion ? (config?.empleado_id || '') : ''
  const { data: horarios = [] } = useHorarios(horariosEmpleadoId)
  // La semana se deriva de sus horarios guardados; `semanaOverride` solo existe si
  // el usuario ya marcado o editado algún día en este formulario.
  const semanaBase = useMemo(() => semanaBaseDe(config, horarios, reglasLey.diasLaborablesDefault), [config, horarios, reglasLey.diasLaborablesDefault])
  const [semanaOverride, setSemanaOverride] = useState(null)
  const semana = semanaOverride ?? semanaBase

  // D-1 (PLAN_HOJA_SEMANAL): la semana se paga con 7 días (los laborables más los
  // de descanso), igual que la hoja semanal y el cálculo de la nómina. Antes se
  // dividía entre los días marcados (5) y «$65/semana» guardaba $13 diarios, que
  // la nómina terminaba pagando como $91 a la semana.
  const divisorSemana = DIAS_SEMANA_PAGADOS
  // Jornada de referencia para la tarifa por hora: la del primer día marcado.
  const jornadaReferencia = Number(diasActivosSemana(semana.dias)[0]?.horasJornada) || 8

  // Modalidad: 'mes' | 'semana' | 'dia' | 'comision'. Siempre abre en «Por Mes»
  // (igual en todos los navegadores): lo que se guarda es el sueldo diario.
  const [modalidad, setModalidad] = useState(() => (VENDEDORES_EN_NOMINA && Number(config?.salario_dia_usd) === 0 ? 'comision' : 'mes'))

  const [montoInput, setMontoInput] = useState(() => {
    const daily = Number(config?.salario_dia_usd)
    if (!Number.isFinite(daily)) return ''
    if (daily <= 0) return daily === 0 ? '0' : ''
    return String(Math.round(daily * divisorMensual * 100) / 100)
  })

  // Sueldo diario exacto mientras solo se cambia de modalidad: convertir mes → día →
  // mes con montos redondeados a 2 decimales perdía precisión (280 → 9,33 → 279,90).
  // Se borra en cuanto el usuario escribe un monto; entonces manda lo escrito.
  const [diaExacto, setDiaExacto] = useState(null)

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
    if (diaExacto !== null) return diaExacto
    const val = Number(montoInput)
    if (!Number.isFinite(val) || val <= 0) return 0
    if (modalidad === 'semana') return val / divisorSemana
    if (modalidad === 'mes') return val / divisorMensual
    return val
  }, [montoInput, modalidad, divisorSemana, divisorMensual, diaExacto])

  function handleCambioModalidad(nuevoModo) {
    if (nuevoModo === modalidad) return
    if (nuevoModo === 'comision') {
      setMontoInput('0')
      setDiaExacto(null)
    } else if (salarioDiaCalculado > 0 || (modalidad === 'comision' && Number(montoInput) === 0)) {
      const baseDaily = salarioDiaCalculado > 0 ? salarioDiaCalculado : 10
      setDiaExacto(baseDaily)
      if (nuevoModo === 'semana') {
        const nuevoMonto = Math.round(baseDaily * divisorSemana * 100) / 100
        setMontoInput(String(nuevoMonto))
      } else if (nuevoModo === 'mes') {
        const nuevoMonto = Math.round(baseDaily * divisorMensual * 100) / 100
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

  // Horario estándar en todos los días marcados (antes vivía en una sección aparte
  // que repetía el horario de «Días que trabaja»).
  function aplicarHorarioEstandar() {
    actualizarSemana(actual => ({
      ...actual,
      dias: actual.dias.map(dia => (dia.activo ? { ...dia, horaInicio: '08:00', horaFin: '17:00', horasJornada: 8 } : dia)),
    }))
  }

  async function guardar(e) {
    if (e) e.preventDefault()
    setError('')

    if (!esEdicion && !empleadoId && !nombre.trim()) { setError('Escribe el nombre del empleado'); return }
    if (modalidad !== 'comision' && salarioDiaCalculado <= 0) { setError('El salario debe ser mayor a 0'); return }
    // La semana se guarda tal como se ve en «Días que trabaja»; el horario general
    // de la ficha (jornada, entrada y salida) es el del primer día marcado.
    const diasPayload = diasActivosSemana(semana.dias)
    if (diasPayload.some(dia => !(Number(dia.horasJornada) > 0))) { setError('La jornada de cada día debe ser mayor a 0 horas'); return }
    if (!diasPayload.length) {
      setError('Marca al menos un día laborable. Si esta persona no debe controlar asistencia, desactiva el interruptor de Asistencia en su ficha.')
      return
    }

    try {
      const salarioFinal = modalidad === 'comision' ? 0 : Math.round(salarioDiaCalculado * 10000) / 10000
      const [primerDia] = diasPayload
      const horarioFicha = {
        horasJornada: Number(primerDia.horasJornada) || 8,
        horaInicio: String(primerDia.horaInicio || '08:00').slice(0, 5),
        horaFin: String(primerDia.horaFin || '17:00').slice(0, 5),
      }
      if (esEdicion) {
        const res = await actualizar.mutateAsync({
          id: config.id,
          cargo,
          salarioDiaUsd: salarioFinal,
          ...horarioFicha,
          posVendedorId: posVendedorId || null,
        })
        await guardarSemana(res?.config?.empleado_id || config?.empleado_id, diasPayload)
      } else {
        const res = await crear.mutateAsync({
          empleadoId: empleadoId || undefined, nombre, documento, cargo,
          salarioDiaUsd: salarioFinal,
          ...horarioFicha,
          posVendedorId: posVendedorId || null,
        })
        const targetId = res?.config?.empleado_id || res?.config?.id || empleadoId
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
      className="max-w-lg lg:max-w-4xl">
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

        {/* En PC, dos columnas: cargo y salario a la izquierda, semana a la derecha. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4 min-w-0">
        {/* Cargo y puestos */}
        <div className="space-y-2">
          <div className="space-y-1">
            <label htmlFor="ficha-cargo" className="text-xs font-bold text-slate-600">Cargo u ocupación</label>
            <input
              id="ficha-cargo"
              type="text" value={cargo}
              onChange={e => setCargo(e.target.value)}
              placeholder="Ej: Chofer, Soldador, Administración"
              maxLength={160}
              className={inputCls} disabled={cargando}
            />
          </div>
          <PuestosSugeridos
            cargo={cargo}
            disabled={cargando}
            onElegir={puesto => {
              setCargo(puesto)
              if (modalidad === 'comision') { setModalidad('mes'); setMontoInput(''); setDiaExacto(null) }
            }}
          />
        </div>

        <ModalidadSalarioSection
          modalidad={modalidad}
          montoInput={montoInput}
          diasSemanaPagados={DIAS_SEMANA_PAGADOS}
          salarioDiaCalculado={salarioDiaCalculado}
          horasJornada={jornadaReferencia}
          divisorMensual={divisorMensual}
          cargando={cargando}
          onSeleccionarModalidad={seleccionarModalidad}
          onCambiarMonto={valor => { setMontoInput(valor); setDiaExacto(null) }}
        />
        </div>

        <div className="min-w-0">
        <SemanaLaborableSection
          semana={semana}
          cargando={cargando}
          onAlternarDia={alternarDiaLaborable}
          onCambiarJornada={cambiarJornadaDelDia}
          onCopiarJornada={copiarJornadaAlResto}
          onHorarioEstandar={aplicarHorarioEstandar}
        />
        </div>
        </div>

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
