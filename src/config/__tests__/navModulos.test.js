import { describe, expect, it } from 'vitest'
import { filtrarNavPorRol } from '../navModulos.js'

const NAV = [
  { to: '/nomina' },
  { to: '/finanzas' },
  { to: '/sistema' },
]

describe('filtrarNavPorRol', () => {
  it('oculta Sistema y Nómina al rol Finanzas', () => {
    expect(filtrarNavPorRol(NAV, 'finanzas').map(item => item.to)).toEqual(['/finanzas'])
  })

  it.each(['jefe', 'desarrollador'])('conserva todos los módulos para %s', rol => {
    expect(filtrarNavPorRol(NAV, rol).map(item => item.to)).toEqual(['/nomina', '/finanzas', '/sistema'])
  })

  it('mantiene solo Nómina para el rol nomina', () => {
    expect(filtrarNavPorRol(NAV, 'nomina').map(item => item.to)).toEqual(['/nomina'])
  })
})
