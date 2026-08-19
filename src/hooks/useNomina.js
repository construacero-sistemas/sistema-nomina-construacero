// src/hooks/useNomina.js
// Queries y mutations del módulo de nómina (config empleados, asistencia, períodos, líneas).
import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { apiUrl, getAuthHeaders } from '../../compat/services/apiBase.js'
import { showToast } from '../../compat/components/ui/toastBus.js'

const KEY_EMPLEADOS  = ['nomina', 'empleados']
const KEY_CONFIG     = ['nomina', 'config-empleados']
const KEY_ASISTENCIA = ['nomina', 'asistencia']
const KEY_MARCAJE    = ['nomina', 'marcaje-hoy']
const KEY_PERIODOS   = ['nomina', 'periodos']
const KEY_LINEAS     = ['nomina', 'lineas']

const ADMIN_ROLE = 'administracion'
const ROLES_VER = [ADMIN_ROLE]
const ROLES_ADMIN = [ADMIN_ROLE]

export function usePuedeVerNomina() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return ROLES_VER.includes(perfil?.rol)
}

export function usePuedeAdminNomina() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return ROLES_ADMIN.includes(perfil?.rol)
}

// ── Helper de fetch con manejo de error uniforme ───────────────────────────────
async function apiGet(path) {
  const headers = await getAuthHeaders()
  const res = await fetch(apiUrl(path), { headers })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error || `Error ${res.status}`)
  }
  return res.json()
}

async function apiPost(path, body) {
  const headers = await getAuthHeaders()
  const res = await fetch(apiUrl(path), {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error || `Error ${res.status}`)
  }
  return res.json()
}

// ─── Empleados y configuración ─────────────────────────────────────────────────

export function useNominaEmpleados({ enabled = true } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = ROLES_VER.includes(perfil?.rol)
  return useQuery({
    queryKey: KEY_EMPLEADOS,
    queryFn: () => apiGet('/api/nomina/empleados'),
    enabled: enabled && !!perfil && puede,
    staleTime: 1000 * 60 * 5,
  })
}

export function useConfigEmpleados() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = ROLES_VER.includes(perfil?.rol)
  return useQuery({
    queryKey: KEY_CONFIG,
    queryFn: () => apiGet('/api/nomina/config-empleados'),
    enabled: !!perfil && puede,
    staleTime: 1000 * 60 * 5,
  })
}

export function useCrearConfigEmpleado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (campos) => apiPost('/api/nomina/config-empleado/crear', campos),
    onSuccess: () => {
      showToast.success('Empleado agregado a nómina')
      qc.invalidateQueries({ queryKey: KEY_CONFIG })
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
      qc.invalidateQueries({ queryKey: KEY_EMPLEADOS })
    },
    onError: (e) => showToast.error(e.message || 'Error al actualizar'),
  })
}

// ─── Asistencia ────────────────────────────────────────────────────────────────

export function useAsistencia({ desde = null, hasta = null, empleadoId = null } = {}) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = ROLES_VER.includes(perfil?.rol)
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
  const puede = ROLES_VER.includes(perfil?.rol)
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
    },
    onError: (e) => showToast.error(e.message || 'Error al registrar asistencia'),
  })
}

export function useMarcajeHoy() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return useQuery({
    queryKey: KEY_MARCAJE,
    queryFn: () => apiGet('/api/nomina/marcaje/hoy'),
    enabled: perfil?.rol === ADMIN_ROLE,
    staleTime: 1000 * 30,
  })
}

function makeIdempotencyKey(tipo, empleadoId) {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${tipo}-${empleadoId}-${random}`
}

export function useMarcarEntrada() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, nota }) => apiPost('/api/nomina/marcaje/entrada', {
      empleadoId, nota, idempotencyKey: makeIdempotencyKey('entrada', empleadoId),
    }),
    onSuccess: () => {
      showToast.success('Entrada marcada')
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
    },
    onError: (e) => showToast.error(e.message || 'Error al marcar entrada'),
  })
}

export function useMarcarSalida() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, nota }) => apiPost('/api/nomina/marcaje/salida', {
      empleadoId, nota, idempotencyKey: makeIdempotencyKey('salida', empleadoId),
    }),
    onSuccess: () => {
      showToast.success('Salida marcada')
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
    },
    onError: (e) => showToast.error(e.message || 'Error al marcar salida'),
  })
}

export function useRegistrarAsistenciaMasivo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (campos) => apiPost('/api/nomina/asistencia/registrar-masivo', campos),
    onSuccess: (data) => {
      showToast.success(`Asistencia registrada para ${data.registros} empleado(s)`)
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
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
    },
    onError: (e) => showToast.error(e.message || 'Error al eliminar registro'),
  })
}

// ─── Períodos ──────────────────────────────────────────────────────────────────

export function useNominaPeriodos() {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = ROLES_VER.includes(perfil?.rol)
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
    mutationFn: (periodoId) => apiPost('/api/nomina/periodos/calcular', { periodoId }),
    onSuccess: (data) => {
      const extra = data.lineas_preservadas > 0
        ? ` (${data.lineas_preservadas} ya pagado(s) sin cambios)`
        : ''
      showToast.success(`Nómina calculada: ${data.lineas_generadas} recibo(s)${extra}`)
      qc.invalidateQueries({ queryKey: KEY_PERIODOS })
      qc.invalidateQueries({ queryKey: KEY_LINEAS })
    },
    onError: (e) => showToast.error(e.message || 'Error al calcular nómina'),
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

// ─── Líneas ────────────────────────────────────────────────────────────────────

export function useNominaLineas(periodoId) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede  = ROLES_VER.includes(perfil?.rol)
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lineaIds, referencia }) =>
      apiPost('/api/nomina/lineas/pagar', { lineaIds, referencia }),
    onSuccess: (data) => {
      showToast.success(`${data.recibos_pagados} recibo(s) pagados — $${Number(data.total_usd).toFixed(2)}`)
      qc.invalidateQueries({ queryKey: KEY_LINEAS })
      qc.invalidateQueries({ queryKey: KEY_PERIODOS })
    },
    onError: (e) => showToast.error(e.message || 'Error al registrar el pago'),
  })
}

export function useRevertirPagoLinea() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lineaId) => apiPost('/api/nomina/lineas/revertir-pago', { lineaId }),
    onSuccess: () => {
      showToast.success('Pago revertido')
      qc.invalidateQueries({ queryKey: KEY_LINEAS })
      qc.invalidateQueries({ queryKey: KEY_PERIODOS })
    },
    onError: (e) => showToast.error(e.message || 'Error al revertir el pago'),
  })
}

// ─── Configuración laboral, tasas y conceptos ───────────────────────────────
export function useHorarios(empleadoId = '') {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede = ROLES_ADMIN.includes(perfil?.rol)
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

export function useTasasSnapshots(desde, hasta) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const puede = ROLES_ADMIN.includes(perfil?.rol)
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
      showToast.success('Tasa guardada como snapshot')
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
    enabled: perfil?.rol === ADMIN_ROLE,
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
    enabled: perfil?.rol === ADMIN_ROLE,
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
