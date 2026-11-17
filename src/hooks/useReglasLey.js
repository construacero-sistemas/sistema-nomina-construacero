// src/hooks/useReglasLey.js
// Reglas de la ley laboral vigentes para la cuenta (Configuración → Reglas de la
// ley, migración 263). Mientras la configuración no llega, o si el rol no puede
// leerla, se usan los valores de la ley vigente (misma fuente que el servidor).
import { useMemo } from 'react'
import { useConfigNomina } from './useNomina.js'
import { reglasLeyDeConfig } from '../../server/lib/nominaReglasLey.js'

export default function useReglasLey() {
  const config = useConfigNomina()
  const datos = config.data?.config || config.data
  return useMemo(() => reglasLeyDeConfig(datos), [datos])
}
