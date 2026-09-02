// src/store/useTasaNominaStore.js
// Store para almacenar la tasa activa seleccionada (BCV USD, BCV EUR, USDT o Manual)
// garantizando que la moneda principal sea siempre USD y la secundaria Bs.
import { create } from 'zustand'

const STORAGE_KEY = 'nomina_tasa_seleccionada_v1'

function getInitialState() {
  if (typeof window === 'undefined') {
    return { tipoTasa: 'bcv_usd', tasaManual: 0 }
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
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
  return { tipoTasa: 'bcv_usd', tasaManual: 0 }
}

export const useTasaNominaStore = create((set, get) => ({
  ...getInitialState(),

  setTipoTasa: (tipoTasa) => {
    set({ tipoTasa })
    try {
      const current = get()
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tipoTasa,
        tasaManual: current.tasaManual,
      }))
    } catch {
      // Ignorar errores de escritura en localStorage
    }
  },

  setTasaManual: (tasaManual) => {
    const val = Number(tasaManual) || 0
    set({ tasaManual: val, tipoTasa: 'manual' })
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tipoTasa: 'manual',
        tasaManual: val,
      }))
    } catch {
      // Ignorar errores de escritura en localStorage
    }
  },
}))
