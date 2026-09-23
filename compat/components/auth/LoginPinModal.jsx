// compat/components/auth/LoginPinModal.jsx
// Modal de ingreso de PIN — Dark Premium (idéntico al POS de referencia
// `listo-pos-cotizaciones`). El PIN se captura aquí y se entrega a onSubmit;
// la validación (PBKDF2) ocurre SOLO en el Worker. Nunca se compara en el navegador.
import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Delete, Loader2 } from 'lucide-react'
import LoginAvatar from './LoginAvatar'
import { tieneCapacidad, longitudPin } from '../../../server/lib/permissions.js'

function isTactil() {
  return typeof window !== 'undefined'
    && window.matchMedia('(hover: none) and (pointer: coarse)').matches
}

export default function LoginPinModal({ isOpen, onClose, onCancelPending, user, onSubmit }) {
  // Longitud del PIN por rol desde la matriz única (finanzas/nomina: 4; resto: 6).
  const PIN_LEN = longitudPin(user?.rol)

  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [working, setWorking] = useState(false)
  const [msg, setMsg] = useState(null)

  const inputRef = useRef(null)
  const submissionId = useRef(0)
  const watchdog = useRef(null)
  // Lock síncrono: evita dos envíos si el autoenvío y una pulsación coinciden en
  // el mismo tick (o si React reejecuta un efecto en StrictMode).
  const submitLockRef = useRef(false)

  // Reinicio al abrir (o al cambiar de usuario): ajuste de estado durante el
  // render — el patrón que permite React —, no dentro de un efecto.
  const [claveApertura, setClaveApertura] = useState(() => (isOpen ? String(user?.id ?? '') : null))
  const claveActual = isOpen ? String(user?.id ?? '') : null
  if (claveActual !== claveApertura) {
    setClaveApertura(claveActual)
    setPin('')
    setError(false)
    setMsg(null)
    setWorking(false)
  }

  // Los efectos solo manejan foco, watchdog y la invalidación del intento previo.
  useEffect(() => {
    submissionId.current++
    clearTimeout(watchdog.current)
    submitLockRef.current = false
    let focusTimer
    if (isOpen && !isTactil()) focusTimer = setTimeout(() => inputRef.current?.focus(), 100)
    return () => {
      submissionId.current++
      clearTimeout(watchdog.current)
      clearTimeout(focusTimer)
      submitLockRef.current = false
    }
  }, [isOpen, user?.id])

  const submit = useCallback(async () => {
    if (pin.length !== PIN_LEN || working || submitLockRef.current) return
    submitLockRef.current = true
    setWorking(true)

    // Watchdog: si la verificación no resuelve en 20s, liberar la UI. El
    // spinner "Verificando…" NUNCA queda congelado, aunque la red se cuelue.
    const attempt = ++submissionId.current
    const isCurrent = () => attempt === submissionId.current
    const later = (callback, delay) => setTimeout(() => { if (isCurrent()) callback() }, delay)
    const vigilante = setTimeout(() => {
      if (!isCurrent()) return
      submissionId.current++
      // Cancelar también la autoridad del intento, no solo esconder el spinner.
      onCancelPending?.()
      submitLockRef.current = false
      setWorking(false)
      setError(true)
      setPin('')
      setMsg('La verificación tardó demasiado. Revisa tu conexión e intenta de nuevo.')
      if (!isTactil()) inputRef.current?.focus()
    }, 20000)
    watchdog.current = vigilante

    try {
      const res = await onSubmit(pin)
      const ok = res === true || res?.ok === true
      if (!isCurrent()) return
      if (!ok) {
        // Sesión de cuenta expirada: mensaje claro y vuelta al login de correo.
        if (res?.sessionExpired) {
          setMsg(res.error || 'Tu sesión expiró. Inicia sesión nuevamente con tu correo.')
          setPin('')
          later(() => { setMsg(null); setError(false); onClose() }, 2600)
          return
        }
        if (res?.busy) {
          setMsg('La verificación anterior sigue en curso. Espera unos segundos…')
          later(() => setMsg(null), 4000)
        } else if (res?.error) {
          setMsg(res.error)
          later(() => setMsg(null), 3500)
        }
        setError(true)
        setPin('')
        later(() => setError(false), 600)
        if (!isTactil()) later(() => inputRef.current?.focus(), 100)
      }
    } catch {
      if (!isCurrent()) return
      setError(true)
      setPin('')
      later(() => setError(false), 600)
    } finally {
      clearTimeout(vigilante)
      submitLockRef.current = false
      if (isCurrent()) setWorking(false)
    }
  }, [PIN_LEN, onCancelPending, onClose, onSubmit, pin, working])

  useEffect(() => {
    if (!isOpen || pin.length !== PIN_LEN || working) return undefined
    const submitTimer = window.setTimeout(() => submit(), 0)
    return () => window.clearTimeout(submitTimer)
  }, [PIN_LEN, isOpen, pin.length, submit, working])

  function presionar(d) {
    if (pin.length >= PIN_LEN || working) return
    setPin(p => p + d)
  }

  function borrar() {
    if (working) return
    setPin(p => p.slice(0, -1))
  }

  if (!isOpen || !user) return null

  const nombre = (user.nombre || 'Usuario')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')

  // Estilo plateado para los perfiles de acceso total (derivado de la matriz).
  const esPlateado = tieneCapacidad(user, 'administrarSistema')
  const userColor = esPlateado ? '#CBD5E1' : (user.color || '#3b82f6')

  // Botones del pad — siempre con fondo oscuro para todos los roles.
  const btnStyle = {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#ffffff',
    textShadow: '0 1px 3px rgba(0,0,0,0.3)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  }
  const pressHandlers = (onDown, onUp) => ({
    onMouseDown: e => { e.currentTarget.style.background = onDown },
    onMouseUp: e => { e.currentTarget.style.background = onUp },
    onTouchStart: e => { e.currentTarget.style.background = onDown; e.currentTarget.style.transform = 'scale(0.95)' },
    onTouchEnd: e => { e.currentTarget.style.background = onUp; e.currentTarget.style.transform = 'scale(1)' },
  })

  // Las clases pin-modal-* se conservan como ganchos de identidad (contrato de
  // marca en brand.test.js); el diseño Dark Premium vive autocontenido aquí,
  // igual que en el POS de referencia (compat/styles/pin.css no se importa).
  return (
    <div
      className="pin-modal-backdrop pin-overlay fixed inset-0 z-[300] flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(5, 10, 24, 0.85)', backdropFilter: 'blur(8px)' }}
      onMouseDown={event => { if (event.target === event.currentTarget && !working) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ingreso de PIN"
        className="pin-modal-card pin-card relative w-full sm:max-w-sm sm:mx-4 rounded-t-3xl sm:rounded-3xl overflow-hidden max-h-[95dvh] overflow-y-auto"
        style={{
          background: 'linear-gradient(160deg, #0d1f3c 0%, #0a1628 60%, #081520 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
        onMouseDown={event => event.stopPropagation()}
      >
        {/* Patrón de puntos de fondo */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '16px 16px' }} />

        {/* Orbe de color del usuario */}
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, ${userColor}40 0%, transparent 70%)`, filter: 'blur(24px)' }} />

        {/* Línea superior sutil */}
        <div className="absolute top-0 left-[20%] right-[20%] h-px"
          style={{ background: `linear-gradient(to right, transparent, ${userColor}40, transparent)` }} />

        {/* Barra de arrastre en móvil */}
        <div className="sm:hidden flex justify-center pt-3 pb-1" aria-hidden="true">
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }} />
        </div>

        <div className="relative z-10 px-5 sm:px-7 pt-4 sm:pt-8 pb-5 sm:pb-7">
          {/* Botón cerrar */}
          <button
            type="button"
            onClick={() => !working && onClose()}
            disabled={working}
            aria-label="Cerrar ingreso de PIN"
            className="absolute top-3 sm:top-5 right-4 sm:right-5 min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl transition-colors"
            style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.05)' }}
          >
            <X size={18} />
          </button>

          {/* Avatar + nombre */}
          <div className="flex flex-col items-center mb-5 sm:mb-7">
            <div className="mb-3 sm:mb-4"><LoginAvatar user={user} /></div>
            <h2 className="text-lg sm:text-xl font-black text-white" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>{nombre}</h2>
            <p className="text-[11px] sm:text-xs mt-1 font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Ingresa tu PIN de {PIN_LEN} dígitos
            </p>
          </div>

          {/* Mensaje de estado (timeout, busy, error del servidor) */}
          {msg && (
            <p className="text-[11px] font-semibold text-center -mt-3 mb-3 sm:-mt-4 sm:mb-4" style={{ color: '#fbbf24' }}>
              {msg}
            </p>
          )}

          {/* Puntos indicadores */}
          <div className={`flex justify-center gap-3 sm:gap-3.5 mb-5 sm:mb-8 ${error ? 'animate-shake' : ''}`}
            aria-label={`${pin.length} de ${PIN_LEN} dígitos ingresados`}>
            {Array.from({ length: PIN_LEN }).map((_, i) => (
              <div key={i} className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full transition-all duration-200"
                style={
                  error
                    ? { background: '#ef4444', border: '2px solid #ef4444', boxShadow: '0 0 12px rgba(239,68,68,0.6)', transform: 'scale(1.1)' }
                    : i < pin.length
                      ? { background: userColor, border: `2px solid ${userColor}`, boxShadow: `0 0 14px ${userColor}70`, transform: 'scale(1.15)' }
                      : { background: 'transparent', border: '2px solid rgba(255,255,255,0.2)' }
                } />
            ))}
          </div>

          {/* Input oculto para teclado físico */}
          <input
            ref={inputRef}
            type="tel"
            maxLength={PIN_LEN}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LEN))}
            className="absolute opacity-0 w-0 h-0 min-h-11"
            autoComplete="off"
            inputMode="numeric"
            readOnly={isTactil()}
            aria-label={`PIN de ${PIN_LEN} dígitos`}
          />

          {/* Pad numérico */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 max-w-[240px] sm:max-w-[270px] mx-auto" aria-label="Teclado numérico">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
              <button key={n} type="button" aria-label={`Ingresar ${n}`}
                onPointerDown={e => { e.preventDefault(); presionar(String(n)) }}
                className="h-12 sm:h-14 rounded-xl sm:rounded-2xl text-lg sm:text-xl font-bold transition-all duration-150 active:scale-95 select-none"
                style={btnStyle}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = `${userColor}50` }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
                {...pressHandlers(`${userColor}25`, 'rgba(255,255,255,0.07)')}>
                {n}
              </button>
            ))}

            <div />

            <button type="button" aria-label="Ingresar 0"
              onPointerDown={e => { e.preventDefault(); presionar('0') }}
              className="h-12 sm:h-14 rounded-xl sm:rounded-2xl text-lg sm:text-xl font-bold transition-all duration-150 active:scale-95 select-none"
              style={btnStyle}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = `${userColor}50` }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
              {...pressHandlers(`${userColor}25`, 'rgba(255,255,255,0.07)')}>
              0
            </button>

            <button type="button" aria-label="Borrar último dígito"
              onPointerDown={e => { e.preventDefault(); borrar() }}
              className="h-12 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all duration-150 active:scale-95 select-none"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid transparent', color: 'rgba(255,255,255,0.5)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#ef4444' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}
              {...pressHandlers('rgba(239,68,68,0.2)', 'rgba(255,255,255,0.02)')}>
              <Delete size={20} className="sm:hidden" />
              <Delete size={22} className="hidden sm:block" />
            </button>
          </div>
        </div>

        {/* Overlay de carga */}
        {working && (
          <div className="absolute inset-0 z-20 rounded-t-3xl sm:rounded-3xl flex items-center justify-center"
            style={{ background: 'rgba(10,22,40,0.85)', backdropFilter: 'blur(4px)' }}>
            <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
              <Loader2 className="animate-spin" size={32} style={{ color: userColor }} />
              <p className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Verificando…</p>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pinShake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-10px); }
          40% { transform: translateX(10px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: pinShake 0.4s ease-in-out; }
        @keyframes pinFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pinSlideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pinZoomIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .pin-overlay { animation: pinFadeIn 0.2s ease; }
        .pin-card { animation: pinSlideUp 0.3s ease; }
        @media (min-width: 640px) { .pin-card { animation: pinZoomIn 0.3s ease; } }
      `}</style>
    </div>
  )
}
