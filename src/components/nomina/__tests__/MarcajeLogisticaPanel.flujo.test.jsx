// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  useAsistencia: () => ({ data: { registros: [] }, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useConfigNomina: () => ({ data: { nomina_horas_descanso: 1 } }),
  useRegistrarHorasExtra: () => ({ mutateAsync: mocks.horasExtra, isPending: false }),
  useMarcarDiaTrabajado: () => ({ mutateAsync: mocks.diaTrabajado, isPending: false }),
  useMarcarAusencia: () => ({ mutateAsync: mocks.ausencia, isPending: false }),
}))

import MarcajeLogisticaPanel from '../MarcajeLogisticaPanel.jsx'

const empleados = [
  { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Administración', hora_inicio: '08:00', hora_fin: '17:00', horas_jornada: 8, empleado: { nombre: 'Alejandra Hidalgo' } },
  { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Chofer', empleado: { nombre: 'María Rodríguez' } },
  { id: 'cfg-3', empleado_id: 'emp-3', cargo: 'Técnico', dias_laborables: [1, 2, 3, 4], empleado: { nombre: 'José Duarte' } },
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
        { empleado_id: 'emp-2', horas_extra: 1, estado_marcaje: 'manual' },
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

describe('Asistencia de hoy — flujo operativo y accesibilidad', () => {
  it('bloquea solo la tarjeta en acción sin congelar las demás', async () => {
    let resolver
    mocks.diaTrabajado = vi.fn(() => new Promise(resolve => { resolver = resolve }))
    mocks.query = { ...mocks.query, isFetching: true }
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar día trabajado de José Duarte' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcando día… de José Duarte' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Horas extras de Alejandra Hidalgo' })).toBeEnabled()

    await act(async () => { resolver({ ok: true }) })
    expect(screen.getByRole('button', { name: 'Marcar día trabajado de José Duarte' })).toBeEnabled()
  })

  it('el orden visual no salta al editar; se reordena al pulsar Actualizar', async () => {
    const nombres = () => screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent)
    const view = renderPanel()
    const antes = nombres()
    // Prioridad inicial: extra (emp-2 María), presente (emp-1 Alejandra), libre (emp-3 José)
    expect(antes).toEqual(['María Rodríguez', 'Alejandra Hidalgo', 'José Duarte'])

    fireEvent.click(screen.getByRole('button', { name: 'Horas extras de Alejandra Hidalgo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horas extras de Alejandra Hidalgo' }))
    await waitFor(() => expect(mocks.horasExtra).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Marcar día trabajado de José Duarte' }))
    await waitFor(() => expect(mocks.diaTrabajado).toHaveBeenCalledTimes(1))

    mocks.query = {
      ...mocks.query,
      data: {
        ...mocks.query.data,
        registros: [
          { empleado_id: 'emp-1', horas_extra: 1, estado_marcaje: 'manual' },
          { empleado_id: 'emp-2', horas_extra: 1, estado_marcaje: 'manual' },
          { empleado_id: 'emp-3', horas_extra: 0, estado_marcaje: 'manual' },
        ],
      },
    }
    view.rerender(<MarcajeLogisticaPanel empleados={empleados} />)
    expect(nombres()).toEqual(antes)

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar asistencia y empleados' }))
    expect(nombres()).toEqual(['Alejandra Hidalgo', 'María Rodríguez', 'José Duarte'])
  })

  it('permite marcar día de descanso como trabajado y luego quitarlo', async () => {
    const view = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar día trabajado de José Duarte' }))
    await waitFor(() => expect(mocks.diaTrabajado).toHaveBeenCalledWith({
      empleadoId: 'emp-3', quitar: false, nombre: 'José Duarte',
    }))

    mocks.query = {
      ...mocks.query,
      data: { ...mocks.query.data, registros: [...mocks.query.data.registros, { empleado_id: 'emp-3', horas_extra: 0, estado_marcaje: 'manual' }] },
    }
    view.rerender(<MarcajeLogisticaPanel empleados={empleados} />)

    fireEvent.click(screen.getByRole('button', { name: 'Quitar día trabajado de José Duarte' }))
    await waitFor(() => expect(mocks.diaTrabajado).toHaveBeenLastCalledWith({
      empleadoId: 'emp-3', quitar: true, nombre: 'José Duarte',
    }))
  })

  it('muestra error legible si falla una mutación de horas extras', async () => {
    mocks.horasExtra = vi.fn().mockRejectedValue(new Error('Horario no válido'))
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Horas extras de Alejandra Hidalgo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horas extras de Alejandra Hidalgo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Horario no válido')
  })

  it('el nombre accesible de todos los botones contiene su texto visible', () => {
    const normalizar = texto => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    const textoVisible = boton => {
      const copia = boton.cloneNode(true)
      copia.querySelectorAll('[aria-hidden="true"], .sr-only').forEach(nodo => nodo.remove())
      return normalizar(copia.textContent)
    }
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Horas extras de Alejandra Hidalgo' }))
    for (const boton of screen.getAllByRole('button')) {
      const visible = textoVisible(boton)
      if (!visible) continue
      const nombre = normalizar(boton.getAttribute('aria-label') || boton.textContent)
      expect(nombre, `botón «${visible}»`).toContain(visible)
    }
  })

  it('anuncia la última acción en una única región viva', async () => {
    const { container } = renderPanel()
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1)
    expect(screen.getByRole('list', { name: 'Lista de asistencia de hoy' }).querySelectorAll('[role="status"]')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Horas extras de Alejandra Hidalgo' }))
    fireEvent.click(screen.getByRole('button', { name: '+0.5h' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horas extras de Alejandra Hidalgo' }))
    await waitFor(() => expect(container.querySelector('[aria-live]')).toHaveTextContent('Horas extras de Alejandra Hidalgo guardadas (+0.5 h)'))
  })
})
