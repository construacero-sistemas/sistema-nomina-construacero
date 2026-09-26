// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AsistenciaDiariaMovil from '../AsistenciaDiariaMovil.jsx'

const mocks = vi.hoisted(() => ({ abrirMasivo: vi.fn() }))

vi.mock('../../../hooks/useNomina.js', () => ({}))

const empleados = [
  { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Chofer', empleado: { nombre: 'Carlos Mendoza' } },
  { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Vendedor', empleado: { nombre: 'María Rodríguez' } },
  { id: 'cfg-3', empleado_id: 'emp-3', cargo: 'Almacén', empleado: { nombre: 'José Pérez' } },
]
const diasSemana = Array.from({ length: 7 }, (_, index) => new Date(`2026-09-${String(index + 7).padStart(2, '0')}T12:00:00`))

function renderManual(registros = new Map(), props = {}) {
  return render(
    <AsistenciaDiariaMovil
      empleados={empleados}
      registrosPorEmpleado={registros}
      feriadoDelDia={null}
      fechaSeleccionada="2026-09-10"
      onCambiarFecha={vi.fn()}
      diasSemana={diasSemana}
      onMoverSemana={vi.fn()}
      onIrHoy={vi.fn()}
      esAdmin
      puedeGestionarNomina
      onAbrirDetalle={vi.fn()}
      onAbrirMasivo={mocks.abrirMasivo}
      {...props}
    />,
  )
}

beforeEach(() => vi.clearAllMocks())

afterEach(() => cleanup())

describe('AsistenciaDiariaMovil', () => {
  it('prioriza pendientes y ofrece Hoy para regresar desde otra fecha', () => {
    const view = renderManual()
    expect(screen.getByRole('heading', { name: /jueves, 10 de septiembre/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hoy' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Registrar asistencia' })).toHaveLength(3)
    expect(screen.getAllByText('Pendiente')).toHaveLength(3)
    expect(view.container.querySelector('[aria-label="Elegir fecha de asistencia"]')).toBeInTheDocument()
  })

  it('filtra por estado y búsqueda de nombre', () => {
    const registros = new Map([
      ['emp-2|2026-09-10', { id: 'manual-2', estado_marcaje: 'manual', hora_entrada: '08:00', hora_salida: '17:00' }],
      ['emp-3|2026-09-10', { id: 'absence-3', estado_marcaje: 'manual', es_ausencia: true }],
    ])
    renderManual(registros)

    fireEvent.click(screen.getByRole('button', { name: /Registrados 1/ }))
    expect(screen.getByText('María Rodríguez')).toBeInTheDocument()
    expect(screen.queryByText('Carlos Mendoza')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar empleado por nombre o cargo' }), { target: { value: 'jose' } })
    fireEvent.click(screen.getByRole('button', { name: /Faltas 1/ }))
    expect(screen.getByText('José Pérez')).toBeInTheDocument()
    expect(screen.queryByText('María Rodríguez')).not.toBeInTheDocument()
  })

  it('no cuenta como pendiente el día que no le toca y lo separa en Día libre', () => {
    renderManual(new Map(), {
      empleados: [
        { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Chofer', empleado: { nombre: 'Carlos Mendoza' }, dias_laborables: [1, 2, 3, 5, 6] },
        { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Vendedor', empleado: { nombre: 'María Rodríguez' } },
      ],
    })

    // El 10 de septiembre de 2026 es jueves: Carlos no trabaja los jueves.
    expect(screen.getByRole('button', { name: /Pendientes 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Día libre 1/ })).toBeInTheDocument()
    expect(screen.getByText(/· 1 en día libre/)).toBeInTheDocument()
    expect(screen.queryByText('Carlos Mendoza')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Día libre 1/ }))
    const visibles = screen.getAllByRole('listitem')
    expect(visibles).toHaveLength(1)
    expect(visibles[0]).toHaveTextContent('Carlos Mendoza')
    expect(visibles[0]).toHaveTextContent('Día libre')
    expect(screen.queryByText('María Rodríguez')).not.toBeInTheDocument()
  })

  // F-4: el filtro «Registrados» quedó sin actualizar cuando se añadió el estado
  // «Día libre»: mostraba personas que no tenían ningún registro ese día.
  it('«Registrados» solo lista a quien tiene registro y deja el día libre en su filtro', () => {
    const registros = new Map([
      ['emp-2|2026-09-10', { id: 'manual-2', estado_marcaje: 'manual', hora_entrada: '08:00', hora_salida: '17:00' }],
    ])
    renderManual(registros, {
      empleados: [
        { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Chofer', empleado: { nombre: 'Carlos Mendoza' }, dias_laborables: [1, 2, 3, 5, 6] },
        { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Vendedor', empleado: { nombre: 'María Rodríguez' } },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: /Registrados 1/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('María Rodríguez')).toBeInTheDocument()
    expect(screen.queryByText('Carlos Mendoza')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Día libre 1/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Carlos Mendoza')).toBeInTheDocument()
    expect(screen.queryByText('María Rodríguez')).not.toBeInTheDocument()
  })

  it('oculta la carga masiva sin la capacidad que exige el servidor, y sigue registrando día a día', () => {
    renderManual(new Map(), { puedeGestionarNomina: false })

    expect(screen.queryByRole('button', { name: /Aplicar a \\d+ pendientes/i })).not.toBeInTheDocument()
    // Registrar un día a la vez es su tarea real: sigue disponible.
    expect(screen.getAllByRole('button', { name: 'Registrar asistencia' })).toHaveLength(3)
  })

  it('el horario masivo incluye solo empleados pendientes y no los marcajes reales', () => {
    const registros = new Map([
      ['emp-2|2026-09-10', { id: 'real-2', estado_marcaje: 'completo', hora_entrada: '08:00', hora_salida: '17:00' }],
      ['emp-3|2026-09-10', { id: 'absence-3', estado_marcaje: 'manual', es_ausencia: true }],
    ])
    renderManual(registros)
    fireEvent.click(screen.getByRole('button', { name: /Registrados 1/ }))
    expect(screen.getByText('Marcaje real del reloj')).toBeInTheDocument()
    expect(screen.getByText(/no se sobrescribe como horario manual/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a 1 pendientes' }))
    expect(mocks.abrirMasivo).toHaveBeenCalledExactlyOnceWith({ fecha: '2026-09-10', empleadoIds: ['emp-1'] })
  })
})
