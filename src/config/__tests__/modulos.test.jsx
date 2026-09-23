// src/config/__tests__/modulos.test.jsx
// Test del interruptor único del lanzamiento por fases (src/config/modulos.js).
// Verifica el CABLEADO: coherencia entre el flag, las secciones heredadas y la
// ruta por defecto, sea cual sea el estado actual del candado.
// @vitest-environment node
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

  it('Sincronizar POS no aparece en la interfaz financiera para ningún rol', () => {
    const view = readFileSync(new URL('../../components/finanzas/FinanzasView.jsx', import.meta.url), 'utf8')
    expect(view).not.toContain('Sincronizar POS')
    expect(view).not.toContain('SyncPosModal')
  })

  it('el runtime nace de los flags estáticos (fuente única intacta)', () => {
    const runtime = readFileSync(new URL('../candadosRuntime.js', import.meta.url), 'utf8')
    expect(runtime).toContain("from './modulos.js'")
    expect(runtime).not.toMatch(/(?:const|let|var)\s+NOMINA_BLOQUEADA\s*=/)
  })
})
