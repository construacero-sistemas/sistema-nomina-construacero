// compat/lib/__tests__/actualizacionApp.test.js
// Una versión nueva nunca recarga con diálogos abiertos, campos en edición u
// operaciones enviándose; se revisa al volver a la app y cada 30 minutos; y la
// recuperación ante archivos viejos tiene límite de intentos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUSENCIA_PARA_APLICAR_MS, RECUPERACION_VENTANA_MS, REVISION_INTERVALO_MS,
  _reiniciarActualizacionParaPruebas, aplicarActualizacion, esMomentoSeguro,
  hayActualizacionLista, iniciarActualizaciones, marcarIntentoRecuperacion,
  puedeIntentarRecuperacion, suscribirActualizacion,
} from '../actualizacionApp.js'

function crearEntorno({ conControlador = true, conEspera = false } = {}) {
  const oyentesSw = {}
  const oyentesReg = {}
  const waiting = { postMessage: vi.fn() }
  const registro = {
    waiting: conEspera ? waiting : null,
    installing: null,
    update: vi.fn(() => Promise.resolve()),
    addEventListener: (tipo, fn) => { oyentesReg[tipo] = fn },
  }
  const sw = {
    controller: conControlador ? {} : null,
    register: vi.fn(() => Promise.resolve(registro)),
    addEventListener: (tipo, fn) => { oyentesSw[tipo] = fn },
  }
  let reloj = 1_000_000
  let visibilidad = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilidad })
  const recargar = vi.fn()
  const mutando = vi.fn(() => 0)
  const ctx = {
    sw, registro, waiting, recargar, mutando,
    avanzar: ms => { reloj += ms },
    ocultar: () => { visibilidad = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) },
    mostrar: () => { visibilidad = 'visible'; document.dispatchEvent(new Event('visibilitychange')) },
    instalarNueva: () => {
      const nuevo = { state: 'installing', addEventListener: (t, fn) => { nuevo.fn = fn } }
      registro.installing = nuevo
      oyentesReg.updatefound()
      nuevo.state = 'installed'
      registro.waiting = waiting
      nuevo.fn()
    },
    cambioControlador: () => oyentesSw.controllerchange(),
  }
  ctx.iniciar = () => iniciarActualizaciones({ sw, win: window, doc: document, mutando, recargarPagina: recargar, ahora: () => reloj })
  return ctx
}

let detener
beforeEach(() => {
  vi.useFakeTimers()
  _reiniciarActualizacionParaPruebas()
  document.body.innerHTML = ''
  sessionStorage.clear()
})
afterEach(() => {
  detener?.()
  detener = undefined
  vi.useRealTimers()
})

describe('esMomentoSeguro', () => {
  it('no es seguro con un diálogo abierto, un campo enfocado o una operación en curso', () => {
    expect(esMomentoSeguro({ doc: document, mutando: 0 })).toBe(true)
    expect(esMomentoSeguro({ doc: document, mutando: 1 })).toBe(false)

    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>'
    expect(esMomentoSeguro({ doc: document, mutando: 0 })).toBe(false)

    document.body.innerHTML = '<input id="campo" />'
    document.getElementById('campo').focus()
    expect(esMomentoSeguro({ doc: document, mutando: 0 })).toBe(false)
  })
})

describe('iniciarActualizaciones', () => {
  it('detecta la versión nueva y avisa, sin activarla ni recargar sola', async () => {
    const ctx = crearEntorno()
    detener = await ctx.iniciar()
    const oyente = vi.fn()
    suscribirActualizacion(oyente)

    ctx.instalarNueva()

    expect(hayActualizacionLista()).toBe(true)
    expect(oyente).toHaveBeenLastCalledWith(expect.objectContaining({ lista: true }))
    expect(ctx.waiting.postMessage).not.toHaveBeenCalled()
    expect(ctx.recargar).not.toHaveBeenCalled()
  })

  it('en la primera visita (sin controlador) no avisa ni recarga', async () => {
    const ctx = crearEntorno({ conControlador: false, conEspera: true })
    detener = await ctx.iniciar()
    expect(hayActualizacionLista()).toBe(false)
    ctx.cambioControlador()
    expect(ctx.recargar).not.toHaveBeenCalled()
  })

  it('«Actualizar ahora» activa la versión y recarga al tomar el control', async () => {
    const ctx = crearEntorno({ conEspera: true })
    detener = await ctx.iniciar()
    expect(aplicarActualizacion({ forzar: true })).toBe(true)
    expect(ctx.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    ctx.cambioControlador()
    expect(ctx.recargar).toHaveBeenCalledTimes(1)
  })

  it('no aplica mientras una operación se está enviando, ni aun forzando', async () => {
    const ctx = crearEntorno({ conEspera: true })
    detener = await ctx.iniciar()
    ctx.mutando.mockReturnValue(1)
    expect(aplicarActualizacion({ forzar: true })).toBe(false)
    expect(ctx.waiting.postMessage).not.toHaveBeenCalled()
  })

  it('no aplica sola con un diálogo abierto', async () => {
    const ctx = crearEntorno({ conEspera: true })
    detener = await ctx.iniciar()
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>'
    expect(aplicarActualizacion()).toBe(false)
    expect(ctx.waiting.postMessage).not.toHaveBeenCalled()
  })

  it('si otra pestaña cambia la versión con un diálogo abierto, espera en vez de recargar', async () => {
    const ctx = crearEntorno()
    detener = await ctx.iniciar()
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>'
    ctx.cambioControlador()
    expect(ctx.recargar).not.toHaveBeenCalled()
    expect(hayActualizacionLista()).toBe(true)

    document.body.innerHTML = ''
    expect(aplicarActualizacion()).toBe(true)
    expect(ctx.recargar).toHaveBeenCalledTimes(1)
  })

  it('al volver a la app tras un rato fuera aplica la versión pendiente si es seguro', async () => {
    const ctx = crearEntorno({ conEspera: true })
    detener = await ctx.iniciar()
    ctx.ocultar()
    ctx.avanzar(AUSENCIA_PARA_APLICAR_MS - 1000)
    ctx.mostrar()
    expect(ctx.waiting.postMessage).not.toHaveBeenCalled()

    ctx.ocultar()
    ctx.avanzar(AUSENCIA_PARA_APLICAR_MS)
    ctx.mostrar()
    expect(ctx.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('revisa si hay versión nueva al volver a la app y cada 30 minutos', async () => {
    const ctx = crearEntorno()
    detener = await ctx.iniciar()

    ctx.ocultar()
    ctx.avanzar(10 * 60 * 1000)
    ctx.mostrar()
    expect(ctx.registro.update).toHaveBeenCalledTimes(1)

    // Volver enseguida no repite la consulta.
    ctx.ocultar()
    ctx.mostrar()
    expect(ctx.registro.update).toHaveBeenCalledTimes(1)

    ctx.avanzar(REVISION_INTERVALO_MS)
    vi.advanceTimersByTime(REVISION_INTERVALO_MS)
    expect(ctx.registro.update).toHaveBeenCalledTimes(2)
  })
})

describe('límite de recuperación', () => {
  it('permite un intento cada 2 minutos', () => {
    const ahora = 5_000_000
    expect(puedeIntentarRecuperacion(ahora)).toBe(true)
    marcarIntentoRecuperacion(ahora)
    expect(puedeIntentarRecuperacion(ahora + 1000)).toBe(false)
    expect(puedeIntentarRecuperacion(ahora + RECUPERACION_VENTANA_MS + 1)).toBe(true)
  })

  it('sin almacenamiento disponible no recarga, para no entrar en bucle', () => {
    const roto = { getItem: () => { throw new Error('bloqueado') } }
    expect(puedeIntentarRecuperacion(1, roto)).toBe(false)
  })
})
