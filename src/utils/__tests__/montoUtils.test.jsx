// src/utils/__tests__/montoUtils.test.jsx
import { describe, expect, it } from 'vitest'
import { normalizarMontoInput } from '../montoUtils.js'

describe('normalizarMontoInput', () => {
  it('permite valores vacíos o nulos', () => {
    expect(normalizarMontoInput('')).toBe('')
    expect(normalizarMontoInput(null)).toBe('')
    expect(normalizarMontoInput(undefined)).toBe('')
    expect(normalizarMontoInput('   ')).toBe('')
  })

  it('permite enteros y decimales normales', () => {
    expect(normalizarMontoInput('100')).toBe('100')
    expect(normalizarMontoInput('100.5')).toBe('100.5')
    expect(normalizarMontoInput('100.50')).toBe('100.50')
  })

  it('convierte coma en punto (comportamiento clave para iPhone y teclados latinos)', () => {
    expect(normalizarMontoInput('100,')).toBe('100.')
    expect(normalizarMontoInput('100,5')).toBe('100.5')
    expect(normalizarMontoInput('100,50')).toBe('100.50')
  })

  it('autocompleta 0. cuando se inicia escribiendo punto o coma', () => {
    expect(normalizarMontoInput('.')).toBe('0.')
    expect(normalizarMontoInput(',')).toBe('0.')
  })

  it('soporta entrada durante la escritura de decimales', () => {
    expect(normalizarMontoInput('12.')).toBe('12.')
    expect(normalizarMontoInput('0.')).toBe('0.')
  })

  it('rechaza múltiples puntos o comas', () => {
    expect(normalizarMontoInput('100.5.')).toBeNull()
    expect(normalizarMontoInput('100,5,')).toBeNull()
    expect(normalizarMontoInput('100..5')).toBeNull()
    expect(normalizarMontoInput('100.,5')).toBeNull()
  })

  it('rechaza caracteres no numéricos o letras', () => {
    expect(normalizarMontoInput('abc')).toBeNull()
    expect(normalizarMontoInput('100a')).toBeNull()
    expect(normalizarMontoInput('-50')).toBeNull()
  })

  it('soporta montos pegados con separadores de miles y decimales venezolanos/europeos (1.250,50)', () => {
    expect(normalizarMontoInput('1.250,50')).toBe('1250.50')
    expect(normalizarMontoInput('10.500,00')).toBe('10500.00')
  })

  it('soporta montos pegados con formato anglosajón (1,250.50)', () => {
    expect(normalizarMontoInput('1,250.50')).toBe('1250.50')
  })

  it('limpia símbolos de monedas comunes pegados ($ 150,50 / Bs. 2.000,00)', () => {
    expect(normalizarMontoInput('$ 150,50')).toBe('150.50')
    expect(normalizarMontoInput('$150.00')).toBe('150.00')
    expect(normalizarMontoInput('Bs. 2.000,00')).toBe('2000.00')
    expect(normalizarMontoInput('150 USDT')).toBe('150')
  })
})
