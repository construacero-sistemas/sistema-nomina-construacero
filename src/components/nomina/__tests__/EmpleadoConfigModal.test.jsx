// @vitest-environment jsdom
// Prueba de humo de la ficha de empleado: la semana laboral y la modalidad de
// salario viven en componentes propios, así que aquí se fija el cableado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({
  crear: vi.fn(),
  actualizar: vi.fn(),
  guardarHorario: vi.fn(),
  horarios: [],
  configs: [],
  configNomina: undefined,
  guardarConfig: vi.fn(),
}))

vi.mock('../../../hooks/useNomina', () => ({
  // Reglas de la ley (useReglasLey): sin configuración, la ley vigente.
  useConfigNomina: () => ({ data: mocks.configNomina, isLoading: false }),
  useGuardarConfigNomina: () => ({ mutateAsync: mocks.guardarConfig, mutate: mocks.guardarConfig, isPending: false }),
  useNominaEmpleados: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  usePosVendedores: () => ({ data: [], isLoading: false }),
  useHorarios: () => ({ data: mocks.horarios, isLoading: false }),
  useConfigEmpleados: () => ({ data: mocks.configs, isLoading: false }),
  useCrearConfigEmpleado: () => ({ mutateAsync: mocks.crear, isPending: false }),
  useActualizarConfigEmpleado: () => ({ mutateAsync: mocks.actualizar, isPending: false }),
  useGuardarHorarioEmpleado: () => ({ mutateAsync: mocks.guardarHorario, isPending: false }),
}))

import EmpleadoConfigModal from '../EmpleadoConfigModal.jsx'

const config = {
  id: 'cfg-1',
  empleado_id: 'emp-1',
  cargo: 'Vendedor',
  salario_dia_usd: 15,
  horas_jornada: 8,
  hora_inicio: '08:00',
  hora_fin: '17:00',
  fecha_ingreso: '2026-01-15',
  activo: true,
  dias_laborables: [1, 2, 3, 4, 5],
  horario_configurado: true,
  empleado: { id: 'emp-1', nombre: 'Niki Ramirez', documento: 'V-12345678', tipo_cliente: 'personal' },
}

function renderModal() {
  return render(<EmpleadoConfigModal modo="editar" config={config} onClose={vi.fn()} />)
}

beforeEach(() => {
  localStorage.clear()
  mocks.crear = vi.fn().mockResolvedValue({ ok: true, config: { id: 'cfg-nueva', empleado_id: 'emp-1' } })
  mocks.actualizar = vi.fn().mockResolvedValue({ ok: true, config: { id: 'cfg-1', empleado_id: 'emp-1' } })
  mocks.guardarHorario = vi.fn().mockResolvedValue({ ok: true })
  mocks.horarios = []
  mocks.configs = []
  mocks.configNomina = undefined
  mocks.guardarConfig = vi.fn().mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const DIAS_LUN_A_VIE = [1, 2, 3, 4, 5].map(diaSemana => ({ diaSemana, horaInicio: '08:00', horaFin: '17:00', horasJornada: 8 }))

describe('Ficha de empleado — días que trabaja', () => {
  it('muestra la semana guardada, sus horas por día y el desglose del salario', () => {
    renderModal()

    expect(screen.getByText('Días que trabaja')).toBeInTheDocument()
    expect(screen.getByText('Lun a Vie')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lunes: trabaja' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sábado: no trabaja' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Hora de entrada del Viernes')).toHaveValue('08:00')
    expect(screen.getByLabelText('Hora de salida del Viernes')).toHaveValue('17:00')
    expect(screen.getByLabelText('Jornada del Viernes')).toHaveValue(8)
    expect(screen.getByRole('button', { name: 'Usar el mismo horario en todos los días marcados' })).toBeInTheDocument()
    // Una semana ya guardada no repite el aviso de "sin fijar".
    expect(screen.queryByText(/Sin semana guardada todavía/)).not.toBeInTheDocument()

    expect(screen.getByText('Modalidad de Salario / Pago (USD)')).toBeInTheDocument()
    expect(screen.getByText('$15.00')).toBeInTheDocument()
    expect(screen.getByText('Semanal')).toBeInTheDocument()
  })

  // D-1: la semana se paga con 7 días (laborables + descanso), como la hoja semanal.
  // Antes se dividía entre los días marcados y «$65/semana» terminaba pagándose a $91.
  it('el monto semanal se divide entre 7 y no cambia al marcar otro día', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Por Semana' }))
    expect(screen.getByDisplayValue('105')).toBeInTheDocument() // $15/día × 7
    expect(screen.getByText(/Sueldo diario = semanal ÷ 7 días/)).toBeInTheDocument()
    expect(screen.getByText('$105.00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sábado: no trabaja' }))
    expect(screen.getByText('$15.00')).toBeInTheDocument()
    expect(screen.getByText('$105.00')).toBeInTheDocument()
  })

  it('al guardar envía la ficha y los días laborables con el horario de la ficha', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empleado' }))

    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1))
    expect(mocks.actualizar.mock.calls[0][0]).toMatchObject({
      id: 'cfg-1', cargo: 'Vendedor', salarioDiaUsd: 15, horasJornada: 8, horaInicio: '08:00', horaFin: '17:00',
    })
    // «Activo en nómina» ya no está en la ficha: la baja se hace con «Dar de baja».
    expect(mocks.actualizar.mock.calls[0][0]).not.toHaveProperty('activo')
    await waitFor(() => expect(mocks.guardarHorario).toHaveBeenCalledTimes(1))
    expect(mocks.guardarHorario.mock.calls[0][0]).toEqual({ empleadoId: 'emp-1', dias: DIAS_LUN_A_VIE })
  })

  // F-7: la semana se guarda antes de retirar nada. Si el retiro falla, el servidor
  // avisa y el modal no puede cerrarse como si todo hubiera quedado perfecto.
  it('si quedaron días anteriores sin retirar, avisa y no cierra la ficha', async () => {
    const onClose = vi.fn()
    mocks.guardarHorario = vi.fn().mockResolvedValue({
      ok: true,
      aviso: 'La semana nueva se guardó, pero no se pudieron retirar los días anteriores.',
    })
    render(<EmpleadoConfigModal modo="editar" config={config} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empleado' }))

    await waitFor(() => expect(screen.getByText(/no se pudieron retirar los días anteriores/i)).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(mocks.actualizar).toHaveBeenCalledTimes(1)
  })

  it('marcar un día extra y ajustar su jornada viaja en el payload tal como se ve', async () => {
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Sábado: no trabaja' }))
    expect(screen.getByRole('button', { name: 'Sábado: trabaja' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByLabelText('Hora de salida del Sábado'), { target: { value: '13:00' } })

    fireEvent.click(screen.getByRole('button', { name: 'Guardar empleado' }))

    await waitFor(() => expect(mocks.guardarHorario).toHaveBeenCalledTimes(1))
    expect(mocks.guardarHorario.mock.calls[0][0]).toEqual({
      empleadoId: 'emp-1',
      dias: [...DIAS_LUN_A_VIE, { diaSemana: 6, horaInicio: '08:00', horaFin: '13:00', horasJornada: 8 }],
    })
  })
})

describe('Ficha de empleado — sin vendedores en la nómina', () => {
  it('no ofrece la modalidad «Por Comisión» ni el puesto sugerido de vendedor', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: /Por Comisión/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Vendedor \(Comisión\)/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Por Día' })).toBeTruthy()
  })
})

describe('Ficha de empleado — cargo, fecha y modalidad', () => {
  it('ya no pide la fecha de ingreso y no la envía al guardar (conserva la que hubiera)', async () => {
    renderModal()
    expect(screen.queryByText('Fecha de ingreso')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empleado' }))
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1))
    expect(mocks.actualizar.mock.calls[0][0]).not.toHaveProperty('fechaIngreso')
  })

  it('ordena las modalidades Mes, Semana, Día y abre en «Por Mes»', () => {
    renderModal()
    const nombres = ['Por Mes', 'Por Semana', 'Por Día']
    const botones = screen.getAllByRole('button').filter(b => nombres.includes(b.textContent))
    expect(botones.map(b => b.textContent)).toEqual(nombres)
    expect(screen.getByText('Monto mensual (USD) *')).toBeInTheDocument()
    expect(screen.getByDisplayValue('450')).toBeInTheDocument()
  })

  it('280 al mes no baja a 279,90 al pasar por «Por Día» y vuelve a «Por Mes»', async () => {
    render(<EmpleadoConfigModal modo="editar" config={{ ...config, salario_dia_usd: 9.3333 }} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('280')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Por Día' }))
    expect(screen.getByDisplayValue('9.33')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Por Semana' }))
    fireEvent.click(screen.getByRole('button', { name: 'Por Mes' }))
    expect(screen.getByDisplayValue('280')).toBeInTheDocument()
    expect(screen.getByText('$280.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empleado' }))
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1))
    expect(mocks.actualizar.mock.calls[0][0].salarioDiaUsd).toBe(9.3333)
  })

  it('escribir 280 en «Por Mes» guarda 9,3333 por día', async () => {
    renderModal()
    fireEvent.change(screen.getByDisplayValue('450'), { target: { value: '280' } })
    expect(screen.getByText('$280.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empleado' }))
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1))
    expect(mocks.actualizar.mock.calls[0][0].salarioDiaUsd).toBe(9.3333)
  })

  it('ofrece los cargos que ya usa alguien y permite agregar un puesto personalizado', async () => {
    mocks.configs = [{ id: 'c-2', cargo: 'electricista' }, { id: 'c-3', cargo: 'Chofer' }]
    renderModal()
    expect(screen.getByRole('button', { name: 'Electricista' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Chofer' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /Agregar puesto/ }))
    fireEvent.change(screen.getByLabelText('Nombre del nuevo puesto'), { target: { value: 'pintor de estructuras' } })
    fireEvent.keyDown(screen.getByLabelText('Nombre del nuevo puesto'), { key: 'Enter' })
    expect(screen.getByLabelText('Cargo u ocupación')).toHaveValue('Pintor de estructuras')
    // Se guarda en la configuración de la cuenta para que aparezca en cualquier PC.
    await waitFor(() => expect(mocks.guardarConfig).toHaveBeenCalledWith({ nomina_puestos: ['Pintor de estructuras'] }))
  })

  it('muestra los puestos guardados y deja quitar los que nadie usa', () => {
    mocks.configNomina = { nomina_puestos: ['Electricista', 'Pintor'] }
    mocks.configs = [{ id: 'c-2', cargo: 'Pintor' }]
    renderModal()
    expect(screen.getByRole('button', { name: 'Electricista' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quitar el puesto Pintor' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar el puesto Electricista' }))
    expect(mocks.guardarConfig).toHaveBeenCalledWith({ nomina_puestos: ['Pintor'] })
  })

  it('sin «Activo en nómina» ni la sección de horario duplicada; el horario vive en cada día', async () => {
    renderModal()
    expect(screen.queryByText('Activo en nómina')).toBeNull()
    expect(screen.queryByText('Horario Laboral y Jornada')).toBeNull()

    fireEvent.change(screen.getByLabelText('Hora de entrada del Lunes'), { target: { value: '07:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empleado' }))
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1))
    // El horario general de la ficha es el del primer día marcado.
    expect(mocks.actualizar.mock.calls[0][0]).toMatchObject({ horaInicio: '07:00', horaFin: '17:00', horasJornada: 8 })
  })

  it('avisa si la jornada es mayor que el tiempo entre entrada y salida, y aplica el horario estándar', () => {
    renderModal()
    fireEvent.change(screen.getByLabelText('Hora de salida del Viernes'), { target: { value: '12:00' } })
    expect(screen.getByRole('alert')).toHaveTextContent('La jornada (8 h) es mayor que el tiempo entre entrada y salida (4 h)')
    fireEvent.click(screen.getByRole('button', { name: /Horario estándar 08:00 a 17:00/ }))
    expect(screen.getByLabelText('Hora de salida del Viernes')).toHaveValue('17:00')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
