// compat/modules/auth/OperatorPicker.jsx
// F2 — Barrera de acceso: pantalla de selección de operador + PIN.
// Aparece cuando la cuenta tiene operadores activos y aún no se eligió uno.
// Visual del sistema de referencia (listo-pos-cotizaciones): grid de tarjetas
// estilo Netflix en 3D. El servidor valida el PIN (PBKDF2) en el Worker; este
// componente solo envía operator_id + pin a /api/auth/switch-operator.
import { useEffect, useState } from 'react'
import { ArrowLeft, CircleAlert } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import DarkBackground from '../../components/auth/DarkBackground.jsx'
import UserCard from './UserCard.jsx'
import LoginPinModal from '../../components/auth/LoginPinModal'
import { CardContainer, CardBody } from '../../components/ui/3d-card.jsx'

export default function OperatorPicker() {
  const operadores = useAuthStore(state => state.operadoresDisponibles)
  const seleccionar = useAuthStore(state => state.seleccionarOperador)
  const logout = useAuthStore(state => state.logout)
  const error = useAuthStore(state => state.error)
  const limpiarError = useAuthStore(state => state.limpiarError)
  const [elegido, setElegido] = useState(null)

  useEffect(() => {
    const previous = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#0a1628'
    return () => { document.body.style.backgroundColor = previous }
  }, [])

  async function onSubmitPin(pin) {
    if (!elegido) return false
    return seleccionar(elegido.id, pin)
  }

  // Mismo reparto de columnas que el selector del POS: 1 usuario → tarjeta
  // sola centrada; 2 → dos columnas; más → cuadrícula.
  const gridClass = operadores.length === 1 ? 'single' : operadores.length === 2 ? 'double' : 'many'

  return (
    <>
      <DarkBackground />
      <main className="login-stage">
        <section className="login-panel login-panel-ready w-full max-w-md" aria-label="Selección de usuario">
          <div className="login-panel-content">
            <header className="login-panel-header">
              <div>
                <h1 className="login-panel-title">¿Quién está trabajando?</h1>
                <p className="login-panel-subtitle max-w-none">Elige tu usuario e ingresa tu PIN para continuar.</p>
              </div>
            </header>
            <div className={`operator-grid ${gridClass}`}>
              {operadores.map((op, index) => (
                <CardContainer key={op.id} containerClassName="!py-0" className="w-full">
                  <CardBody className="w-full">
                    <UserCard
                      user={op}
                      index={index}
                      ariaLabel={`Ingresar como ${op.nombre}`}
                      onClick={() => { limpiarError(); setElegido(op) }}
                    />
                  </CardBody>
                </CardContainer>
              ))}
            </div>
            {error && (
              <p className="login-form-error mt-4" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{error}</span></p>
            )}
            <div className="mt-5 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => logout()}
                className="operator-switch"
              >
                <ArrowLeft size={16} aria-hidden="true" /> Cambiar de cuenta
              </button>
            </div>
          </div>
        </section>
      </main>
      <LoginPinModal
        isOpen={!!elegido}
        onClose={() => setElegido(null)}
        user={elegido}
        onSubmit={onSubmitPin}
      />
    </>
  )
}
