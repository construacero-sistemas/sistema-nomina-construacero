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

describe('Ficha de empleado — horario general de configuración', () => {
  it('oculta el selector de días/horarios individuales y muestra el desglose del salario con el horario de Configuración', () => {
    mocks.configNomina = { nomina_hora_inicio: '07:30', nomina_hora_fin: '16:30', nomina_horas_jornada: 8 }
    renderModal()

    expect(screen.queryByText('Días que trabaja')).toBeNull()
    expect(screen.queryByRole('button', { name: /Usar el mismo horario/i })).toBeNull()
    expect(screen.getByText(/Horario de la empresa \(Configuración\)/i)).toBeInTheDocument()

    expect(screen.getByText('Modalidad de Salario / Pago (USD)')).toBeInTheDocument()
    expect(screen.getByText('$15.00')).toBeInTheDocument()
    expect(screen.getByText('Semanal')).toBeInTheDocument()
  })

  // D-1: la semana se paga con 7 días (laborables + descanso), como la hoja semanal.
  // Antes se dividía entre los días marcados y «$65/semana» terminaba pagándose a $91.
  it('el monto semanal se divide entre 7 y también oculta horarios por día al crear', () => {
    render(<EmpleadoConfigModal modo="crear" onClose={vi.fn()} />)
    expect(screen.queryByText('Días que trabaja')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Por Semana' }))
    expect(screen.getByText(/Sueldo diario = semanal ÷ 7 días/)).toBeInTheDocument()
  })

  it('al guardar envía el horario configurado en la empresa sin mutar horarios individuales', async () => {
    mocks.configNomina = { nomina_hora_inicio: '07:30', nomina_hora_fin: '16:30', nomina_horas_jornada: 8 }
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empleado' }))

    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1))
    expect(mocks.actualizar.mock.calls[0][0]).toMatchObject({
      id: 'cfg-1', cargo: 'Vendedor', salarioDiaUsd: 15, horasJornada: 8, horaInicio: '07:30', horaFin: '16:30',
    })
    // «Activo en nómina» ya no está en la ficha: la baja se hace con «Dar de baja».
    expect(mocks.actualizar.mock.calls[0][0]).not.toHaveProperty('activo')
    expect(mocks.guardarHorario).not.toHaveBeenCalled()
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

  it('sin «Activo en nómina» ni la sección de horario duplicada; toma el horario de Configuración', async () => {
    mocks.configNomina = { nomina_hora_inicio: '07:00', nomina_hora_fin: '17:00', nomina_horas_jornada: 8 }
    renderModal()
    expect(screen.queryByText('Activo en nómina')).toBeNull()
    expect(screen.queryByText('Horario Laboral y Jornada')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar empleado' }))
    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1))
    expect(mocks.actualizar.mock.calls[0][0]).toMatchObject({ horaInicio: '07:00', horaFin: '17:00', horasJornada: 8 })
  })
})
