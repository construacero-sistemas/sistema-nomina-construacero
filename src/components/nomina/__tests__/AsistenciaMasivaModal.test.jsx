// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AsistenciaMasivaModal from '../AsistenciaMasivaModal.jsx'

const mocks = vi.hoisted(() => ({
  registrar: vi.fn().mockResolvedValue({ ok: true }),
  config: { nomina_horas_descanso: 0.5 },
}))
vi.mock('../../../hooks/useNomina.js', () => ({
  useRegistrarAsistenciaMasivo: () => ({ mutateAsync: mocks.registrar, isPending: false }),
  useConfigNomina: () => ({ data: mocks.config }),
}))

const empleados = [
  { empleado_id: 'emp-1', empleado: { nombre: 'Carlos Mendoza' } },
  { empleado_id: 'emp-2', empleado: { nombre: 'María Rodríguez' } },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.registrar.mockResolvedValue({ ok: true })
  mocks.config = { nomina_horas_descanso: 0.5 }
})
afterEach(() => cleanup())

describe('AsistenciaMasivaModal', () => {
  it('previews a bounded employee list and requires a second confirmation before writing', async () => {
    render(<AsistenciaMasivaModal
      fechaInicial="2026-09-10"
      empleadoIds={['emp-1']}
      empleados={empleados}
      onClose={vi.fn()}
    />)

    expect(screen.getByText('1 empleado(s) pendiente(s)')).toBeInTheDocument()
    expect(screen.getByText('Carlos Mendoza')).toBeInTheDocument()
    expect(screen.queryByText('María Rodríguez')).not.toBeInTheDocument()
    expect(screen.getByText('8.50 h')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revisar aplicación' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Confirma aplicar este horario a 1 empleado(s)')
    expect(mocks.registrar).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aplicación' }))
    await waitFor(() => expect(mocks.registrar).toHaveBeenCalledExactlyOnceWith({
      fecha: '2026-09-10',
      horaEntrada: '08:00',
      horaSalida: '17:00',
      esFeriado: false,
      horasDescanso: 0.5,
      empleadoIds: ['emp-1'],
    }))
  })

  // F-8: el horario previsto del lote sale del horario general de la empresa
  // (configuración de nómina), no de un 08:00–17:00 fijo.
  it('parte del horario general configurado por la empresa', () => {
    mocks.config = { nomina_horas_descanso: 0.5, nomina_hora_inicio: '07:00', nomina_hora_fin: '16:00' }
    render(<AsistenciaMasivaModal
      fechaInicial="2026-09-10"
      empleadoIds={['emp-1']}
      empleados={empleados}
      onClose={vi.fn()}
    />)

    const [entrada, salida] = document.querySelectorAll('input[type="time"]')
    expect(entrada).toHaveValue('07:00')
    expect(salida).toHaveValue('16:00')
    expect(screen.getByText('8.50 h')).toBeInTheDocument()
  })

  it('warns when the selected employees have different jornadas', () => {
    render(<AsistenciaMasivaModal
      fechaInicial="2026-09-10"
      empleadoIds={['emp-1', 'emp-2']}
      empleados={[
        { empleado_id: 'emp-1', empleado: { nombre: 'Carlos Mendoza' }, horas_jornada: 8 },
        { empleado_id: 'emp-2', empleado: { nombre: 'María Rodríguez' }, horas_jornada: 6 },
      ]}
      onClose={vi.fn()}
    />)

    expect(screen.getByText(/la jornada varía/i)).toBeInTheDocument()
  })

  it('does not allow confirmation with an empty pending group', () => {
    render(<AsistenciaMasivaModal fechaInicial="2026-09-10" empleadoIds={[]} empleados={empleados} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Revisar aplicación' })).toBeDisabled()
    expect(mocks.registrar).not.toHaveBeenCalled()
  })
})
