// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({
  hoy: '2026-09-25',
  hora: '12:00',
  session: { perfil: { rol: 'nomina', nombre: 'Operadora' } },
  query: { data: null, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() },
  horasExtra: vi.fn().mockResolvedValue({ ok: true }),
  diaTrabajado: vi.fn().mockResolvedValue({ ok: true }),
  ausencia: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('../../../../compat/store/useAuthStore.js', () => ({
  default: selector => selector(mocks.session),
}))
vi.mock('../../../utils/fechaOperativa.js', () => ({
  fechaOperativaHoy: () => mocks.hoy,
  horaOperativaAhora: () => mocks.hora,
}))
vi.mock('../../../hooks/useNomina.js', () => ({
  useMarcajeHoy: () => mocks.query,
  useConfigNomina: () => ({ data: { nomina_horas_descanso: 1 } }),
  useRegistrarHorasExtra: () => ({ mutateAsync: mocks.horasExtra, isPending: false }),
  useMarcarDiaTrabajado: () => ({ mutateAsync: mocks.diaTrabajado, isPending: false }),
  useMarcarAusencia: () => ({ mutateAsync: mocks.ausencia, isPending: false }),
}))

import MarcajeLogisticaPanel from '../MarcajeLogisticaPanel.jsx'

const empleados = [
  { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Administración', hora_inicio: '08:00', hora_fin: '17:00', horas_jornada: 8, empleado: { nombre: 'Alejandra Hidalgo' } },
  { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Chofer', hora_inicio: '07:30', hora_fin: '16:30', horas_jornada: 8, empleado: { nombre: 'María Rodríguez' } },
  { id: 'cfg-3', empleado_id: 'emp-3', cargo: 'Técnico', empleado: { nombre: 'Lucía Pérez' } },
  { id: 'cfg-4', empleado_id: 'emp-4', cargo: 'Almacén', dias_laborables: [1, 2, 3, 4], empleado: { nombre: 'José Duarte' } },
]

function renderPanel(props = {}) {
  return render(<MarcajeLogisticaPanel empleados={empleados} {...props} />)
}

beforeEach(() => {
  mocks.hoy = '2026-09-25' // viernes
  mocks.hora = '12:00'
  mocks.session.perfil = { rol: 'nomina', nombre: 'Operadora' }
  mocks.query = {
    data: {
      fecha: '2026-09-25',
      registros: [
        { empleado_id: 'emp-2', horas_extra: 2, hora_salida: '18:30:00', estado_marcaje: 'manual' },
        { empleado_id: 'emp-3', es_ausencia: true, ausencia_justificada: false, estado_marcaje: 'manual' },
      ],
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue({}),
  }
  mocks.horasExtra = vi.fn().mockResolvedValue({ ok: true })
  mocks.diaTrabajado = vi.fn().mockResolvedValue({ ok: true })
  mocks.ausencia = vi.fn().mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Asistencia de hoy (excepciones)', () => {
  it('no se cae si los empleados llegan antes que la consulta del día', () => {
    for (const query of [
      { data: undefined, isLoading: true, isFetching: true, isError: false, refetch: vi.fn() },
      { data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() },
    ]) {
      mocks.query = query
      renderPanel()
      expect(screen.getByLabelText('Cargando empleados y asistencia')).toBeInTheDocument()
      expect(screen.queryByRole('list', { name: 'Lista de asistencia de hoy' })).not.toBeInTheDocument()
      cleanup()
    }
    mocks.query = { data: undefined, isLoading: false, isFetching: false, isError: true, refetch: vi.fn() }
    expect(() => renderPanel()).not.toThrow()
  })

  it('muestra presentes por defecto sin botones de entrada/salida ni alertas de retraso', () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: 'Asistencia de hoy' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar entrada|Marcar salida/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Retraso/i)).not.toBeInTheDocument()

    // emp-1: presente por defecto con horario propio
    expect(screen.getByText('Presente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Horas extras de Alejandra Hidalgo' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Marcar ausente a Alejandra Hidalgo' })).toBeEnabled()

    // emp-2: con horas extras
    expect(screen.getByText('Presente · con horas extras')).toBeInTheDocument()
    expect(screen.getByText('+2 h extra')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar extras (+2 h) de María Rodríguez' })).toBeEnabled()

    // emp-3: ausencia
    expect(screen.getByText('Ausencia registrada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Volver a presente (Lucía Pérez)' })).toBeEnabled()

    // emp-4: viernes es día libre para José (trabaja L-J)
    expect(screen.getByText('Día de descanso')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar día trabajado de José Duarte' })).toBeEnabled()
  })

  it('permite marcar horas extras desde 0.5h (chip) o entrada manual con coma', async () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Horas extras de Alejandra Hidalgo' }))
    expect(screen.getByRole('button', { name: '+0.5h' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+0.5h' }))
    expect(screen.getByText(/Salida estimada:/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horas extras de Alejandra Hidalgo' }))

    await waitFor(() => expect(mocks.horasExtra).toHaveBeenCalledExactlyOnceWith({
      empleadoId: 'emp-1',
      horasExtra: 0.5,
      nombre: 'Alejandra Hidalgo',
    }))

    // Entrada manual decimal con coma
    fireEvent.click(screen.getByRole('button', { name: 'Horas extras de Alejandra Hidalgo' }))
    fireEvent.change(screen.getByLabelText('Horas extras manuales de Alejandra Hidalgo'), { target: { value: '2,25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horas extras de Alejandra Hidalgo' }))
    await waitFor(() => expect(mocks.horasExtra).toHaveBeenLastCalledWith({
      empleadoId: 'emp-1',
      horasExtra: 2.25,
      nombre: 'Alejandra Hidalgo',
    }))
  })

  it('permite quitar horas extras existentes cuando ya tiene', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Editar extras (+2 h) de María Rodríguez' }))
    fireEvent.click(screen.getByRole('button', { name: 'Quitar extras de María Rodríguez' }))
    await waitFor(() => expect(mocks.horasExtra).toHaveBeenCalledExactlyOnceWith({
      empleadoId: 'emp-2',
      horasExtra: 0,
      nombre: 'María Rodríguez',
    }))
  })

  it('marca ausencia con o sin justificativo y permite volver a presente', async () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar ausente a Alejandra Hidalgo' }))
    expect(screen.getByRole('group', { name: '¿Alejandra Hidalgo trae justificativo?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /No, sin justificativo.*para Alejandra Hidalgo/ }))
    await waitFor(() => expect(mocks.ausencia).toHaveBeenCalledWith({
      empleadoId: 'emp-1', quitar: false, justificada: false,
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Volver a presente (Lucía Pérez)' }))
    await waitFor(() => expect(mocks.ausencia).toHaveBeenCalledWith({
      empleadoId: 'emp-3', quitar: true,
    }))
  })

  it('en feriado no laborable y días de descanso ofrece «Marcar día trabajado» y nunca ausencia', async () => {
    mocks.query = { ...mocks.query, data: { fecha: '2026-09-25', registros: [] } }
    renderPanel({
      feriadosPorFecha: new Map([['2026-09-25', { fecha: '2026-09-25', nombre: 'Feriado patronal', laborable: false }]]),
    })

    expect(screen.getByText(/Feriado: Feriado patronal/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar ausente a / })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar día trabajado de Alejandra Hidalgo' }))
    await waitFor(() => expect(mocks.diaTrabajado).toHaveBeenCalledExactlyOnceWith({
      empleadoId: 'emp-1', quitar: false, nombre: 'Alejandra Hidalgo',
    }))
  })

  it('busca nombres sin distinguir acentos y filtra por estado o solo novedades', () => {
    renderPanel()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar empleado por nombre o cargo' }), { target: { value: 'maria' } })
    expect(screen.getByRole('heading', { name: 'María Rodríguez' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Alejandra Hidalgo' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar empleado por nombre o cargo' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Solo novedades/i }))
    expect(screen.getByRole('heading', { name: 'María Rodríguez' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lucía Pérez' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Alejandra Hidalgo' })).not.toBeInTheDocument()
  })

  it('pausa acciones si falla la consulta y oculta el panel al rol sin capacidad', () => {
    mocks.query = { ...mocks.query, isError: true }
    const view = renderPanel()
    expect(screen.getByRole('button', { name: 'Horas extras de Alejandra Hidalgo' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('las acciones están pausadas')

    mocks.session.perfil = { rol: 'finanzas', nombre: 'Finanzas' }
    view.rerender(<MarcajeLogisticaPanel empleados={empleados} />)
    expect(screen.queryByRole('heading', { name: 'Asistencia de hoy' })).not.toBeInTheDocument()
  })

  it('muestra banner para revisar y cerrar período cuando está en su último día o vencido', () => {
    const onCerrarPeriodo = vi.fn()
    renderPanel({
      periodoParaCerrar: { id: 'p-1', nombre: 'Semana 39-2026', hasta: '2026-09-25', estado: 'abierto' },
      onCerrarPeriodo,
    })

    const banner = screen.getByRole('region', { name: 'Cierre del período disponible' })
    expect(banner).toHaveTextContent('Semana 39-2026')
    fireEvent.click(screen.getByRole('button', { name: 'Revisar y cerrar período' }))
    expect(onCerrarPeriodo).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-1' }))
  })
})
