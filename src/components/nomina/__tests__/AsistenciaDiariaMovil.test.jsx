// @vitest-environment jsdom
// src/components/nomina/__tests__/AsistenciaDiariaMovil.test.jsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AsistenciaDiariaMovil from '../AsistenciaDiariaMovil.jsx'

const mockRegistrarMutate = vi.fn().mockResolvedValue({ ok: true })
const mockMasivoMutate = vi.fn().mockResolvedValue({ ok: true })

vi.mock('../../../hooks/useNomina.js', () => ({
  useRegistrarAsistencia: () => ({
    mutateAsync: mockRegistrarMutate,
    isPending: false,
  }),
  useRegistrarAsistenciaMasivo: () => ({
    mutateAsync: mockMasivoMutate,
    isPending: false,
  }),
}))

describe('AsistenciaDiariaMovil', () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  function renderWithClient(ui) {
    return render(
      <QueryClientProvider client={qc}>
        {ui}
      </QueryClientProvider>
    )
  }

  const mockEmpleados = [
    {
      id: 'cfg-1',
      empleado_id: 'emp-1',
      cargo: 'Chofer',
      horas_jornada: 8,
      hora_inicio: '08:00',
      hora_fin: '17:00',
      empleado: { id: 'emp-1', nombre: 'Carlos Mendoza' },
    },
    {
      id: 'cfg-2',
      empleado_id: 'emp-2',
      cargo: 'Vendedor',
      horas_jornada: 8,
      hora_inicio: '08:00',
      hora_fin: '17:00',
      empleado: { id: 'emp-2', nombre: 'María Rodríguez' },
    },
  ]

  const diasSemana = [
    new Date('2026-09-07T12:00:00'), // Lun
    new Date('2026-09-08T12:00:00'), // Mar
    new Date('2026-09-09T12:00:00'), // Mié
    new Date('2026-09-10T12:00:00'), // Jue
    new Date('2026-09-11T12:00:00'), // Vie
    new Date('2026-09-12T12:00:00'), // Sáb
    new Date('2026-09-13T12:00:00'), // Dom
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza la lista de empleados y el resumen de jornada', () => {
    const registros = new Map()
    renderWithClient(
      <AsistenciaDiariaMovil
        empleados={mockEmpleados}
        registrosPorEmpleado={registros}
        feriadoDelDia={null}
        fechaSeleccionada="2026-09-10"
        onCambiarFecha={vi.fn()}
        diasSemana={diasSemana}
        onMoverSemana={vi.fn()}
        esAdmin={true}
        onAbrirDetalle={vi.fn()}
      />
    )

    expect(screen.getByText('Carlos Mendoza')).toBeTruthy()
    expect(screen.getByText('María Rodríguez')).toBeTruthy()
    expect(screen.getByText(/Marcar toda la cuadrilla presente/)).toBeTruthy()
  })

  it('permite marcar presente individual en 1 solo clic con horas estándar', async () => {
    const registros = new Map()
    renderWithClient(
      <AsistenciaDiariaMovil
        empleados={mockEmpleados}
        registrosPorEmpleado={registros}
        feriadoDelDia={null}
        fechaSeleccionada="2026-09-10"
        onCambiarFecha={vi.fn()}
        diasSemana={diasSemana}
        onMoverSemana={vi.fn()}
        esAdmin={true}
        onAbrirDetalle={vi.fn()}
      />
    )

    const botonesPresente = screen.getAllByTitle('Marcar jornada estándar')
    expect(botonesPresente.length).toBe(2)

    fireEvent.click(botonesPresente[0])
    expect(mockRegistrarMutate).toHaveBeenCalledTimes(1)
    expect(mockRegistrarMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        empleadoId: 'emp-1',
        fecha: '2026-09-10',
        horaEntrada: '08:00',
        horaSalida: '17:00',
        esAusencia: false,
      })
    )
  })

  it('permite marcar falta individual en 1 solo clic', async () => {
    const registros = new Map()
    renderWithClient(
      <AsistenciaDiariaMovil
        empleados={mockEmpleados}
        registrosPorEmpleado={registros}
        feriadoDelDia={null}
        fechaSeleccionada="2026-09-10"
        onCambiarFecha={vi.fn()}
        diasSemana={diasSemana}
        onMoverSemana={vi.fn()}
        esAdmin={true}
        onAbrirDetalle={vi.fn()}
      />
    )

    const botonesFalta = screen.getAllByTitle('Marcar falta')
    fireEvent.click(botonesFalta[1])

    expect(mockRegistrarMutate).toHaveBeenCalledTimes(1)
    expect(mockRegistrarMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        empleadoId: 'emp-2',
        fecha: '2026-09-10',
        horaEntrada: null,
        horaSalida: null,
        esAusencia: true,
      })
    )
  })

  it('dispara el marcaje masivo de toda la cuadrilla al presionar el botón superior', async () => {
    const registros = new Map()
    renderWithClient(
      <AsistenciaDiariaMovil
        empleados={mockEmpleados}
        registrosPorEmpleado={registros}
        feriadoDelDia={null}
        fechaSeleccionada="2026-09-10"
        onCambiarFecha={vi.fn()}
        diasSemana={diasSemana}
        onMoverSemana={vi.fn()}
        esAdmin={true}
        onAbrirDetalle={vi.fn()}
      />
    )

    const botonMasivo = screen.getByText(/Marcar toda la cuadrilla presente/)
    fireEvent.click(botonMasivo)

    expect(mockMasivoMutate).toHaveBeenCalledTimes(1)
    expect(mockMasivoMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        fecha: '2026-09-10',
        horaEntrada: '08:00',
        horaSalida: '17:00',
      })
    )
  })
})
