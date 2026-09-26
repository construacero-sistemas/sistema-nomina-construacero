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
}))

vi.mock('../../../hooks/useNomina', () => ({
  useNominaEmpleados: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  usePosVendedores: () => ({ data: [], isLoading: false }),
  useHorarios: () => ({ data: mocks.horarios, isLoading: false }),
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

  // F-3: una sola fuente de verdad para los días por semana. El divisor del monto
  // semanal sale de «Días que trabaja»; ya no existe un selector 5/6/7 que pudiera
  // pagar el acuerdo semanal a 5/6 sin aviso.
  it('el divisor del monto semanal son los días marcados y se recalcula al marcar otro', () => {
    localStorage.setItem('nomina_empleado_salario_pref_emp-1', JSON.stringify({ modalidad: 'semana', montoInput: '180' }))
    render(<EmpleadoConfigModal modo="editar" config={{ ...config, salario_dia_usd: 36 }} onClose={vi.fn()} />)

    // Lun–Vie marcados (5 días) y $180/semana → $36,00 por día.
    expect(screen.getByText('5 días — se toma de «Días que trabaja»')).toBeInTheDocument()
    expect(screen.getByText('$36.00')).toBeInTheDocument()
    expect(screen.getByText('$180.00')).toBeInTheDocument()
    // El selector manual de días desapareció: no hay forma de contradecir la semana.
    expect(screen.queryByText('5 días (Lun-Vie)')).not.toBeInTheDocument()
    expect(screen.queryByText('6 días (Lun-Sáb estándar)')).not.toBeInTheDocument()

    // Marcar el sábado reparte el mismo monto entre 6 días: $30,00 por día.
    fireEvent.click(screen.getByRole('button', { name: 'Sábado: no trabaja' }))
    expect(screen.getByText('6 días — se toma de «Días que trabaja»')).toBeInTheDocument()
    expect(screen.getByText('$30.00')).toBeInTheDocument()
  })

  it('al guardar envía la ficha y los días laborables con el horario de la ficha', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empleado' }))

    await waitFor(() => expect(mocks.actualizar).toHaveBeenCalledTimes(1))
    expect(mocks.actualizar.mock.calls[0][0]).toMatchObject({
      id: 'cfg-1', cargo: 'Vendedor', salarioDiaUsd: 15, horasJornada: 8, horaInicio: '08:00', horaFin: '17:00', activo: true,
    })
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
