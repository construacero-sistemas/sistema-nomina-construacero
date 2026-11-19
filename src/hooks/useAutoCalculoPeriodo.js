// src/hooks/useAutoCalculoPeriodo.js
// Mejora del 19/11/2026: al abrir un período ABIERTO, los recibos y la hoja semanal
// se ponen al día solos con la asistencia, sin pulsar «Calcular». El servidor
// recalcula en memoria y solo guarda si algún recibo sin pagar cambió
// (`soloSiCambio`), así que abrir el período no escribe ni audita si todo está igual.
// - Una sola comprobación por apertura (nada de sondeos: cuida el plan de Supabase).
// - Los recibos pagados y los períodos cerrados nunca se recalculan.
// - Si hay jornadas sin salida, no se calcula: se avisa para corregir el marcaje.
import { useEffect, useRef, useState } from 'react'
import { useAccountQueryClient as useQueryClient } from '../../compat/lib/accountQueries.js'
import { logClientError } from '../../compat/utils/errorLogger.js'
import { apiPost, KEY_LINEAS, KEY_PERIODOS } from './nominaApi.js'

/** estado: 'inactivo' | 'comprobando' | 'al-dia' | 'actualizado' | 'jornadas-abiertas' | 'error' */
export default function useAutoCalculoPeriodo(periodo, habilitado) {
  const qc = useQueryClient()
  const [resultado, setResultado] = useState({ estado: 'inactivo', jornadas: 0, lineas: 0 })
  const comprobado = useRef(null)
  const periodoId = periodo?.id
  const activo = Boolean(habilitado && periodoId && periodo?.estado === 'abierto')

  useEffect(() => {
    if (!activo || comprobado.current === periodoId) return undefined
    comprobado.current = periodoId
    // Sin cancelar en la limpieza: en StrictMode el efecto se monta dos veces y la
    // segunda no repite la llamada (ref), así que la respuesta debe llegar igual.
    setResultado({ estado: 'comprobando', jornadas: 0, lineas: 0 })
    apiPost('/api/nomina/periodos/calcular', { periodoId, soloSiCambio: true })
      .then(data => {
        if (data?.sin_cambios) {
          setResultado({ estado: 'al-dia', jornadas: 0, lineas: 0 })
          return
        }
        setResultado({ estado: 'actualizado', jornadas: 0, lineas: Number(data?.lineas_generadas) || 0 })
        qc.invalidateQueries({ queryKey: KEY_LINEAS })
        qc.invalidateQueries({ queryKey: KEY_PERIODOS })
      })
      .catch(error => {
        const jornadas = Number(error?.payload?.total_jornadas_abiertas) || 0
        if (error?.status === 409 && jornadas > 0) {
          setResultado({ estado: 'jornadas-abiertas', jornadas, lineas: 0 })
          return
        }
        logClientError({ mensaje: `Cálculo automático del período: ${error?.message || error}`, categoria: 'NOMINA' })
        setResultado({ estado: 'error', jornadas: 0, lineas: 0 })
      })
    return undefined
  }, [activo, periodoId, qc])

  return resultado
}
