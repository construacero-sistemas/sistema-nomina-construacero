// src/hooks/useNomina.js
// Queries y mutations del módulo de nómina (config empleados, asistencia, períodos, líneas).
import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAccountQuery as useQuery, useAccountQueryClient as useQueryClient } from '../../compat/lib/accountQueries.js'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { showToast } from '../../compat/components/ui/toastBus.js'
import { tieneCapacidad } from '../config/accesoModulos.js'
import useFinancialOperation from './useFinancialOperation.js'
export { useMarcarEntrada, useMarcarSalida, useCorregirMarcaje, useAnularEntradaComoAusencia } from './useNominaMarcaje.js'
import {
  KEY_ASISTENCIA,
  KEY_CONFIG,
  KEY_CONFIG_BAJAS,
  KEY_EMPLEADOS,
  KEY_LINEAS,
  KEY_MARCAJE,
  KEY_PERIODOS,
  apiGet,
  apiPost,
} from './nominaApi.js'

// Compuertas derivadas de la matriz única (config/accesoModulos reexporta
// server/lib/permissions.js): aquí no se escribe ningún rol a mano.
export function usePuedeVerNomina() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return tieneCapacidad(perfil, 'verNomina')
}

export function usePuedeAdminNomina() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return tieneCapacidad(perfil, 'administrarNomina')
}

// ─── Empleados y configuración ─────────────────────────────────────────────────

export function useNominaEmpleados({ enabled = true } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = tieneCapacidad(perfil, 'verNomina')
  return useQuery({
    queryKey: KEY_EMPLEADOS,
    queryFn: () => apiGet('/api/nomina/empleados'),
    enabled: enabled && !!perfil && puede,
    staleTime: 1000 * 60 * 5,
  })
}

export function useConfigEmpleados({ incluirInactivas = false } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = tieneCapacidad(perfil, 'verNomina')
  return useQuery({
    queryKey: incluirInactivas ? [...KEY_CONFIG, { incluirInactivas: true }] : KEY_CONFIG,
    queryFn: () => apiGet(incluirInactivas ? '/api/nomina/config-empleados?incluirInactivas=1' : '/api/nomina/config-empleados'),
    enabled: !!perfil && puede,
    staleTime: 1000 * 60 * 5,
  })
}

/** Empleados con configuración DADA DE BAJA (activo=false), para la vista "Bajas". */
export function useConfigEmpleadosBajas() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = tieneCapacidad(perfil, 'administrarNomina')
  return useQuery({
    queryKey: KEY_CONFIG_BAJAS,
    queryFn: () => apiGet('/api/nomina/config-empleados?incluirInactivas=1'),
    enabled: !!perfil && puede,
    staleTime: 1000 * 60 * 5,
    select: (rows) => (rows || []).filter(r => r.activo === false),
  })
}

export function useCrearConfigEmpleado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (campos) => apiPost('/api/nomina/config-empleado/crear', campos),
    onSuccess: () => {
      showToast.success('Empleado agregado a nómina')
      qc.invalidateQueries({ queryKey: KEY_CONFIG })
      qc.invalidateQueries({ queryKey: KEY_CONFIG_BAJAS })
      qc.invalidateQueries({ queryKey: KEY_EMPLEADOS })
    },
    onError: (e) => showToast.error(e.message || 'Error al agregar empleado'),
  })
}

export function useActualizarConfigEmpleado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (campos) => apiPost('/api/nomina/config-empleado/actualizar', campos),
    onSuccess: () => {
      showToast.success('Configuración actualizada')
      qc.invalidateQueries({ queryKey: KEY_CONFIG })
      qc.invalidateQueries({ queryKey: KEY_CONFIG_BAJAS })
      qc.invalidateQueries({ queryKey: KEY_EMPLEADOS })
    },
    onError: (e) => showToast.error(e.message || 'Error al actualizar'),
  })
}

export function useEliminarConfigEmpleado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, incluirHistorial = false, empleadoId, confirmarNombre }) => apiPost('/api/nomina/config-empleado/eliminar', {
      id,
      incluirHistorial,
      ...(empleadoId ? { empleadoId } : {}),
      ...(confirmarNombre ? { confirmarNombre } : {}),
    }),
    onSuccess: () => {
      showToast.success('Trabajador y datos autorizados eliminados definitivamente')
      qc.invalidateQueries({ queryKey: KEY_CONFIG })
      qc.invalidateQueries({ queryKey: KEY_CONFIG_BAJAS })
      qc.invalidateQueries({ queryKey: KEY_EMPLEADOS })
    },
    onError: (e) => showToast.error(e.message || 'No se pudo eliminar al empleado'),
  })
}

// ─── Asistencia ────────────────────────────────────────────────────────────────

export function useAsistencia({ desde = null, hasta = null, empleadoId = null } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = tieneCapacidad(perfil, 'verNomina')
  return useQuery({
    queryKey: [...KEY_ASISTENCIA, desde, hasta, empleadoId],
    queryFn: () => {
      const p = new URLSearchParams()
      if (desde)      p.set('desde', desde)
      if (hasta)      p.set('hasta', hasta)
      if (empleadoId) p.set('empleadoId', empleadoId)
      return apiGet(`/api/nomina/asistencia?${p}`)
    },
    enabled: !!perfil && puede && (!!desde || !!empleadoId),
    staleTime: 1000 * 30,
  })
}

export function useFeriados(desde, hasta) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede = tieneCapacidad(perfil, 'verNomina')
  return useQuery({
    queryKey: ['nomina', 'feriados', desde, hasta],
    queryFn: () => apiGet(`/api/nomina/calendario/feriados?desde=${desde}&hasta=${hasta}`),
    enabled: !!perfil && puede && !!desde && !!hasta,
    staleTime: 1000 * 60 * 10,
  })
}

export function useRegistrarAsistencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (campos) => apiPost('/api/nomina/asistencia/registrar', campos),
    onSuccess: () => {
      showToast.success('Asistencia registrada')
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
    },
    onError: (e) => showToast.error(e.message || 'Error al registrar asistencia'),
  })
}

export function useMarcajeHoy() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return useQuery({
    queryKey: KEY_MARCAJE,
    queryFn: () => apiGet('/api/nomina/marcaje/hoy'),
    enabled: tieneCapacidad(perfil, 'administrarNomina'),
    staleTime: 1000 * 30,
  })
}

export function useRegistrarAsistenciaMasivo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (campos) => apiPost('/api/nomina/asistencia/registrar-masivo', campos),
    onSuccess: (data) => {
      showToast.success(`Asistencia registrada para ${data.registros} empleado(s)`)
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
    },
    onError: (e) => showToast.error(e.message || 'Error al registrar asistencia masiva'),
  })
}

export function useEliminarAsistencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => apiPost('/api/nomina/asistencia/eliminar', { id }),
    onSuccess: () => {
      showToast.success('Registro eliminado')
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
    },
    onError: (e) => showToast.error(e.message || 'Error al eliminar registro'),
  })
}

// ─── Períodos ──────────────────────────────────────────────────────────────────

export function useNominaPeriodos() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = tieneCapacidad(perfil, 'verNomina')
  return useQuery({
    queryKey: KEY_PERIODOS,
    queryFn: () => apiGet('/api/nomina/periodos'),
    enabled: !!perfil && puede,
    staleTime: 1000 * 60,
  })
}

export function useCrearPeriodo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (campos) => apiPost('/api/nomina/periodos/crear', campos),
    onSuccess: () => {
      showToast.success('Período creado')
      qc.invalidateQueries({ queryKey: KEY_PERIODOS })
    },
    onError: (e) => showToast.error(e.message || 'Error al crear período'),
  })
}

export function useCalcularPeriodo() {
  const qc = useQueryClient()
  return useMutation({
    // Acepta el id o el cuerpo completo: `{ periodoId, confirmarJornadasAbiertas }`
    // cuando el operador decide liquidar un período con jornadas sin salida.
    mutationFn: (vars) => apiPost('/api/nomina/periodos/calcular',
      typeof vars === 'string' ? { periodoId: vars } : vars),
    onSuccess: (data) => {
      const extra = data.lineas_preservadas > 0
        ? ` (${data.lineas_preservadas} ya pagado(s) sin cambios)`
        : ''
      showToast.success(`Nómina calculada: ${data.lineas_generadas} recibo(s)${extra}`)
      qc.invalidateQueries({ queryKey: KEY_PERIODOS })
      qc.invalidateQueries({ queryKey: KEY_LINEAS })
    },
    onError: (e) => {
      // El 409 de jornadas abiertas no es un error de red: la pestaña de períodos
      // abre el diálogo de confirmación con la lista y decide si avisar aquí.
      if (Array.isArray(e?.payload?.jornadas_abiertas)) return
      showToast.error(e.message || 'Error al calcular nómina')
    },
  })
}

export function useCerrarPeriodo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (periodoId) => apiPost('/api/nomina/periodos/cerrar', { periodoId }),
    onSuccess: () => {
      showToast.success('Período cerrado')
      qc.invalidateQueries({ queryKey: KEY_PERIODOS })
      qc.invalidateQueries({ queryKey: KEY_LINEAS })
    },
    onError: (e) => showToast.error(e.message || 'Error al cerrar período'),
  })
}

export function useReabrirPeriodo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (periodoId) => apiPost('/api/nomina/periodos/reabrir', { periodoId }),
    onSuccess: () => {
      showToast.success('Período reabierto')
      qc.invalidateQueries({ queryKey: KEY_PERIODOS })
      qc.invalidateQueries({ queryKey: KEY_LINEAS })
    },
    onError: (e) => showToast.error(e.message || 'Error al reabrir período'),
  })
}

export function useEliminarPeriodo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (periodoId) => apiPost('/api/nomina/periodos/eliminar', { periodoId }),
    onSuccess: () => {
      showToast.success('Período eliminado')
      qc.invalidateQueries({ queryKey: KEY_PERIODOS })
      qc.invalidateQueries({ queryKey: KEY_LINEAS })
    },
    onError: (e) => showToast.error(e.message || 'Error al eliminar período'),
  })
}

// ─── Líneas ────────────────────────────────────────────────────────────────────

export function useNominaLineas(periodoId) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = tieneCapacidad(perfil, 'verNomina')
  return useQuery({
    queryKey: [...KEY_LINEAS, periodoId],
    queryFn: () => apiGet(`/api/nomina/lineas?periodoId=${periodoId}`),
    enabled: !!perfil && puede && !!periodoId,
    staleTime: 1000 * 30,
  })
}

export function useAjustarLinea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (campos) => apiPost('/api/nomina/lineas/ajustar', campos),
    onSuccess: () => {
      showToast.success('Recibo ajustado')
      qc.invalidateQueries({ queryKey: KEY_LINEAS })
      qc.invalidateQueries({ queryKey: KEY_PERIODOS })
    },
    onError: (e) => showToast.error(e.message || 'Error al ajustar recibo'),
  })
}

export function usePagarLineas() {
  const operation = useFinancialOperation('pagar_nomina', '/api/nomina/lineas/pagar')
  return {
    ...operation,
    mutateAsync: async fields => {
      const data = await operation.mutateAsync(fields)
      showToast.success(`${data.recibos_pagados} recibo(s) pagados — $${Number(data.total_usd).toFixed(2)}`)
      return data
    },
  }
}

export function useRevertirPagoLinea() {
  const operation = useFinancialOperation('revertir_nomina', '/api/nomina/lineas/revertir-pago')
  const mutateAsync = async fields => {
    const data = await operation.mutateAsync(fields)
    showToast.success('Reversión contable registrada')
    return data
  }
  return { ...operation, mutateAsync, mutate: (fields, options) => {
    mutateAsync(fields).then(result => options?.onSuccess?.(result)).catch(error => {
      showToast.error(error.message); options?.onError?.(error)
    })
  } }
}

// ─── Configuración laboral, tasas y conceptos ───────────────────────────────
export function useConfigNomina() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return useQuery({
    queryKey: ['nomina', 'configuracion'],
    queryFn: () => apiGet('/api/config'),
    enabled: tieneCapacidad(perfil, 'administrarNomina'),
    staleTime: 1000 * 60 * 10,
  })
}

export function useGuardarConfigNomina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: campos => apiPost('/api/config', campos),
    onSuccess: () => {
      showToast.success('Recargos guardados')
      qc.invalidateQueries({ queryKey: ['nomina', 'configuracion'] })
    },
    onError: e => showToast.error(e.message || 'Error al guardar recargos'),
  })
}

export function useHorarios(empleadoId = '') {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede = tieneCapacidad(perfil, 'administrarNomina')
  const query = empleadoId ? `?empleadoId=${empleadoId}` : ''
  return useQuery({
    queryKey: ['nomina', 'horarios', empleadoId],
    queryFn: () => apiGet(`/api/nomina/calendario/horarios${query}`),
    enabled: !!perfil && puede,
    staleTime: 1000 * 60 * 10,
  })
}

export function useCrearHorario() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: campos => apiPost('/api/nomina/calendario/horarios/crear', campos),
    onSuccess: () => {
      showToast.success('Horario guardado')
      qc.invalidateQueries({ queryKey: ['nomina', 'horarios'] })
    },
    onError: e => showToast.error(e.message || 'Error al guardar horario'),
  })
}

// Semana laboral del empleado (qué días trabaja y con qué jornada cada uno).
// Es la fuente del estado «Libre» en asistencia y en el reloj real.
export function useGuardarHorarioEmpleado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, dias }) => apiPost('/api/nomina/calendario/horarios/empleado', { empleadoId, dias }),
    onSuccess: () => {
      showToast.success('Días laborables guardados')
      qc.invalidateQueries({ queryKey: KEY_CONFIG })
      qc.invalidateQueries({ queryKey: KEY_CONFIG_BAJAS })
      qc.invalidateQueries({ queryKey: ['nomina', 'horarios'] })
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
    },
    onError: e => showToast.error(e.message || 'No se pudieron guardar los días laborables'),
  })
}

// Ausencia del día con su reversa. Solo escribe sobre días laborables del empleado
// y nunca borra horas reales del reloj (eso vive en «Corregir marcaje»).
export function useMarcarAusencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, quitar = false }) => apiPost('/api/nomina/marcaje/ausencia', { empleadoId, quitar }),
    onSuccess: (_, variables) => {
      showToast.success(variables?.quitar ? 'Ausencia deshecha' : 'Ausencia registrada')
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
    },
    onError: e => showToast.error(e.message || 'No se pudo actualizar la ausencia'),
  })
}

export function useCrearFeriado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: campos => apiPost('/api/nomina/calendario/feriados/crear', campos),
    onSuccess: () => {
      showToast.success('Feriado guardado')
      qc.invalidateQueries({ queryKey: ['nomina', 'feriados'] })
    },
    onError: e => showToast.error(e.message || 'Error al guardar feriado'),
  })
}

export function useEliminarFeriado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }) => apiPost('/api/nomina/calendario/feriados/eliminar', { id }),
    onSuccess: () => {
      showToast.success('Feriado eliminado')
      qc.invalidateQueries({ queryKey: ['nomina', 'feriados'] })
    },
    onError: e => showToast.error(e.message || 'Error al eliminar feriado'),
  })
}

export function useTasasSnapshots(desde, hasta) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede = tieneCapacidad(perfil, 'administrarNomina')
  return useQuery({
    queryKey: ['nomina', 'tasas', desde, hasta],
    queryFn: () => apiGet(`/api/nomina/tasas-snapshots?desde=${desde}&hasta=${hasta}`),
    enabled: !!perfil && puede && !!desde && !!hasta,
    staleTime: 1000 * 60 * 10,
  })
}

export function useCrearTasaSnapshot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: campos => apiPost('/api/nomina/tasas-snapshots/crear', campos),
    onSuccess: () => {
      showToast.success('Tasa de cambio guardada')
      qc.invalidateQueries({ queryKey: ['nomina', 'tasas'] })
    },
    onError: e => showToast.error(e.message || 'Error al guardar tasa'),
  })
}

export function useNominaConceptos() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return useQuery({
    queryKey: ['nomina', 'conceptos'],
    queryFn: () => apiGet('/api/nomina/conceptos'),
    enabled: tieneCapacidad(perfil, 'administrarNomina'),
    staleTime: 1000 * 60 * 10,
  })
}

export function useCrearConcepto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: campos => apiPost('/api/nomina/conceptos/crear', campos),
    onSuccess: () => {
      showToast.success('Concepto guardado')
      qc.invalidateQueries({ queryKey: ['nomina', 'conceptos'] })
    },
    onError: e => showToast.error(e.message || 'Error al guardar concepto'),
  })
}

export function useReglasLegales() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return useQuery({
    queryKey: ['nomina', 'reglas-legales'],
    queryFn: () => apiGet('/api/nomina/reglas-legales'),
    enabled: tieneCapacidad(perfil, 'administrarNomina'),
    staleTime: 1000 * 60 * 10,
  })
}

export function useCrearReglaLegal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: campos => apiPost('/api/nomina/reglas-legales/crear', campos),
    onSuccess: () => {
      showToast.success('Regla guardada pendiente de aprobación')
      qc.invalidateQueries({ queryKey: ['nomina', 'reglas-legales'] })
    },
    onError: e => showToast.error(e.message || 'Error al guardar regla'),
  })
}

// ─── Comisiones de Vendedores del POS ──────────────────────────────────────────

export function usePosVendedores() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede = tieneCapacidad(perfil, 'verNomina')
  return useQuery({
    queryKey: ['nomina', 'pos-vendedores'],
    queryFn: () => apiGet('/api/nomina/pos-vendedores'),
    enabled: !!perfil && puede,
    staleTime: 1000 * 60 * 5,
  })
}

export function usePreviewComisionesPos(periodoId) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede = tieneCapacidad(perfil, 'administrarNomina')
  return useQuery({
    queryKey: ['nomina', 'comisiones-pos', periodoId],
    queryFn: () => apiGet(`/api/nomina/comisiones-pos?periodoId=${periodoId}`),
    enabled: !!perfil && puede && !!periodoId,
    staleTime: 1000 * 30,
  })
}

export function useAplicarComisionesPos() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: body => apiPost('/api/nomina/aplicar-comisiones-pos', body),
    onSuccess: (_, variables) => {
      showToast.success('Comisiones aplicadas con éxito a la nómina')
      qc.invalidateQueries({ queryKey: KEY_LINEAS })
      qc.invalidateQueries({ queryKey: KEY_PERIODOS })
      if (variables?.periodoId) {
        qc.invalidateQueries({ queryKey: ['nomina', 'comisiones-pos', variables.periodoId] })
      }
    },
    onError: e => showToast.error(e.message || 'Error al aplicar comisiones'),
  })
}

