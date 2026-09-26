// @vitest-environment jsdom
// src/components/nomina/__tests__/TabAsistencia.test.jsx
// F-5: `CeldaAsistencia` decidía con `libre || esFinde` y `esFinde` era sábado/domingo
// PARA TODOS, así que el sábado de quien sí trabaja se pintaba «Libre» en vez del «+»
// de pendiente. El descanso de fin de semana ahora depende de la semana de cada persona.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({ asistencia: { registros: [], truncado: false } }))

const configs = [
  {
    id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Chofer', horas_jornada: 8,
    activo: true, controla_asistencia: true, dias_laborables: [1, 2, 3, 4, 5, 6], horario_configurado: true,
    empleado: { id: 'emp-1', nombre: 'Carlos Mendoza' },
  },
  {
    id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Vendedor', horas_jornada: 8,
    activo: true, controla_asistencia: true, dias_laborables: [1, 2, 3, 4, 5], horario_configurado: true,
    empleado: { id: 'emp-2', nombre: 'María Rodríguez' },
  },
]

vi.mock('../../../hooks/useNomina', () => ({
  useConfigEmpleados: () => ({ data: configs, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useAsistencia: () => ({ data: mocks.asistencia, isLoading: false, isError: false, refetch: vi.fn() }),
  useFeriados: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useConfigNomina: () => ({ data: {} }),
}))
// Los flujos hijos tienen sus propias pruebas: aquí solo interesa la grilla semanal.
vi.mock('../MarcajeLogisticaPanel', () => ({ default: () => null }))
vi.mock('../AsistenciaDiariaMovil', () => ({ default: () => null }))
vi.mock('../AsistenciaModal', () => ({ default: () => null }))
vi.mock('../AsistenciaMasivaModal', () => ({ default: () => null }))

import TabAsistencia from '../TabAsistencia.jsx'

// «Hoy» es sábado 12/09/2026: la semana visible es del lunes 7 al domingo 13.
beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-12T12:00:00'))
})
afterAll(() => vi.useRealTimers())

function filaDe(nombre) {
  return screen.getAllByRole('row').find(row => within(row).queryByText(nombre))
}

describe('TabAsistencia — sábado laborable (F-5)', () => {
  it('pinta pendiente el sábado de quien trabaja y libre el de quien no', () => {
    mocks.asistencia = { registros: [], truncado: false }
    render(<TabAsistencia esAdmin={false} puedeGestionarNomina />)

    const carlos = filaDe('Carlos Mendoza')
    const maria = filaDe('María Rodríguez')
    expect(carlos).toBeTruthy()
    expect(maria).toBeTruthy()

    // Carlos trabaja de lunes a sábado: seis «+» de registro y solo el domingo libre.
    expect(within(carlos).getAllByLabelText('Registrar asistencia')).toHaveLength(6)
    expect(within(carlos).getAllByLabelText(/Día no laborable/)).toHaveLength(1)

    // María no trabaja sábado ni domingo: cinco «+» y dos celdas de día libre.
    expect(within(maria).getAllByLabelText('Registrar asistencia')).toHaveLength(5)
    expect(within(maria).getAllByLabelText(/Día no laborable/)).toHaveLength(2)
  })

  // F-11: la lectura llega paginada y puede venir corta; la vista debe decirlo en vez
  // de mostrar totales incompletos como si fueran la semana entera.
  it('avisa cuando la lectura del rango quedó truncada', () => {
    mocks.asistencia = { registros: [], truncado: true }
    render(<TabAsistencia esAdmin={false} puedeGestionarNomina />)

    expect(screen.getByRole('alert')).toHaveTextContent(/la lista y los totales están incompletos/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/Consulta por semana/i)
  })
})
