// src/components/finanzas/__tests__/fechasRapidas.test.js
// Tests del módulo puro de rangos rápidos (Hoy/Ayer/Este mes).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getLocalIsoDate,
  isoToday,
  monthStart,
  weekStartIso,
  yesterdayIso,
  rangoRapidoActivo,
  aplicarRangoRapido,
  RANGOS_RAPIDOS,
} from '../fechasRapidas.js'

afterEach(() => vi.useRealTimers())

describe('fechasRapidas', () => {
  it('isoToday devuelve la fecha local en formato ISO', () => {
    vi.setSystemTime(new Date(2026, 8, 2, 23, 30)) // 2 sep 2026, 23:30 local
    expect(isoToday()).toBe('2026-09-02')
  })

  it('monthStart devuelve el día 1 del mes en curso', () => {
    vi.setSystemTime(new Date(2026, 8, 15))
    expect(monthStart()).toBe('2026-09-01')
  })

  it('yesterdayIso cruza de mes correctamente', () => {
    vi.setSystemTime(new Date(2026, 8, 1))
    expect(yesterdayIso()).toBe('2026-08-31')
  })

  it('weekStartIso: en lunes la semana empieza hoy', () => {
    vi.setSystemTime(new Date(2026, 8, 7)) // lunes 7 sep 2026
    expect(weekStartIso()).toBe('2026-09-07')
  })

  it('weekStartIso: entre semana retrocede hasta el lunes', () => {
    vi.setSystemTime(new Date(2026, 8, 9)) // miércoles 9 sep 2026
    expect(weekStartIso()).toBe('2026-09-07')
  })

  it('weekStartIso: en domingo retrocede al lunes de esa misma semana', () => {
    vi.setSystemTime(new Date(2026, 8, 13)) // domingo 13 sep 2026
    expect(weekStartIso()).toBe('2026-09-07')
  })

  it('weekStartIso: cruza de mes cuando el lunes pertenece al mes anterior', () => {
    vi.setSystemTime(new Date(2026, 8, 2)) // miércoles 2 sep 2026 → lunes 31 ago
    expect(weekStartIso()).toBe('2026-08-31')
  })

  it('rangoRapidoActivo detecta cada rango y devuelve "" en rangos personalizados', () => {
    vi.setSystemTime(new Date(2026, 8, 2))
    const hoy = isoToday()
    expect(rangoRapidoActivo(hoy, hoy)).toBe('hoy')
    expect(rangoRapidoActivo('2026-09-01', '2026-09-01')).toBe('ayer')
    expect(rangoRapidoActivo('2026-09-01', hoy)).toBe('mes')
    // 2 sep 2026 es miércoles: el lunes fue 31 ago → rango semana
    expect(rangoRapidoActivo('2026-08-31', hoy)).toBe('semana')
    expect(rangoRapidoActivo('2026-08-01', '2026-08-31')).toBe('')
  })

  it('aplicarRangoRapido produce los rangos esperados', () => {
    vi.setSystemTime(new Date(2026, 8, 2))
    expect(aplicarRangoRapido('hoy')).toEqual({ desde: '2026-09-02', hasta: '2026-09-02' })
    expect(aplicarRangoRapido('ayer')).toEqual({ desde: '2026-09-01', hasta: '2026-09-01' })
    expect(aplicarRangoRapido('semana')).toEqual({ desde: '2026-08-31', hasta: '2026-09-02' })
    expect(aplicarRangoRapido('mes')).toEqual({ desde: '2026-09-01', hasta: '2026-09-02' })
  })

  it('expone exactamente los cuatro rangos rápidos en orden', () => {
    expect(RANGOS_RAPIDOS.map(r => r.id)).toEqual(['hoy', 'ayer', 'semana', 'mes'])
  })

  it('prioriza "mes" cuando el mes empieza en lunes (ambos rangos coinciden)', () => {
    // 1 sep 2026 fue martes → probamos con un mes que empieza en lunes: feb 2027
    vi.setSystemTime(new Date(2027, 1, 3)) // miércoles 3 feb 2027; lunes 1 feb = monthStart
    expect(rangoRapidoActivo('2027-02-01', '2027-02-03')).toBe('mes')
  })

  it('getLocalIsoDate formatea con ceros', () => {
    expect(getLocalIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
