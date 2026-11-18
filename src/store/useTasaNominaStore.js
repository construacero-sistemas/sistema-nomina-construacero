// src/store/useTasaNominaStore.js
// Stores para almacenar la tasa activa seleccionada (BCV USD, BCV EUR, USDT o Manual)
// garantizando que la moneda principal sea siempre USD y la secundaria Bs.
//
// Cada módulo tiene su PROPIA elección de tasa: cambiar la tasa en Nómina no
// afecta a Finanzas y viceversa. Nómina conserva la clave histórica.
import { create } from 'zustand'

const STORAGE_KEYS = {
  nomina: 'nomina_tasa_seleccionada_v1',
  finanzas: 'finanzas_tasa_seleccionada_v1',
}

function getInitialState(storageKey) {
  const fallback = { tipoTasa: 'bcv_usd', tasaManual: 0 }
  if (typeof window === 'undefined') return fallback
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      const parsed = JSON.parse(saved)
      return {
        tipoTasa: parsed.tipoTasa || 'bcv_usd',
        tasaManual: Number(parsed.tasaManual) || 0,
      }
    }
  } catch {
    // Ignorar errores de acceso a localStorage
  }
  return fallback
}

function crearStoreTasa(storageKey) {
  const persistir = (tipoTasa, tasaManual) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ tipoTasa, tasaManual }))
    } catch {
      // Ignorar errores de escritura en localStorage
    }
  }

  return create((set, get) => ({
    ...getInitialState(storageKey),

    setTipoTasa: (tipoTasa) => {
      set({ tipoTasa })
      persistir(tipoTasa, get().tasaManual)
    },

    setTasaManual: (tasaManual) => {
      const val = Number(tasaManual) || 0
      set({ tasaManual: val, tipoTasa: 'manual' })
      persistir('manual', val)
    },

    // Hidratación desde el servidor: actualiza el valor (respaldo local) SIN tocar
    // la preferencia de tasa de este navegador. La tasa manual es única por cuenta
    // (trazable en nomina_tasas_snapshot); cada quien elige cuál de las 4 usar.
    hidratarTasaManual: (tasaManual) => {
      const val = Number(tasaManual) || 0
      if (!(val > 0)) return
      set({ tasaManual: val })
      persistir(get().tipoTasa, val)
    },
  }))
}

export const useTasaNominaStore = crearStoreTasa(STORAGE_KEYS.nomina)
export const useTasaFinanzasStore = crearStoreTasa(STORAGE_KEYS.finanzas)

export function storeTasaPorAmbito(ambito) {
  return ambito === 'finanzas' ? useTasaFinanzasStore : useTasaNominaStore
}
