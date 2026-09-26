// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AsistenciaModal from '../AsistenciaModal.jsx'

const mocks = vi.hoisted(() => ({
  registrar: vi.fn().mockResolvedValue({ ok: true }),
  eliminar: vi.fn().mockResolvedValue({ ok: true }),
  horarios: [],
}))

vi.mock('../../../hooks/useNomina.js', () => ({
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

// `esAdmin` (administrarNomina) permite registrar y corregir; `puedeGestionarNomina`
// (gestionarUsuarios) es lo que el servidor exige para ELIMINAR el registro.
const baseProps = {
  empleado, fecha: '2026-09-10', feriado: null, esAdmin: true,
  puedeGestionarNomina: true, onClose: vi.fn(),
}

beforeEach(() => { vi.clearAllMocks(); mocks.horarios = [] })
afterEach(() => cleanup())

describe('AsistenciaModal', () => {
  it('shows a real clock mark as read-only and hides edit/delete actions', () => {
    render(<AsistenciaModal
      {...baseProps}
      registro={{ id: 'r1', estado_marcaje: 'completo', hora_entrada: '08:00:00', hora_salida: '17:00:00' }}
    />)

    expect(screen.getByText(/marcaje real del reloj/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /guardar asistencia/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /eliminar registro de asistencia/i })).not.toBeInTheDocument()
    expect(document.querySelector('input[type="time"]')).toBeDisabled()
  })

  it('uses the configured rest default for manual presets and sends guard fields', async () => {
    render(<AsistenciaModal
      {...baseProps}
      registro={{ id: 'r1', estado_marcaje: 'manual' }}
      horasDescansoDefault={0.5}
    />)

    // El acceso rápido debe respetar el descanso configurado (0.5h), no un 1h fijo.
    fireEvent.click(screen.getByRole('button', { name: /8h de jornada/i }))
    expect(screen.getByText('0.5h')).toBeInTheDocument()

    fireEvent.submit(document.querySelector('form#asistencia-manual-form'))

    await waitFor(() => expect(mocks.registrar).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      empleadoId: 'emp-1',
      fecha: '2026-09-10',
      registroIdEsperado: 'r1',
      estadoMarcajeEsperado: 'manual',
      horaEntrada: '08:00',
      horaSalida: '17:00',
      horasDescanso: 0.5,
    })))
  })

  // F-8: la ficha manda. Con semana configurada (sábado 08:00–17:00, 8 h) el modal
  // abre con esas horas y su descanso derivado, sin el aviso de «Sábado Rotativo».
  it('abre con las horas de su semana configurada y sin dar por hecho el medio sábado', () => {
    mocks.horarios = [
      { dia_semana: 6, hora_inicio: '08:00', hora_fin: '17:00', horas_jornada: 8, semana_ciclo: null, fecha_hasta: null, trabaja: true },
    ]
    render(<AsistenciaModal {...baseProps} fecha="2026-09-12" registro={{ id: 'r1', estado_marcaje: 'manual' }} horasDescansoDefault={0.5} />)

    const [entrada, salida] = document.querySelectorAll('input[type="time"]')
    expect(entrada).toHaveValue('08:00')
    expect(salida).toHaveValue('17:00')
    expect(screen.queryByText(/Sábado Rotativo/i)).not.toBeInTheDocument()
    // 9 h de permanencia − 8 h de jornada = 1 h de descanso, tomadas de la ficha.
    expect(screen.getByText('1h')).toBeInTheDocument()
  })

  it('sin semana configurada mantiene el estándar de la ficha y su aviso de sábado', () => {
    render(<AsistenciaModal {...baseProps} fecha="2026-09-12" />)

    const [entrada, salida] = document.querySelectorAll('input[type="time"]')
    expect(entrada).toHaveValue('08:00')
    expect(salida).toHaveValue('17:00')
    // La insignia y la nota del sábado (dos textos) siguen ahí cuando no hay semana.
    expect(screen.getAllByText(/Sábado Rotativo/i)).toHaveLength(2)
    // El atajo ya no da por hecho un medio sábado de 5 h: sale de la ficha.
    expect(screen.queryByText(/medio sábado/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /8h de jornada/i })).toBeInTheDocument()
  })

  it('keeps the delete action available for manual rows', () => {
    render(<AsistenciaModal {...baseProps} registro={{ id: 'r1', estado_marcaje: 'manual' }} />)
    expect(screen.getByRole('button', { name: /eliminar registro de asistencia/i })).toBeInTheDocument()
  })

  it('oculta el borrado —pero no la corrección— cuando falta la capacidad de gestionar nómina', () => {
    render(<AsistenciaModal
      {...baseProps}
      puedeGestionarNomina={false}
      registro={{ id: 'r1', estado_marcaje: 'manual' }}
    />)

    expect(screen.queryByRole('button', { name: /eliminar registro de asistencia/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /guardar asistencia/i })).toBeInTheDocument()
  })
})
