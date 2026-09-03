// src/config/__tests__/modulos.test.jsx
// Test del interruptor único del lanzamiento por fases (src/config/modulos.js).
// Verifica el CABLEADO: coherencia entre el flag, las secciones heredadas y la
// ruta por defecto, sea cual sea el estado actual del candado.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { NOMINA_BLOQUEADA, SECCIONES_NOMINA_BLOQUEADAS, SYNC_POS_BLOQUEADO, rutaPorDefecto } from '../modulos.js'

describe('interruptor de módulos (src/config/modulos.js)', () => {
  it('las secciones de nómina dentro de Sistema siguen al mismo interruptor', () => {
    expect(SECCIONES_NOMINA_BLOQUEADAS).toBe(NOMINA_BLOQUEADA)
  })

  it('la ruta por defecto responde al estado del interruptor', () => {
    expect(rutaPorDefecto()).toBe(NOMINA_BLOQUEADA ? '/finanzas' : '/nomina')
  })

  it('declara el candado exactamente una vez (fuente única)', () => {
    const src = readFileSync(new URL('../modulos.js', import.meta.url), 'utf8')
    const declaraciones = src.match(/export const NOMINA_BLOQUEADA = (?:true|false)/g) || []
    expect(declaraciones).toHaveLength(1)
  })

  it('expone el contrato completo que consumen nav, rutas y Sistema', () => {
    expect(typeof NOMINA_BLOQUEADA).toBe('boolean')
    expect(typeof SYNC_POS_BLOQUEADO).toBe('boolean')
    expect(typeof rutaPorDefecto()).toBe('string')
  })

  it('Sincronizar POS usa el mismo interruptor único (sin fuente propia)', () => {
    const src = readFileSync(new URL('../modulos.js', import.meta.url), 'utf8')
    expect(src.match(/export const SYNC_POS_BLOQUEADO = (?:true|false)/g)).toHaveLength(1)
    // FinanzasView solo consume el flag; nunca lo redeclara.
    const view = readFileSync(new URL('../../components/finanzas/FinanzasView.jsx', import.meta.url), 'utf8')
    expect(view).toContain("from '../../config/modulos.js'")
    expect(view).not.toMatch(/SYNC_POS_BLOQUEADO\s*=/)
  })
})
