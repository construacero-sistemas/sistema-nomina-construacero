// Actualizaciones de la app (service worker).
//
// Reglas:
// - Una versión nueva NUNCA recarga la pantalla mientras hay un diálogo abierto,
//   un campo en edición o una operación enviándose al servidor (pagos,
//   liquidaciones): el resultado quedaría incierto.
// - Se aplica sola en un momento seguro: al cambiar de pantalla o al volver a
//   la app tras un rato fuera. También con el botón «Actualizar ahora».
// - Se revisa si hay versión nueva al volver a la app y cada 30 minutos con la
//   app visible. Solo descarga /sw.js (muy pequeño); no consulta Supabase.

export const REVISION_INTERVALO_MS = 30 * 60 * 1000
export const REVISION_MINIMA_MS = 60 * 1000
export const AUSENCIA_PARA_APLICAR_MS = 2 * 60 * 1000

const oyentes = new Set()
let estado = { lista: false }
let registro = null
let aplicando = false
let recargar = () => window.location.reload()
let estaMutando = () => 0
let documento = typeof document !== 'undefined' ? document : null

function emitir(cambios) {
  estado = { ...estado, ...cambios }
  oyentes.forEach(oyente => oyente(estado))
}

export function suscribirActualizacion(oyente) {
  oyentes.add(oyente)
  oyente(estado)
  return () => oyentes.delete(oyente)
}

export function hayActualizacionLista() {
  return estado.lista
}

/** Momento en que recargar no puede perder trabajo ni dejar un pago a medias. */
export function esMomentoSeguro({ doc = documento, mutando = estaMutando() } = {}) {
  if (mutando > 0) return false
  if (!doc) return true
  if (doc.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')) return false
  const activo = doc.activeElement
  if (activo && activo !== doc.body && (activo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(activo.tagName))) return false
  return true
}

/** Aplica la versión nueva. Devuelve false si hay una operación enviándose. */
export function aplicarActualizacion({ forzar = false } = {}) {
  if (!estado.lista || aplicando) return false
  if (!forzar && !esMomentoSeguro()) return false
  if (estaMutando() > 0) return false
  aplicando = true
  if (registro?.waiting) {
    // El SW responde con skipWaiting → controllerchange → recarga.
    registro.waiting.postMessage({ type: 'SKIP_WAITING' })
  } else {
    // Otra pestaña ya activó la versión nueva: basta con recargar.
    recargar()
  }
  return true
}

export function aplicarSiEsSeguro() {
  return estado.lista ? aplicarActualizacion() : false
}

/**
 * Registra el service worker y prepara la revisión de versiones.
 * Devuelve una función para detener los temporizadores (pruebas).
 */
export async function iniciarActualizaciones({
  sw = navigator.serviceWorker,
  win = window,
  doc = document,
  mutando = () => 0,
  recargarPagina = () => win.location.reload(),
  intervaloMs = REVISION_INTERVALO_MS,
  ahora = () => Date.now(),
} = {}) {
  estaMutando = mutando
  recargar = recargarPagina
  documento = doc
  aplicando = false
  estado = { lista: false }

  // En la primera visita no hay controlador: el clients.claim() del SW nuevo
  // dispara controllerchange y eso no es una actualización.
  let teniaControlador = Boolean(sw.controller)
  sw.addEventListener('controllerchange', () => {
    if (!teniaControlador) { teniaControlador = true; return }
    if (aplicando || esMomentoSeguro()) {
      aplicando = true
      recargar()
      return
    }
    // Otra pestaña activó la versión nueva y aquí hay trabajo abierto:
    // esperar a un momento seguro.
    registro = null
    emitir({ lista: true, avisoEn: ahora() })
  })

  registro = await sw.register('/sw.js', { updateViaCache: 'none' })
  const reg = registro

  const marcarSiEspera = () => {
    if (reg.waiting && sw.controller && !estado.lista) emitir({ lista: true, avisoEn: ahora() })
  }
  marcarSiEspera()
  reg.addEventListener('updatefound', () => {
    const nuevo = reg.installing
    nuevo?.addEventListener('statechange', () => {
      if (nuevo.state === 'installed') marcarSiEspera()
    })
  })

  let ultimaRevision = ahora()
  const revisar = () => {
    if (estado.lista || ahora() - ultimaRevision < REVISION_MINIMA_MS) return
    ultimaRevision = ahora()
    Promise.resolve(reg.update()).catch(() => undefined)
  }

  let ocultaDesde = null
  const alCambiarVisibilidad = () => {
    if (doc.visibilityState === 'hidden') { ocultaDesde = ahora(); return }
    const fuera = ocultaDesde === null ? 0 : ahora() - ocultaDesde
    ocultaDesde = null
    if (estado.lista) {
      if (fuera >= AUSENCIA_PARA_APLICAR_MS) aplicarSiEsSeguro()
      if (estado.lista && !aplicando) emitir({ avisoEn: ahora() })
      return
    }
    revisar()
  }
  doc.addEventListener('visibilitychange', alCambiarVisibilidad)
  const temporizador = win.setInterval(() => {
    if (doc.visibilityState !== 'hidden') revisar()
  }, intervaloMs)

  return () => {
    doc.removeEventListener('visibilitychange', alCambiarVisibilidad)
    win.clearInterval(temporizador)
  }
}

// Registro compartido con public/auto-recovery.js (misma clave y ventana).
export const CLAVE_RECUPERACION = 'recuperacion-version'
export const RECUPERACION_VENTANA_MS = 2 * 60 * 1000

export function puedeIntentarRecuperacion(ahora = Date.now(), almacen = globalThis.sessionStorage) {
  try {
    const previo = Number(almacen?.getItem(CLAVE_RECUPERACION))
    return !previo || ahora - previo > RECUPERACION_VENTANA_MS
  } catch {
    // Sin almacenamiento no se puede limitar los intentos: mejor no recargar.
    return false
  }
}

export function marcarIntentoRecuperacion(ahora = Date.now(), almacen = globalThis.sessionStorage) {
  try { almacen?.setItem(CLAVE_RECUPERACION, String(ahora)) } catch { /* modo privado: sin registro */ }
}

/** Solo para pruebas. */
export function _reiniciarActualizacionParaPruebas() {
  oyentes.clear()
  estado = { lista: false }
  registro = null
  aplicando = false
}
