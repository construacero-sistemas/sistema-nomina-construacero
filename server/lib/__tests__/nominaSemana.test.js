// server/lib/__tests__/nominaSemana.test.js
import { describe, it, expect } from 'vitest'
import { nombreSemana, numeroSemanaIso, rangoSemana } from '../nominaSemana.js'

describe('nominaSemana — correlativo ISO', () => {
  it('asigna correlativo consecutivo Semana XX-YYYY sin repetirse incluso en cambio de año', () => {
    const r = rangoSemana('2026-11-12', 4) // jue 12 → mié 18 nov 2026
    expect(r).toEqual({ desde: '2026-11-12', hasta: '2026-11-18' })
    const iso = numeroSemanaIso(r.desde, r.hasta)
    expect(iso).toEqual({ numero: 47, anio: 2026, etiqueta: 'Semana 47-2026' })
    expect(nombreSemana(r.desde, r.hasta)).toBe('Semana 47 · Noviembre 2026 (Jueves 12 – Miércoles 18)')
    expect(nombreSemana('2026-11-26', '2026-12-02')).toBe('Semana 49 · Nov / Dic 2026 (Jueves 26 – Miércoles 02)')

    // Cambio de año: jue 31 dic 2026 → mié 06 ene 2027 contiene lunes 04 ene (Semana 01-2027)
    const finAnio = numeroSemanaIso('2026-12-31', '2027-01-06')
    expect(finAnio).toEqual({ numero: 1, anio: 2027, etiqueta: 'Semana 01-2027' })
  })
})
