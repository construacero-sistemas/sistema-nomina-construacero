// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({
  // Fecha operativa del servidor (America/Caracas) para esta prueba: cada caso la
  // ancla a la fecha de su fixture y así no depende del día real de ejecución.
  hoy: '2026-09-25',
  // Hora operativa (America/Caracas) para la regla de salida corta (M-8).
  hora: '12:00',
  session: { perfil: { rol: 'nomina', nombre: 'Operadora' } },
  query: { data: null, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() },
  entrada: vi.fn().mockResolvedValue({ ok: true }),
  salida: vi.fn().mockResolvedValue({ ok: true }),
  ausencia: vi.fn().mockResolvedValue({ ok: true }),
  corregir: vi.fn().mockResolvedValue({ ok: true }),
  anularAusencia: vi.fn().mockResolvedValue({ ok: true }),
  deshacer: vi.fn().mockResolvedValue({ ok: true }),
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
  horaOperativaAhora: () => mocks.hora,
}))
vi.mock('../../../hooks/useNomina.js', () => ({
  useMarcajeHoy: () => mocks.query,
  useConfigNomina: () => ({ data: { nomina_horas_descanso: 0.5 } }),
  useMarcarEntrada: () => ({ mutateAsync: mocks.entrada, isPending: mocks.entradaPending }),
  useMarcarSalida: () => ({ mutateAsync: mocks.salida, isPending: mocks.salidaPending }),
  useMarcarAusencia: () => ({ mutateAsync: mocks.ausencia, isPending: mocks.ausenciaPending }),
  useCorregirMarcaje: () => ({ mutateAsync: mocks.corregir, isPending: false }),
  useAnularEntradaComoAusencia: () => ({ mutateAsync: mocks.anularAusencia, isPending: false }),
  useDeshacerMarcaje: () => ({ mutateAsync: mocks.deshacer, isPending: false }),
}))

import MarcajeLogisticaPanel from '../MarcajeLogisticaPanel.jsx'

const empleados = [
  { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Administración', empleado: { nombre: 'Alejandra Hidalgo' } },
  { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Chofer', empleado: { nombre: 'María Rodríguez' } },
  { id: 'cfg-3', empleado_id: 'emp-3', cargo: 'Vendedor', empleado: { nombre: 'Edgar Ramirez' } },
  { id: 'cfg-4', empleado_id: 'emp-4', cargo: 'Técnico', empleado: { nombre: 'Lucía Pérez' } },
  { id: 'cfg-5', empleado_id: 'emp-5', cargo: 'Almacén', empleado: { nombre: 'José Duarte' } },
]

// El panel abre en «Pendientes» cuando los hay (D-2). La mayoría de los casos
// revisan varios estados a la vez, así que pasan a «Todos» salvo que se pida lo contrario.
function abrirMasAcciones(nombre) {
  fireEvent.click(screen.getByRole('button', { name: `Más acciones de ${nombre}` }))
}

function renderPanel(props = {}, { verTodos = true } = {}) {
  const vista = render(<MarcajeLogisticaPanel empleados={empleados} {...props} />)
  if (verTodos) {
    const todos = screen.queryByRole('button', { name: /^Todos \d+$/ })
    if (todos) fireEvent.click(todos)
  }
  return vista
}

beforeEach(() => {
  mocks.hoy = '2026-09-25'
  mocks.hora = '12:00'
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
  mocks.deshacer = vi.fn().mockResolvedValue({ ok: true })
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
    expect(screen.queryByRole('button', { name: /Corregir .* de María Rodríguez/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Más acciones de María Rodríguez' })).toHaveAttribute('aria-expanded', 'false')
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
    expect(mocks.entrada).toHaveBeenCalledExactlyOnceWith({ empleadoId: 'emp-1', nombre: 'Alejandra Hidalgo', idempotencyKey: expect.stringMatching(/^entrada-emp-1-/) })

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
    expect(mocks.salida).toHaveBeenCalledExactlyOnceWith({ empleadoId: 'emp-2', nombre: 'María Rodríguez', idempotencyKey: expect.stringMatching(/^salida-emp-2-/) })

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

    abrirMasAcciones('María Rodríguez')
    fireEvent.click(screen.getByRole('button', { name: 'Corregir hora de María Rodríguez' }))
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

    abrirMasAcciones('María Rodríguez')
    fireEvent.click(screen.getByRole('button', { name: 'No vino — marcar ausente — María Rodríguez' }))
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
      resultadoEsperado: 'ausencia',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Anular entrada y registrar ausencia' })).not.toBeInTheDocument())
  })

  // M-1: en día libre o feriado no laborable no hay falta que registrar. El botón no
  // promete una ausencia que el servidor rechazaría: anula la entrada y deja el día
  // sin registro, y envía ese resultado esperado para que el servidor lo confirme.
  it.each([
    ['día libre (sábado de quien no trabaja)', '2026-09-26', null],
    ['feriado no laborable', '2026-09-25', { fecha: '2026-09-25', nombre: 'Feriado patronal', laborable: false }],
  ])('en %s ofrece «Anular entrada (no vino)» y no una ausencia', async (_caso, fecha, feriado) => {
    mocks.hoy = fecha
    mocks.query = { ...mocks.query, data: { fecha, registros: [
      { id: 'attendance-9', empleado_id: 'emp-1', hora_entrada: '08:05:00', hora_salida: null, estado_marcaje: 'entrada' },
    ] } }
    renderPanel({
      empleados: [{ id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Vendedor', empleado: { nombre: 'Niki Ramirez' }, dias_laborables: [1, 2, 3, 4, 5] }],
      feriadosPorFecha: feriado ? new Map([[fecha, feriado]]) : null,
    })

    abrirMasAcciones('Niki Ramirez')
    expect(screen.queryByRole('button', { name: /marcar ausente/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'No vino — anular entrada — Niki Ramirez' }))
    expect(screen.getByRole('dialog', { name: 'Anular entrada' })).toBeInTheDocument()
    expect(screen.getByText(/el día quedará sin registro/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Motivo de la anulación/), { target: { value: 'Marcado por error' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anular entrada' }))

    await waitFor(() => expect(mocks.anularAusencia).toHaveBeenCalledExactlyOnceWith({
      registroId: 'attendance-9', motivo: 'Marcado por error', resultadoEsperado: 'sin-registro',
    }))
  })

  it('si el servidor rechaza la anulación, el modal sigue abierto con el motivo del rechazo', async () => {
    mocks.anularAusencia = vi.fn().mockRejectedValue(new Error('Hoy no es laborable para esta persona'))
    renderPanel()
    abrirMasAcciones('María Rodríguez')
    fireEvent.click(screen.getByRole('button', { name: 'No vino — marcar ausente — María Rodríguez' }))
    fireEvent.change(screen.getByLabelText(/Motivo de la anulación/), { target: { value: 'Error de dedo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ausencia' }))

    expect(await screen.findByText('Hoy no es laborable para esta persona')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Anular entrada y registrar ausencia' })).toBeInTheDocument()
  })

  // M-3: si no hubo respuesta del servidor la acción pudo guardarse. «Reintentar»
  // repite la MISMA petición (misma clave) para que el servidor no la duplique.
  it('tras un corte de red ofrece reintentar con la misma clave de idempotencia', async () => {
    mocks.entrada = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, idempotente: true })
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' }))
    expect(await screen.findByText(/No hubo respuesta del servidor/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    await waitFor(() => expect(mocks.entrada).toHaveBeenCalledTimes(2))
    const [primera, segunda] = mocks.entrada.mock.calls.map(([variables]) => variables.idempotencyKey)
    expect(primera).toMatch(/^entrada-emp-1-/)
    expect(segunda).toBe(primera)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument())
  })

  it('un rechazo con respuesta del servidor no ofrece reintentar y un clic nuevo usa otra clave', async () => {
    const rechazo = Object.assign(new Error('El empleado ya tiene entrada marcada hoy'), { status: 409 })
    mocks.entrada = vi.fn().mockRejectedValue(rechazo)
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' }))
    expect(await screen.findByText('El empleado ya tiene entrada marcada hoy')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' }))
    await waitFor(() => expect(mocks.entrada).toHaveBeenCalledTimes(2))
    const [primera, segunda] = mocks.entrada.mock.calls.map(([variables]) => variables.idempotencyKey)
    expect(segunda).not.toBe(primera)
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

  it('pausa todas las acciones si falla una consulta', () => {
    mocks.query = { ...mocks.query, isError: true }
    renderPanel()
    expect(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Marcar salida para María Rodríguez' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('las acciones están pausadas')
    expect(mocks.entrada).not.toHaveBeenCalled()
  })

  // M-4: el bloqueo es por persona. Mientras se marca a una, las demás siguen
  // operables, y una recarga de fondo no congela el panel.
  it('bloquea solo la tarjeta en acción y no se congela con una recarga de fondo', async () => {
    let resolver
    mocks.entrada = vi.fn(() => new Promise(resolve => { resolver = resolve }))
    mocks.query = { ...mocks.query, isFetching: true }
    renderPanel()
    expect(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcando entrada… para Alejandra Hidalgo' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Marcar salida para María Rodríguez' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Marcando entrada… para Alejandra Hidalgo' }))
    expect(mocks.entrada).toHaveBeenCalledTimes(1)

    await act(async () => { resolver({ ok: true }) })
    expect(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' })).toBeEnabled()
  })

  // D-2: se abre en lo que pide acción; M-5: lo recién marcado no desaparece.
  it('abre en «Pendientes» y la persona recién marcada sigue visible con su nuevo estado', async () => {
    const view = renderPanel({}, { verTodos: false })
    expect(screen.getByRole('button', { name: 'Pendientes 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('heading', { name: 'María Rodríguez' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' }))
    await waitFor(() => expect(mocks.entrada).toHaveBeenCalledTimes(1))
    mocks.query = { ...mocks.query, data: { ...mocks.query.data, registros: [...mocks.query.data.registros, {
      id: 'attendance-1', empleado_id: 'emp-1', hora_entrada: '08:42:00', hora_salida: null, estado_marcaje: 'entrada',
    }] } }
    view.rerender(<MarcajeLogisticaPanel empleados={empleados} />)

    expect(await screen.findByRole('button', { name: 'Marcar salida para Alejandra Hidalgo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pendientes 0' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sin pendientes abre en «En jornada»', () => {
    mocks.query = { ...mocks.query, data: { ...mocks.query.data, registros: [...mocks.query.data.registros, {
      empleado_id: 'emp-1', hora_entrada: '08:00:00', hora_salida: null, estado_marcaje: 'entrada',
    }] } }
    renderPanel({}, { verTodos: false })
    expect(screen.getByRole('button', { name: 'En jornada 2' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('el orden no cambia al marcar; se reordena al pulsar «Actualizar»', async () => {
    const nombres = () => screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent)
    const view = renderPanel()
    const antes = nombres()
    expect(antes.slice(0, 3)).toEqual(['Alejandra Hidalgo', 'María Rodríguez', 'Edgar Ramirez'])

    fireEvent.click(screen.getByRole('button', { name: 'Marcar salida para María Rodríguez' }))
    await waitFor(() => expect(mocks.salida).toHaveBeenCalledTimes(1))
    mocks.query = { ...mocks.query, data: { ...mocks.query.data, registros: mocks.query.data.registros.map(r => (r.empleado_id === 'emp-2'
      ? { ...r, hora_salida: '17:00:00', estado_marcaje: 'completo' } : r)) } }
    view.rerender(<MarcajeLogisticaPanel empleados={empleados} />)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Marcar salida para María Rodríguez' })).not.toBeInTheDocument())
    expect(nombres()).toEqual(antes)

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar marcajes y empleados' }))
    expect(nombres().slice(0, 3)).toEqual(['Alejandra Hidalgo', 'Edgar Ramirez', 'María Rodríguez'])
  })

  // M-6: deshacer con un toque, con la misma clave de la acción y solo un rato.
  it('ofrece deshacer la entrada recién marcada con su clave y lo retira al vencer el plazo', async () => {
    // Solo se falsea el reloj (Date): el intervalo real de 1 s refresca la cuenta regresiva.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      mocks.entrada = vi.fn().mockResolvedValue({ ok: true, registro: { id: 'r-nuevo', empleado_id: 'emp-1', hora_entrada: '08:02:00' } })
      mocks.salida = vi.fn().mockResolvedValue({ ok: true, registro: { id: 'attendance-2', empleado_id: 'emp-2', hora_salida: '12:00:00' } })
      renderPanel()
      fireEvent.click(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' }))
      const deshacer = await screen.findByRole('button', { name: 'Deshacer entrada de Alejandra Hidalgo' })
      expect(deshacer).toHaveTextContent(/Deshacer entrada \(1:5\d\)/)

      fireEvent.click(deshacer)
      await waitFor(() => expect(mocks.deshacer).toHaveBeenCalledExactlyOnceWith({
        registroId: 'r-nuevo', tipo: 'entrada', idempotencyKey: mocks.entrada.mock.calls[0][0].idempotencyKey,
      }))

      fireEvent.click(screen.getByRole('button', { name: 'Marcar salida para María Rodríguez' }))
      await screen.findByRole('button', { name: 'Deshacer salida de María Rodríguez' })
      vi.setSystemTime(Date.now() + 116_000)
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Deshacer salida de María Rodríguez' })).not.toBeInTheDocument(), { timeout: 2500 })
    } finally {
      vi.useRealTimers()
    }
  })

  // M-7: «Llegó» convierte la ausencia en entrada con un solo toque.
  it('desde una ausencia, «Llegó» marca la entrada reemplazando la ausencia', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Llegó: marcar entrada de Lucía Pérez' }))
    await waitFor(() => expect(mocks.entrada).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      empleadoId: 'emp-4', reemplazarAusencia: true,
    })))
    expect(screen.getByRole('button', { name: 'Deshacer ausencia de Lucía Pérez' })).toBeInTheDocument()
  })

  // M-8: una salida a minutos de la entrada (p. ej. doble toque) pide un segundo toque.
  it('una salida antes de 15 min pide confirmar con un segundo toque', async () => {
    mocks.hora = '08:15'
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar salida para María Rodríguez' }))
    const confirmar = await screen.findByRole('button', { name: /¿Salida tras 5 min\? Toca otra vez para confirmar la salida de María Rodríguez/ })
    expect(confirmar).toHaveTextContent('¿Salida tras 5 min? Toca otra vez')
    expect(mocks.salida).not.toHaveBeenCalled()

    fireEvent.click(confirmar)
    await waitFor(() => expect(mocks.salida).toHaveBeenCalledTimes(1))
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

    expect(screen.getByRole('button', { name: 'Marcar ausente a Alejandra Hidalgo' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar ausente a Alejandra Hidalgo' }))
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

    const deshacer = screen.getByRole('button', { name: 'Deshacer ausencia de Alejandra Hidalgo' })
    expect(deshacer).toBeEnabled()
    fireEvent.click(deshacer)
    await waitFor(() => expect(mocks.ausencia).toHaveBeenLastCalledWith({ empleadoId: 'emp-1', quitar: true }))
    expect(mocks.ausencia).toHaveBeenCalledTimes(2)

    // Una jornada real no se deshace desde aquí: eso es «Corregir marcaje».
    expect(screen.getByRole('button', { name: 'Deshacer ausencia de Lucía Pérez' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Deshacer ausencia de María Rodríguez/ })).not.toBeInTheDocument()
    abrirMasAcciones('María Rodríguez')
    expect(screen.getByRole('button', { name: 'Corregir hora de María Rodríguez' })).toBeEnabled()
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
    expect(screen.getByRole('button', { name: 'Marcar entrada (vino) para Niki Ramirez' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar ausente a Niki Ramirez' })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Marcar entrada para Josue Marciales' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar ausente a Josue Marciales' })).toBeInTheDocument()
    expect(screen.getAllByText((_, node) => node?.textContent === 'Hoy no le toca trabajar (Sáb). Si vino, márcalo igual.')).toHaveLength(1)
  })

  it('el domingo es Día libre para todos, aunque su ficha marque la semana completa', () => {
    mocks.hoy = '2026-09-27'
    mocks.query = { ...mocks.query, data: { fecha: '2026-09-27', registros: [] } }
    renderPanel()

    expect(screen.getByRole('button', { name: 'Día libre 5' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pendientes 0' })).toBeInTheDocument()
    expect(screen.getAllByText((_, node) => node?.textContent === 'Hoy no le toca trabajar (Dom). Si vino, márcalo igual.')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /Marcar ausente a / })).not.toBeInTheDocument()
  })

  // F-6: en un feriado no laborable nadie suma pendientes ni se ofrece ausencia;
  // quien vino se puede marcar igual (el feriado trabajado se paga con recargo).
  it('un feriado no laborable no pide asistencia ni ofrece ausencia', () => {
    renderPanel({
      feriadosPorFecha: new Map([['2026-09-25', { fecha: '2026-09-25', nombre: 'Feriado patronal', laborable: false }]]),
    })

    expect(screen.getByText(/Feriado: Feriado patronal/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pendientes 0' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar ausente a / })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar entrada (vino) para Alejandra Hidalgo' })).toBeEnabled()
  })

  it('un feriado laborable sí se trabaja y admite ausencia', () => {
    renderPanel({
      feriadosPorFecha: new Map([['2026-09-25', { fecha: '2026-09-25', nombre: 'Feriado laborable', laborable: true }]]),
    })

    expect(screen.getByText(/se espera asistencia/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pendientes 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marcar ausente a Alejandra Hidalgo' })).toBeEnabled()
  })

  it('ofrece reintentar marcajes y empleados cuando falla su carga', () => {
    const retryEmployees = vi.fn().mockResolvedValue({})
    mocks.query = { ...mocks.query, isError: true }
    renderPanel({ empleadosError: true, onReintentarEmpleados: retryEmployees })

    fireEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }))
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1)
    expect(retryEmployees).toHaveBeenCalledTimes(1)
  })

  // M-10: en jornada, una sola acción principal; lo demás en un disclosure en línea.
  it('en jornada muestra solo «Marcar salida» y abre «Más acciones» como disclosure accesible', () => {
    renderPanel()
    const mas = screen.getByRole('button', { name: 'Más acciones de María Rodríguez' })
    expect(mas).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /No vino/ })).not.toBeInTheDocument()

    fireEvent.click(mas)
    expect(mas).toHaveAttribute('aria-expanded', 'true')
    const region = document.getElementById(mas.getAttribute('aria-controls'))
    expect(region).toContainElement(screen.getByRole('button', { name: 'Corregir hora de María Rodríguez' }))
    expect(region).toContainElement(screen.getByRole('button', { name: 'No vino — marcar ausente — María Rodríguez' }))

    fireEvent.click(mas)
    expect(mas).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Corregir hora de María Rodríguez' })).not.toBeInTheDocument()
  })

  // M-11: informativo, con la hora operativa.
  it('muestra el tiempo en jornada y el retraso respecto a la hora de inicio', () => {
    mocks.hora = '12:00'
    const conHorario = empleados.map(e => (e.empleado_id === 'emp-1' ? { ...e, hora_inicio: '08:00:00' } : e))
    renderPanel({ empleados: conHorario })
    expect(screen.getByText('En jornada 3 h 50 min')).toBeInTheDocument()
    expect(screen.getByText((_, node) => node?.textContent === 'Entra 08:00 AM')).toBeInTheDocument()
    expect(screen.getByText('Retraso 4 h')).toBeInTheDocument()
  })

  it('dentro de la tolerancia no muestra retraso, y sin hora de inicio no muestra nada', () => {
    mocks.hora = '08:09'
    const conHorario = empleados.map(e => (e.empleado_id === 'emp-1' ? { ...e, hora_inicio: '08:00' } : e))
    const vista = renderPanel({ empleados: conHorario })
    expect(screen.getAllByText((_, node) => node?.textContent === 'Entra 08:00 AM').length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Retraso/)).not.toBeInTheDocument()
    vista.unmount()
    renderPanel()
    expect(screen.queryByText(/^Entra /)).not.toBeInTheDocument()
  })

  // M-13 (guardarraíl permanente): el nombre accesible de CADA botón contiene su
  // texto visible. Cualquier botón nuevo del panel queda cubierto automáticamente.
  it('el nombre accesible de todos los botones contiene su texto visible', () => {
    const normalizar = texto => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    const textoVisible = boton => {
      const copia = boton.cloneNode(true)
      copia.querySelectorAll('[aria-hidden="true"], .sr-only').forEach(nodo => nodo.remove())
      return normalizar(copia.textContent)
    }
    const revisar = () => {
      for (const boton of screen.getAllByRole('button')) {
        const visible = textoVisible(boton)
        if (!visible) continue
        const nombre = normalizar(boton.getAttribute('aria-label') || boton.textContent)
        expect(nombre, `botón «${visible}»`).toContain(visible)
      }
    }
    mocks.hora = '08:15'
    renderPanel()
    abrirMasAcciones('María Rodríguez')
    revisar()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar salida para María Rodríguez' }))
    revisar()
    cleanup()
    mocks.hoy = '2026-09-26'
    mocks.query = { ...mocks.query, data: { fecha: '2026-09-26', registros: [] } }
    renderPanel({ empleados: [{ id: 'cfg-1', empleado_id: 'emp-1', empleado: { nombre: 'Niki Ramirez' }, dias_laborables: [1, 2, 3, 4, 5] }] })
    revisar()
  })

  // M-14: una sola región viva; las tarjetas no se anuncian solas en cada recarga.
  it('anuncia la última acción en una única región viva', async () => {
    mocks.entrada = vi.fn().mockResolvedValue({ ok: true, registro: { id: 'r-1', empleado_id: 'emp-1', hora_entrada: '08:02:00' } })
    const { container } = renderPanel()
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1)
    expect(screen.getByRole('list', { name: 'Lista de marcajes de hoy' }).querySelectorAll('[role="status"]')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Marcar entrada para Alejandra Hidalgo' }))
    await waitFor(() => expect(container.querySelector('[aria-live]')).toHaveTextContent('Entrada de Alejandra Hidalgo marcada a las 08:02 AM'))
  })
})
