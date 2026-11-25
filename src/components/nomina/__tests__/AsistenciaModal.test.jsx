// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AsistenciaModal from '../AsistenciaModal.jsx'

const mocks = vi.hoisted(() => ({
  registrar: vi.fn().mockResolvedValue({ ok: true }),
  eliminar: vi.fn().mockResolvedValue({ ok: true }),
  horarios: [],
}))

vi.mock('../../../hooks/useNomina', () => ({
  useRegistrarAsistencia: () => ({ mutateAsync: mocks.registrar, isPending: false }),
  useEliminarAsistencia: () => ({ mutateAsync: mocks.eliminar, isPending: false }),
  useHorarios: () => ({ data: mocks.horarios, isLoading: false }),
}))

const empleado = {
  empleado_id: 'emp-1',
  empleado: { nombre: 'Carlos Mendoza' },
  horas_jornada: 8,
  hora_inicio: '08:00:00',
  hora_fin: '17:00:00',
}

const baseProps = {
  empleado,
  fecha: '2026-09-10', // jueves
  feriado: null,
  esAdmin: true,
  puedeGestionarNomina: true,
  onClose: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.horarios = []
})

afterEach(() => cleanup())

describe('AsistenciaModal (100% por excepción)', () => {
  it('muestra marcaje real histórico en modo solo lectura y oculta guardar/restaurar', () => {
    render(
      <AsistenciaModal
        {...baseProps}
        registro={{ id: 'r1', estado_marcaje: 'completo', hora_entrada: '08:00:00', hora_salida: '17:00:00', horas_trabajadas: 8 }}
      />,
    )

    expect(screen.getByText(/marcaje real del reloj — solo lectura/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /guardar horas extras|guardar ausencia|marcar día trabajado/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /volver a presente/i })).not.toBeInTheDocument()
  })

  it('trabaja por excepción en día laborable sin inputs de entrada/salida y toma el horario de la ficha', async () => {
    render(
      <AsistenciaModal
        {...baseProps}
        registro={{ id: 'r1', estado_marcaje: 'manual', horas_extra: 0 }}
        horasDescansoDefault={0.5}
      />,
    )

    expect(document.querySelector('input[type="time"]')).toBeNull()
    expect(screen.queryByText(/Día feriado/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Presente por defecto · 08:00 AM – 05:00 PM \(8 h\)/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+0.5h' }))
    expect(screen.getByText(/8 h normales \+ 0\.5 h extras · salida est\. 05:30 PM/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Horas extras manuales/i), { target: { value: '1,5' } })
    fireEvent.submit(document.querySelector('form#asistencia-excepcion-form'))

    await waitFor(() => expect(mocks.registrar).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      empleadoId: 'emp-1',
      fecha: '2026-09-10',
      horaEntrada: '08:00',
      horaSalida: '18:30',
      horasDescanso: 1,
      esAusencia: false,
      ausenciaJustificada: false,
      registroIdEsperado: 'r1',
      estadoMarcajeEsperado: 'manual',
    })))
  })

  it('usa el horario específico del día configurado en useHorarios y distingue sábado trabajado', () => {
    mocks.horarios = [
      { dia_semana: 6, hora_inicio: '07:30', hora_fin: '16:30', horas_jornada: 8, trabaja: true },
    ]
    render(<AsistenciaModal {...baseProps} fecha="2026-09-12" />)

    expect(screen.getByText(/Presente por defecto · 07:30 AM – 04:30 PM \(8 h\)/)).toBeInTheDocument()
  })

  it('permite marcar ausencia con o sin justificativo', async () => {
    render(<AsistenciaModal {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ausente' }))
    fireEvent.click(screen.getByRole('button', { name: /Con justificativo/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar ausencia' }))

    await waitFor(() => expect(mocks.registrar).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      empleadoId: 'emp-1',
      fecha: '2026-09-10',
      horaEntrada: null,
      horaSalida: null,
      horasDescanso: 0,
      esAusencia: true,
      ausenciaJustificada: true,
    })))
  })

  it('en día de descanso o feriado no laborable oculta Ausente y ofrece Marcar día trabajado', async () => {
    render(<AsistenciaModal {...baseProps} fecha="2026-09-13" />)

    expect(screen.getByText(/Día de descanso · libre por defecto/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ausente' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+2h' }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar día trabajado' }))

    await waitFor(() => expect(mocks.registrar).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      empleadoId: 'emp-1',
      fecha: '2026-09-13',
      horaEntrada: '08:00',
      horaSalida: '19:00',
      esAusencia: false,
    })))
  })

  it('permite restaurar a presente solo cuando puedeGestionarNomina es true', async () => {
    const view = render(
      <AsistenciaModal {...baseProps} puedeGestionarNomina={false} registro={{ id: 'r1', estado_marcaje: 'manual' }} />,
    )
    expect(screen.queryByRole('button', { name: 'Volver a presente' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar horas extras' })).toBeInTheDocument()
    view.unmount()

    render(<AsistenciaModal {...baseProps} puedeGestionarNomina registro={{ id: 'r1', estado_marcaje: 'manual' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Volver a presente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, restaurar' }))
    await waitFor(() => expect(mocks.eliminar).toHaveBeenCalledExactlyOnceWith('r1'))
  })
})
