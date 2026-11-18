import { describe, it, expect, beforeEach } from 'vitest'
import { useTasaNominaStore, useTasaFinanzasStore, storeTasaPorAmbito } from '../useTasaNominaStore.js'

describe('tasa por módulo', () => {
  beforeEach(() => {
    useTasaNominaStore.setState({ tipoTasa: 'bcv_usd', tasaManual: 0 })
    useTasaFinanzasStore.setState({ tipoTasa: 'bcv_usd', tasaManual: 0 })
  })

  it('cambiar la tasa de Nómina no afecta a Finanzas', () => {
    useTasaNominaStore.getState().setTipoTasa('bcv_eur')
    expect(useTasaNominaStore.getState().tipoTasa).toBe('bcv_eur')
    expect(useTasaFinanzasStore.getState().tipoTasa).toBe('bcv_usd')
  })

  it('cambiar la tasa de Finanzas no afecta a Nómina', () => {
    useTasaFinanzasStore.getState().setTipoTasa('usdt')
    expect(useTasaFinanzasStore.getState().tipoTasa).toBe('usdt')
    expect(useTasaNominaStore.getState().tipoTasa).toBe('bcv_usd')
  })

  it('elige el store según el ámbito', () => {
    expect(storeTasaPorAmbito('finanzas')).toBe(useTasaFinanzasStore)
    expect(storeTasaPorAmbito('nomina')).toBe(useTasaNominaStore)
  })
})
