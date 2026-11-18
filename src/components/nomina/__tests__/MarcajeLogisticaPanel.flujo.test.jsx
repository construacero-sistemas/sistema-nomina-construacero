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

// Fases 2–4 de docs/PLAN_MARCAJE_BOTONES_UX.md (M-4 … M-14). Mismo arnés que
// MarcajeLogisticaPanel.test.jsx; separado para respetar el límite de 600 líneas.
describe('Marcaje real de hoy — flujo operativo y accesibilidad', () => {
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
