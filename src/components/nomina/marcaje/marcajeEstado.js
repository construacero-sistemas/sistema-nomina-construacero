// src/components/nomina/marcaje/marcajeEstado.js
// Reglas puras del marcaje real de hoy: estado de cada tarjeta, filtros, orden y
// textos. Viven aparte del panel para que la vista no supere el límite de líneas
// del proyecto y para poder probarlas sin renderizar.
import { capitalizarPalabras } from '../../../utils/cuentasCustodiaUtils.js'
import { formatHora12 } from '../../../utils/timeUtils'

export const FILTROS = [
  { id: 'pendientes', label: 'Pendientes', estado: 'pendiente' },
  { id: 'en-curso', label: 'En jornada', estado: 'en-curso' },
  { id: 'completados', label: 'Completados', estado: 'completado' },
  { id: 'ausencias', label: 'Ausencias', estado: 'ausencia' },
  { id: 'libres', label: 'Día libre', estado: 'libre' },
  { id: 'manuales', label: 'Horarios fijos', estado: 'manual' },
  { id: 'todos', label: 'Todos', estado: null },
]

export const PRIORIDAD_ESTADO = {
  pendiente: 0,
  'en-curso': 1,
  completado: 2,
  manual: 3,
  ausencia: 4,
  libre: 5,
}

export const ESTADOS_MARCAJE_REAL = ['entrada', 'completo', 'corregido']

// `libre`: hoy no le toca según sus días laborables (p. ej. el sábado de quien no
// viene). No es una falta: se muestra aparte y no pide acción.
export function estadoDelRegistro(registro, libre = false) {
  if (registro?.es_ausencia) return 'ausencia'
  if (registro?.estado_marcaje === 'manual') return 'manual'
  if (!registro) return libre ? 'libre' : 'pendiente'
  if (!registro.hora_entrada) return 'pendiente'
  if (!registro.hora_salida) return 'en-curso'
  return 'completado'
}

// ¿El registro es un marcaje real del reloj (no ausencia ni horario fijo)?
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
  if (estado === 'pendiente') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (estado === 'en-curso') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (estado === 'ausencia') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (estado === 'libre') return 'border-slate-200 bg-slate-50 text-slate-600'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export function etiquetaEstado(estado) {
  if (estado === 'pendiente') return 'Sin entrada'
  if (estado === 'en-curso') return 'Jornada en curso'
  if (estado === 'ausencia') return 'Ausencia registrada'
  if (estado === 'libre') return 'Día libre'
  if (estado === 'manual') return 'Horario registrado, no es reloj real'
  return 'Jornada completa'
}
