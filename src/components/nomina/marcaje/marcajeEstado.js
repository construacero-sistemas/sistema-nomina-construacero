// src/components/nomina/marcaje/marcajeEstado.js
// Reglas puras de la asistencia de hoy (gestión por excepción): todo empleado en
// su día laborable figura presente por defecto según su horario; solo se registran
// horas extras, ausencias o días de descanso/feriado trabajados.
import { capitalizarPalabras } from '../../../utils/cuentasCustodiaUtils.js'
import { formatHora12 } from '../../../utils/timeUtils'

export const FILTROS = [
  { id: 'todos', label: 'Todos', estado: null },
  { id: 'presentes', label: 'Presentes', estados: ['presente', 'extra'] },
  { id: 'extras', label: 'Con extras', estado: 'extra' },
  { id: 'ausencias', label: 'Ausencias', estado: 'ausencia' },
  { id: 'libres', label: 'Descanso', estado: 'libre' },
  { id: 'descanso-trabajado', label: 'Trab. descanso', estado: 'descanso-trabajado' },
]

export const PRIORIDAD_ESTADO = {
  extra: 0,
  ausencia: 1,
  'descanso-trabajado': 2,
  presente: 3,
  libre: 4,
}

export const ESTADOS_MARCAJE_REAL = ['entrada', 'completo', 'corregido']

// `libre`: hoy no le toca trabajar (día libre según ficha o feriado no laborable).
export function estadoDelRegistro(registro, libre = false) {
  if (registro?.es_ausencia) return 'ausencia'
  if (libre) return registro ? 'descanso-trabajado' : 'libre'
  if (Number(registro?.horas_extra) > 0) return 'extra'
  return 'presente'
}

export function esMarcajeReal(registro) {
  return Boolean(registro && !registro.es_ausencia && registro.hora_entrada
    && ESTADOS_MARCAJE_REAL.includes(registro.estado_marcaje))
}

export function nombreEmpleado(empleado) {
  return capitalizarPalabras(empleado.empleado?.nombre || empleado.nombre) || 'Empleado sin nombre'
}

export function normalizarBusqueda(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
}

export function fechaLegible(fecha) {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Fecha operativa de hoy'
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-VE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

export function formatoHora(hora) {
  return hora ? formatHora12(hora) : '—'
}

export function claseEstado(estado) {
  if (estado === 'presente') return 'border-emerald-200 bg-emerald-50/60 text-emerald-900'
  if (estado === 'extra') return 'border-amber-300 bg-amber-50/70 text-amber-950'
  if (estado === 'descanso-trabajado') return 'border-violet-200 bg-violet-50/70 text-violet-950'
  if (estado === 'ausencia') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (estado === 'libre') return 'border-slate-200 bg-slate-50 text-slate-600'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export function etiquetaEstado(estado) {
  if (estado === 'presente') return 'Presente'
  if (estado === 'extra') return 'Presente · con horas extras'
  if (estado === 'descanso-trabajado') return 'Descanso / feriado trabajado'
  if (estado === 'ausencia') return 'Ausencia registrada'
  if (estado === 'libre') return 'Día de descanso'
  return 'Presente'
}
