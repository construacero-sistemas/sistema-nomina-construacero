import { describe, expect, it } from 'vitest'
import { esMarcajeReal, estadoDelRegistro, normalizarBusqueda } from '../marcajeEstado.js'

describe('estadoDelRegistro', () => {
  it.each([
    ['sin registro en día laborable → presente por defecto', null, false, 'presente'],
    ['sin registro en día libre → libre', null, true, 'libre'],
    ['ausencia manual (aunque sea día libre)', { es_ausencia: true, estado_marcaje: 'manual' }, true, 'ausencia'],
    ['horario fijo sin horas extras', { estado_marcaje: 'manual', hora_entrada: '08:00', hora_salida: '17:00', horas_extra: 0 }, false, 'presente'],
    ['con horas extras en día laborable', { estado_marcaje: 'manual', horas_extra: 1.5 }, false, 'extra'],
    ['día libre/feriado marcado como trabajado', { estado_marcaje: 'manual', horas_extra: 0 }, true, 'descanso-trabajado'],
    ['día libre/feriado trabajado con extras sigue siendo descanso-trabajado', { estado_marcaje: 'manual', horas_extra: 2 }, true, 'descanso-trabajado'],
  ])('%s → %s', (_caso, registro, libre, esperado) => {
    expect(estadoDelRegistro(registro, libre)).toBe(esperado)
  })
})

describe('esMarcajeReal', () => {
  it('solo cuenta entradas del reloj, no ausencias ni horarios fijos', () => {
    expect(esMarcajeReal({ estado_marcaje: 'entrada', hora_entrada: '08:00' })).toBe(true)
    expect(esMarcajeReal({ estado_marcaje: 'corregido', hora_entrada: '08:00' })).toBe(true)
    expect(esMarcajeReal({ estado_marcaje: 'manual', hora_entrada: '08:00' })).toBe(false)
    expect(esMarcajeReal({ es_ausencia: true, estado_marcaje: 'manual' })).toBe(false)
    expect(esMarcajeReal(null)).toBe(false)
  })
})

describe('normalizarBusqueda', () => {
  it('ignora acentos, mayúsculas y espacios de borde', () => {
    expect(normalizarBusqueda('  María Rodríguez ')).toBe('maria rodriguez')
  })
})
