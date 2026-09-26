// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({
  // Fecha operativa del servidor (America/Caracas) para esta prueba: cada caso la
  // ancla a la fecha de su fixture y así no depende del día real de ejecución.
  hoy: '2026-09-25',
  session: { perfil: { rol: 'nomina', nombre: 'Operadora' } },
  query: { data: null, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() },
  entrada: vi.fn().mockResolvedValue({ ok: true }),
  salida: vi.fn().mockResolvedValue({ ok: true }),
  ausencia: vi.fn().mockResolvedValue({ ok: true }),
  corregir: vi.fn().mockResolvedValue({ ok: true }),
  anularAusencia: vi.fn().mockResolvedValue({ ok: true }),
  entradaPending: false,
  salidaPending: false,
  ausenciaPending: false,
}))

vi.mock('../../../../compat/store/useAuthStore.js', () => ({
  default: selector => selector(mocks.session),
}))
// La fecha operativa la fija el servidor (America/Caracas). Se ancla a la misma del
// fixture para que la prueba no dependa del día real en que se ejecute.
vi.mock('../../../utils/fechaOperativa.js', () => ({
  fechaOperativaHoy: () => mocks.hoy,
}))
vi.mock('../../../hooks/useNomina.js', () => ({
  useMarcajeHoy: () => mocks.query,
  useConfigNomina: () => ({ data: { nomina_horas_descanso: 0.5 } }),
  useMarcarEntrada: () => ({ mutateAsync: mocks.entrada, isPending: mocks.entradaPending }),
  useMarcarSalida: () => ({ mutateAsync: mocks.salida, isPending: mocks.salidaPending }),
  useMarcarAusencia: () => ({ mutateAsync: mocks.ausencia, isPending: mocks.ausenciaPending }),
  useCorregirMarcaje: () => ({ mutateAsync: mocks.corregir, isPending: false }),
  useAnularEntradaComoAusencia: () => ({ mutateAsync: mocks.anularAusencia, isPending: false }),
}))

import MarcajeLogisticaPanel from '../MarcajeLogisticaPanel.jsx'

const empleados = [
  { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Administración', empleado: { nombre: 'Alejandra Hidalgo' } },
  { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Chofer', empleado: { nombre: 'María Rodríguez' } },
  { id: 'cfg-3', empleado_id: 'emp-3', cargo: 'Vendedor', empleado: { nombre: 'Edgar Ramirez' } },
  { id: 'cfg-4', empleado_id: 'emp-4', cargo: 'Técnico', empleado: { nombre: 'Lucía Pérez' } },
  { id: 'cfg-5', empleado_id: 'emp-5', cargo: 'Almacén', empleado: { nombre: 'José Duarte' } },
]

function renderPanel(props = {}) {
  return render(<MarcajeLogisticaPanel empleados={empleados} {...props} />)
}

beforeEach(() => {
  mocks.hoy = '2026-09-25'
  mocks.session.perfil = { rol: 'nomina', nombre: 'Operadora' }
  mocks.query = {
    data: {
      fecha: '2026-09-25',
      registros: [
        { id: 'attendance-2', empleado_id: 'emp-2', hora_entrada: '08:10:00', hora_salida: null, estado_marcaje: 'entrada' },
        { empleado_id: 'emp-3', hora_entrada: '08:00:00', hora_salida: '17:00:00', estado_marcaje: 'completo' },
        { empleado_id: 'emp-4', es_ausencia: true, estado_marcaje: 'manual' },
        { empleado_id: 'emp-5', hora_entrada: '08:00:00', hora_salida: '17:00:00', estado_marcaje: 'manual' },
      ],
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue({}),
  }
  mocks.entrada = vi.fn().mockResolvedValue({ ok: true })
  mocks.salida = vi.fn().mockResolvedValue({ ok: true })
  mocks.ausencia = vi.fn().mockResolvedValue({ ok: true })
  mocks.corregir = vi.fn().mockResolvedValue({ ok: true })
  mocks.anularAusencia = vi.fn().mockResolvedValue({ ok: true })
  mocks.entradaPending = false
  mocks.salidaPending = false
  mocks.ausenciaPending = false
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Marcaje real de hoy', () => {
  it('presenta una sola acción contextual en cada estado y distingue el horario manual', () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: 'Marcaje real de hoy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' })).toBeEnabled()
    expect(screen.getByText('Sin entrada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar salida para María Rodríguez' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Corregir marcaje de María Rodríguez' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Corregir marcaje de Edgar Ramirez' })).toBeEnabled()
    expect(screen.getByText((_, node) => node?.textContent === 'Entrada 08:10 AM')).toBeInTheDocument()
    expect(screen.getByText('Salida pendiente')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar (?:entrada|salida) para Edgar/ })).not.toBeInTheDocument()
    expect(screen.getByText('Jornada completa')).toBeInTheDocument()
    expect(screen.getByText('Ausencia registrada')).toBeInTheDocument()
    expect(screen.getByText('Horario registrado, no es reloj real')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar (?:entrada|salida) para José/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'José Duarte' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todos 5' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Horarios fijos 1' })).toBeInTheDocument()
  })

  it('registra la entrada de la persona elegida con un toque y cambia a jornada en curso', async () => {
    const view = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' }))
    expect(mocks.entrada).toHaveBeenCalledExactlyOnceWith({ empleadoId: 'emp-1' })

    mocks.query = {
      ...mocks.query,
      data: { ...mocks.query.data, registros: [...mocks.query.data.registros, {
        empleado_id: 'emp-1', hora_entrada: '08:42:00', hora_salida: null, estado_marcaje: 'entrada',
      }] },
    }
    view.rerender(<MarcajeLogisticaPanel empleados={empleados} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar salida para Alejandra Hidalgo' })).toBeInTheDocument())
    expect(screen.getByText((_, node) => node?.textContent === 'Entrada 08:42 AM')).toBeInTheDocument()
  })

  it('registra la salida en jornada abierta y muestra la jornada completada al actualizar', async () => {
    const view = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar salida para María Rodríguez' }))
    expect(mocks.salida).toHaveBeenCalledExactlyOnceWith({ empleadoId: 'emp-2' })

    mocks.query = {
      ...mocks.query,
      data: { ...mocks.query.data, registros: mocks.query.data.registros.map(registro => registro.empleado_id === 'emp-2'
        ? { ...registro, hora_salida: '17:12:00', estado_marcaje: 'completo' }
        : registro) },
    }
    view.rerender(<MarcajeLogisticaPanel empleados={empleados} />)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Marcar salida para María Rodríguez' })).not.toBeInTheDocument())
    expect(screen.getByText((_, node) => node?.textContent === 'Salida 05:12 PM')).toBeInTheDocument()
  })

  it('abre el formulario de corrección y envía solo el ajuste autorizado de entrada', async () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Corregir marcaje de María Rodríguez' }))
    expect(screen.getByRole('dialog', { name: 'Corregir marcaje — María Rodríguez' })).toBeInTheDocument()
    expect(screen.getByText(/la salida permanecerá pendiente/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Hora de entrada'), { target: { value: '08:30' } })
    fireEvent.change(screen.getByLabelText(/Motivo de la corrección/), { target: { value: 'Error de digitación' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar corrección' }))

    await waitFor(() => expect(mocks.corregir).toHaveBeenCalledExactlyOnceWith({
      registroId: 'attendance-2',
      horaEntradaAnterior: '08:10',
      horaSalidaAnterior: null,
      horaEntrada: '08:30',
      horaSalida: null,
      motivo: 'Error de digitación',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('confirma con motivo la anulación de entrada y registra la ausencia sin salida', async () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Anular entrada y marcar ausente a María Rodríguez' }))
    expect(screen.getByRole('dialog', { name: 'Anular entrada y registrar ausencia' })).toBeInTheDocument()
    expect(screen.getByText(/Se limpiarán la entrada y las horas/)).toBeInTheDocument()
    const confirmar = screen.getByRole('button', { name: 'Confirmar ausencia' })
    expect(confirmar).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Motivo de la anulación/), { target: { value: 'Entrada marcada por error; empleado ausente' } })
    expect(confirmar).toBeEnabled()
    fireEvent.click(confirmar)

    await waitFor(() => expect(mocks.anularAusencia).toHaveBeenCalledExactlyOnceWith({
      registroId: 'attendance-2',
      motivo: 'Entrada marcada por error; empleado ausente',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Anular entrada y registrar ausencia' })).not.toBeInTheDocument())
  })

  it('busca nombres sin distinguir acentos y filtra por estado', () => {
    renderPanel()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar empleado por nombre o cargo' }), { target: { value: 'maria' } })
    expect(screen.getByRole('button', { name: 'Marcar salida para María Rodríguez' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar empleado por nombre o cargo' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'En jornada 1' }))
    expect(screen.getByRole('button', { name: 'Marcar salida para María Rodríguez' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' })).not.toBeInTheDocument()
  })

  it('pausa acciones si falla una consulta o si ya hay un marcaje en proceso', () => {
    mocks.query = { ...mocks.query, isError: true }
    const view = renderPanel()
    expect(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('las acciones están pausadas')
    expect(mocks.entrada).not.toHaveBeenCalled()

    mocks.query = { ...mocks.query, isError: false }
    mocks.entradaPending = true
    view.rerender(<MarcajeLogisticaPanel empleados={empleados} />)
    expect(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' })).toBeDisabled()
  })

  it('expone controles cómodos para iPhone y no muestra acciones al rol sin capacidad', () => {
    const view = renderPanel()
    const buscador = screen.getByRole('searchbox', { name: 'Buscar empleado por nombre o cargo' })
    const entrada = screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' })
    expect(buscador).toHaveClass('text-[16px]', 'min-h-12', 'w-full', 'min-w-0')
    expect(entrada).toHaveClass('min-h-12', 'w-full')
    expect(screen.getByRole('list', { name: 'Lista de marcajes de hoy' })).toHaveClass('grid-cols-1', 'lg:grid-cols-2')

    mocks.session.perfil = { rol: 'finanzas', nombre: 'Finanzas' }
    view.rerender(<MarcajeLogisticaPanel empleados={empleados} />)
    expect(screen.queryByRole('region', { name: 'Marcaje real de hoy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar (?:entrada|salida)/ })).not.toBeInTheDocument()
  })

  it('marca la ausencia de quien no vino y permite deshacerla sin tocar el reloj real', async () => {
    const view = renderPanel()

    expect(screen.getByRole('button', { name: 'Marcar ausencia de hoy para Alejandra Hidalgo' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar ausencia de hoy para Alejandra Hidalgo' }))
    await waitFor(() => expect(mocks.ausencia).toHaveBeenCalledExactlyOnceWith({ empleadoId: 'emp-1', quitar: false }))

    // Tras refrescar, la persona aparece en ausencia y el único camino de vuelta es deshacer.
    mocks.query = {
      ...mocks.query,
      data: {
        ...mocks.query.data,
        registros: [...mocks.query.data.registros, { empleado_id: 'emp-1', es_ausencia: true, estado_marcaje: 'manual' }],
      },
    }
    view.rerender(<MarcajeLogisticaPanel empleados={empleados} />)

    const deshacer = screen.getByRole('button', { name: 'Deshacer la ausencia de hoy de Alejandra Hidalgo' })
    expect(deshacer).toBeEnabled()
    fireEvent.click(deshacer)
    await waitFor(() => expect(mocks.ausencia).toHaveBeenLastCalledWith({ empleadoId: 'emp-1', quitar: true }))
    expect(mocks.ausencia).toHaveBeenCalledTimes(2)

    // Una jornada real no se deshace desde aquí: eso es «Corregir marcaje».
    expect(screen.getByRole('button', { name: 'Deshacer la ausencia de hoy de Lucía Pérez' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Deshacer.*María Rodríguez/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Corregir marcaje de María Rodríguez' })).toBeEnabled()
  })

  it('el sábado de quien no trabaja ese día es Día libre y no pide ausencia', () => {
    mocks.hoy = '2026-09-26'
    mocks.query = { ...mocks.query, data: { fecha: '2026-09-26', registros: [] } }
    renderPanel({
      empleados: [
        { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Vendedor', empleado: { nombre: 'Niki Ramirez' }, dias_laborables: [1, 2, 3, 4, 5] },
        { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Vendedor', empleado: { nombre: 'Josue Marciales' }, dias_laborables: [1, 2, 3, 4, 5, 6] },
      ],
    })

    expect(screen.getByRole('button', { name: 'Día libre 1' })).toBeInTheDocument()
    expect(screen.getByText((_, node) => node?.textContent === 'Hoy no le toca trabajar (Sáb). Si vino, márcalo igual.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar entrada en día libre para Niki Ramirez' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar ausencia de hoy para Niki Ramirez' })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Marcar entrada para Josue Marciales' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar ausencia de hoy para Josue Marciales' })).toBeInTheDocument()
    expect(screen.getAllByText((_, node) => node?.textContent === 'Hoy no le toca trabajar (Sáb). Si vino, márcalo igual.')).toHaveLength(1)
  })

  it('el domingo es Día libre para todos, aunque su ficha marque la semana completa', () => {
    mocks.hoy = '2026-09-27'
    mocks.query = { ...mocks.query, data: { fecha: '2026-09-27', registros: [] } }
    renderPanel()

    expect(screen.getByRole('button', { name: 'Día libre 5' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pendientes 0' })).toBeInTheDocument()
    expect(screen.getAllByText((_, node) => node?.textContent === 'Hoy no le toca trabajar (Dom). Si vino, márcalo igual.')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /Marcar ausencia de hoy/ })).not.toBeInTheDocument()
  })

  // F-6: en un feriado no laborable nadie suma pendientes ni se ofrece ausencia;
  // quien vino se puede marcar igual (el feriado trabajado se paga con recargo).
  it('un feriado no laborable no pide asistencia ni ofrece ausencia', () => {
    renderPanel({
      feriadosPorFecha: new Map([['2026-09-25', { fecha: '2026-09-25', nombre: 'Feriado patronal', laborable: false }]]),
    })

    expect(screen.getByText(/Feriado: Feriado patronal/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pendientes 0' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar ausencia de hoy/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar entrada en día libre para Alejandra Hidalgo' })).toBeEnabled()
  })

  it('un feriado laborable sí se trabaja y admite ausencia', () => {
    renderPanel({
      feriadosPorFecha: new Map([['2026-09-25', { fecha: '2026-09-25', nombre: 'Feriado laborable', laborable: true }]]),
    })

    expect(screen.getByText(/se espera asistencia/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pendientes 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar ausencia de hoy para Alejandra Hidalgo' })).toBeEnabled()
  })

  it('ofrece reintentar marcajes y empleados cuando falla su carga', () => {
    const retryEmployees = vi.fn().mockResolvedValue({})
    mocks.query = { ...mocks.query, isError: true }
    renderPanel({ empleadosError: true, onReintentarEmpleados: retryEmployees })

    fireEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }))
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1)
    expect(retryEmployees).toHaveBeenCalledTimes(1)
  })
})
