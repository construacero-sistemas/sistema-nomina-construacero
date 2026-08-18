// src/components/auth/LoginPinModal.jsx
// Modal de ingreso de PIN — tarjeta responsive y autocontenida.
import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Delete, Loader2 } from 'lucide-react'
import LoginAvatar from './LoginAvatar'

function isTactileDevice() {
  return typeof window !== 'undefined'
    && window.matchMedia('(hover: none) and (pointer: coarse)').matches
}

export default function LoginPinModal({ isOpen, onClose, user, onSubmit }) {
  const PIN_LEN = (user?.rol === 'vendedor' || user?.rol === 'vendedor_sin_comision') ? 4 : 6

  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [working, setWorking] = useState(false)
  const inputRef = useRef(null)
  // El estado de React se actualiza después del evento actual. Este lock síncrono
  // evita dos POST si el efecto de autoenvío y una pulsación coinciden en el mismo
  // tick, o si React reejecuta un efecto durante StrictMode en desarrollo.
  const submitLockRef = useRef(false)

  const submit = useCallback(async () => {
    if (pin.length !== PIN_LEN || working || submitLockRef.current) return
    submitLockRef.current = true
    setWorking(true)

    let ok = false
    try {
      ok = await onSubmit(pin)
    } catch {
      // El componente solo necesita un resultado negativo para desbloquear el
      // modal; el detalle de red queda a cargo del store.
      ok = false
    }

    if (!ok) {
      setError(true)
      setPin('')
      window.setTimeout(() => setError(false), 600)
      if (!isTactileDevice()) window.setTimeout(() => inputRef.current?.focus(), 100)
    }

    submitLockRef.current = false
    setWorking(false)
  }, [PIN_LEN, onSubmit, pin, working])

  useEffect(() => {
    if (!isOpen) {
      submitLockRef.current = false
      return undefined
    }
    submitLockRef.current = false
    const resetTimer = window.setTimeout(() => {
      setPin('')
      setError(false)
    }, 0)
    const focusTimer = !isTactileDevice()
      ? window.setTimeout(() => inputRef.current?.focus(), 100)
      : null
    return () => {
      window.clearTimeout(resetTimer)
      if (focusTimer) window.clearTimeout(focusTimer)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined
    const handleEscape = event => {
      if (event.key === 'Escape' && !working) onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose, working])

  useEffect(() => {
    if (pin.length !== PIN_LEN || working) return undefined
    const submitTimer = window.setTimeout(() => submit(), 0)
    return () => window.clearTimeout(submitTimer)
  }, [PIN_LEN, pin.length, submit, working])

  function presionar(digit) {
    if (pin.length >= PIN_LEN || working) return
    setPin(value => value + digit)
  }

  function borrar() {
    if (working) return
    setPin(value => value.slice(0, -1))
  }

  if (!isOpen || !user) return null

  const nombre = (user.nombre || 'Usuario')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
  const esPlateado = ['administracion', 'logistica'].includes(user.rol)
  const userColor = esPlateado ? '#CBD5E1' : (user.color || '#3b82f6')

  const dotStyle = index => {
    if (error) {
      return {
        background: '#ef4444',
        borderColor: '#ef4444',
        boxShadow: '0 0 12px rgba(239,68,68,0.6)',
        transform: 'scale(1.1)',
      }
    }
    if (index < pin.length) {
      return {
        background: userColor,
        borderColor: userColor,
        boxShadow: `0 0 14px ${userColor}70`,
        transform: 'scale(1.15)',
      }
    }
    return undefined
  }

  const keyStyle = { '--pin-accent': userColor }

  return (
    <div
      className="pin-modal-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !working) onClose()
      }}
    >
      <div
        className="pin-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-modal-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="pin-modal-pattern" aria-hidden="true" />
        <div
          className="pin-modal-orb"
          aria-hidden="true"
          style={{ background: `radial-gradient(circle, ${userColor}45 0%, transparent 70%)` }}
        />
        <div
          className="pin-modal-accent-line"
          aria-hidden="true"
          style={{ background: `linear-gradient(to right, transparent, ${userColor}70, transparent)` }}
        />
        <div className="pin-modal-handle" aria-hidden="true" />

        <div className="pin-modal-content">
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="pin-modal-close"
            aria-label="Cerrar ingreso de PIN"
          >
            <X size={18} />
          </button>

          <div className="pin-modal-user">
            <LoginAvatar user={user} className="pin-modal-avatar" />
            <h2 id="pin-modal-title" className="pin-modal-user-name">{nombre}</h2>
            <p className="pin-modal-user-help">Ingresa tu PIN de {PIN_LEN} dígitos</p>
          </div>

          <div
            className={`pin-modal-dots${error ? ' shake' : ''}`}
            aria-label={`${pin.length} de ${PIN_LEN} dígitos ingresados`}
          >
            {Array.from({ length: PIN_LEN }).map((_, index) => (
              <span key={index} className="pin-modal-dot" style={dotStyle(index)} />
            ))}
          </div>

          <input
            ref={inputRef}
            className="pin-modal-input"
            type="tel"
            maxLength={PIN_LEN}
            value={pin}
            onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LEN))}
            autoComplete="one-time-code"
            inputMode="numeric"
            readOnly={isTactileDevice()}
            aria-label={`PIN de ${PIN_LEN} dígitos`}
          />

          <div className="pin-modal-pad" aria-label="Teclado numérico">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => (
              <button
                key={digit}
                type="button"
                className="pin-modal-key"
                style={keyStyle}
                onPointerDown={event => {
                  event.preventDefault()
                  presionar(String(digit))
                }}
                aria-label={`Ingresar ${digit}`}
              >
                {digit}
              </button>
            ))}
            <span className="pin-modal-pad-spacer" aria-hidden="true" />
            <button
              type="button"
              className="pin-modal-key"
              style={keyStyle}
              onPointerDown={event => {
                event.preventDefault()
                presionar('0')
              }}
              aria-label="Ingresar 0"
            >
              0
            </button>
            <button
              type="button"
              className="pin-modal-key pin-modal-key-delete"
              onPointerDown={event => {
                event.preventDefault()
                borrar()
              }}
              aria-label="Borrar último dígito"
            >
              <Delete size={21} />
            </button>
          </div>
        </div>

        {working && (
          <div className="pin-modal-loading" role="status" aria-live="polite">
            <div className="pin-modal-loading-content">
              <Loader2 className="animate-spin" size={30} style={{ color: userColor }} />
              <span>Verificando…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
