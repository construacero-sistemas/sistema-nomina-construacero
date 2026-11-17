import { describe, expect, it } from 'vitest'
import { esMarcajeReal, estadoDelRegistro, normalizarBusqueda } from '../marcajeEstado.js'

describe('estadoDelRegistro', () => {
  it.each([
    ['sin registro en día laborable', null, false, 'pendiente'],
    ['sin registro en día libre', null, true, 'libre'],
    ['ausencia manual (aunque sea día libre)', { es_ausencia: true, estado_marcaje: 'manual' }, true, 'ausencia'],
    ['horario fijo', { estado_marcaje: 'manual', hora_entrada: '08:00', hora_salida: '17:00' }, false, 'manual'],
    ['registro sin entrada', { estado_marcaje: 'entrada', hora_entrada: null }, false, 'pendiente'],
    ['entrada abierta', { estado_marcaje: 'entrada', hora_entrada: '08:00' }, false, 'en-curso'],
    ['entrada abierta en día libre', { estado_marcaje: 'entrada', hora_entrada: '08:00' }, true, 'en-curso'],
    ['corregido sin salida', { estado_marcaje: 'corregido', hora_entrada: '08:00' }, false, 'en-curso'],
    ['completo', { estado_marcaje: 'completo', hora_entrada: '08:00', hora_salida: '17:00' }, false, 'completado'],
    ['corregido con salida', { estado_marcaje: 'corregido', hora_entrada: '08:00', hora_salida: '17:00' }, false, 'completado'],
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
