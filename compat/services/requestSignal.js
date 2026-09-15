// Combina cancelación del llamador, cambio de sesión y timeout sin perder señales.
export function requestSignal(signals = [], timeout = 15000) {
  const controller = new AbortController()
  const listeners = []
  let timedOut = false
  for (const signal of signals.filter(Boolean)) {
    if (signal.aborted) { controller.abort(signal.reason); break }
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    listeners.push([signal, abort])
  }
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Tiempo de espera agotado', 'TimeoutError'))
  }, timeout)
  return {
    signal: controller.signal,
    get timedOut() { return timedOut },
    dispose() {
      clearTimeout(timer)
      for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener)
    },
  }
}
