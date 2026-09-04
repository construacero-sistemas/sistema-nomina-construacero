// src/utils/__tests__/timeUtils.test.js
import { describe, it, expect } from 'vitest'
import { formatHora12, formatRangoHoras12 } from '../timeUtils'

describe('formatHora12', () => {
  it('convierte horas de la mañana correctamente', () => {
    expect(formatHora12('08:00')).toBe('08:00 AM')
    expect(formatHora12('09:30')).toBe('09:30 AM')
    expect(formatHora12('11:59')).toBe('11:59 AM')
  })

  it('convierte horas de la tarde y noche correctamente', () => {
    expect(formatHora12('12:00')).toBe('12:00 PM')
    expect(formatHora12('13:00')).toBe('01:00 PM')
    expect(formatHora12('17:00')).toBe('05:00 PM')
    expect(formatHora12('18:00')).toBe('06:00 PM')
    expect(formatHora12('19:00')).toBe('07:00 PM')
    expect(formatHora12('23:59')).toBe('11:59 PM')
  })

  it('convierte la medianoche correctamente', () => {
    expect(formatHora12('00:00')).toBe('12:00 AM')
    expect(formatHora12('00:30')).toBe('12:30 AM')
  })

  it('soporta formato con segundos HH:mm:ss', () => {
    expect(formatHora12('08:00:00')).toBe('08:00 AM')
    expect(formatHora12('17:00:00')).toBe('05:00 PM')
  })

  it('respeta la opción padHour=false', () => {
    expect(formatHora12('08:00', { padHour: false })).toBe('8:00 AM')
    expect(formatHora12('13:00', { padHour: false })).toBe('1:00 PM')
  })

  it('respeta la opción incluirEspacio=false', () => {
    expect(formatHora12('08:00', { incluirEspacio: false })).toBe('08:00AM')
    expect(formatHora12('17:00', { incluirEspacio: false })).toBe('05:00PM')
  })

  it('maneja valores vacíos, nulos o inválidos con gracia', () => {
    expect(formatHora12(null)).toBe('')
    expect(formatHora12(undefined)).toBe('')
    expect(formatHora12('')).toBe('')
    expect(formatHora12('invalido')).toBe('invalido')
  })
})

describe('formatRangoHoras12', () => {
  it('formatea rangos típicos de jornada laboral', () => {
    expect(formatRangoHoras12('08:00', '17:00')).toBe('08:00 AM – 05:00 PM')
    expect(formatRangoHoras12('08:00', '13:00')).toBe('08:00 AM – 01:00 PM')
    expect(formatRangoHoras12('08:00', '18:00')).toBe('08:00 AM – 06:00 PM')
    expect(formatRangoHoras12('08:00', '19:00')).toBe('08:00 AM – 07:00 PM')
  })

  it('permite personalizar el separador', () => {
    expect(formatRangoHoras12('08:00', '17:00', ' a ')).toBe('08:00 AM a 05:00 PM')
  })

  it('maneja extremos vacíos', () => {
    expect(formatRangoHoras12(null, '17:00')).toBe('05:00 PM')
    expect(formatRangoHoras12('08:00', null)).toBe('08:00 AM')
    expect(formatRangoHoras12('', '')).toBe('')
  })
})
