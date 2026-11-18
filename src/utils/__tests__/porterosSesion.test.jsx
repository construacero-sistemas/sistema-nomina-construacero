import { describe, it, expect } from 'vitest'
import { act, render } from '@testing-library/react'
import { MemoryRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { decisionPorteroPrivado, decisionPorteroPublico, sesionAdmitida } from '../porterosSesion.js'

const ROLES = [undefined, 'jefe', 'finanzas', 'nomina', 'desarrollador', 'vendedor', 'rol-raro']
const ESTADOS = ['initializing', 'loading-profile', 'authenticated', 'seleccion-pendiente', 'denied', 'error', 'anonymous']

function todasLasCombinaciones() {
  const lista = []
  for (const initialized of [false, true])
    for (const conUsuario of [false, true])
      for (const rol of [null, ...ROLES])
        for (const authStatus of ESTADOS)
          lista.push({
            initialized,
            user: conUsuario ? { id: 'u1' } : null,
            perfil: rol === null ? null : { id: 'p1', rol },
            authStatus,
          })
  return lista
}

describe('porteros de sesión: regla única', () => {
  it('para ningún estado posible redirigen los dos a la vez', () => {
    for (const estado of todasLasCombinaciones()) {
      const privado = decisionPorteroPrivado(estado)
      const publico = decisionPorteroPublico(estado)
      expect(privado === 'ir-login' && publico === 'ir-modulo', JSON.stringify(estado)).toBe(false)
    }
  })

  it('con sesión abierta el portero privado nunca cambia la dirección', () => {
    for (const estado of todasLasCombinaciones().filter(e => e.initialized && e.user)) {
      expect(decisionPorteroPrivado(estado)).not.toBe('ir-login')
    }
  })

  it('solo entra un perfil autenticado con acceso a Nómina o Finanzas', () => {
    expect(sesionAdmitida({ perfil: { rol: 'jefe' }, authStatus: 'authenticated' })).toBe(true)
    expect(sesionAdmitida({ perfil: { rol: 'nomina' }, authStatus: 'authenticated' })).toBe(true)
    expect(sesionAdmitida({ perfil: { rol: 'vendedor' }, authStatus: 'authenticated' })).toBe(false)
    expect(sesionAdmitida({ perfil: { rol: 'jefe' }, authStatus: 'error' })).toBe(false)
    expect(sesionAdmitida({ perfil: null, authStatus: 'authenticated' })).toBe(false)
  })
})

// Réplica mínima del árbol de rutas de NominaApp con los mismos porteros.
function Privado({ estado }) {
  const d = decisionPorteroPrivado(estado)
  if (d === 'cargando') return <p>cargando</p>
  if (d === 'acceso-en-sitio') return <p>acceso</p>
  if (d === 'ir-login') return <Navigate to="/login" replace />
  return <Outlet />
}

function Publico({ estado }) {
  const d = decisionPorteroPublico(estado)
  if (d === 'cargando') return <p>cargando</p>
  if (d === 'ir-modulo') return <Navigate to="/finanzas" replace />
  return <Outlet />
}

function Espia({ onRuta }) {
  onRuta(useLocation().key)
  return null
}

function Arbol({ estado, onRuta }) {
  return (
    <>
      <Espia onRuta={onRuta} />
      <Routes>
        <Route element={<Publico estado={estado} />}><Route path="/login" element={<p>login</p>} /></Route>
        <Route element={<Privado estado={estado} />}><Route path="/finanzas" element={<p>finanzas</p>} /></Route>
      </Routes>
    </>
  )
}

describe('porteros de sesión: cambios rápidos de estado', () => {
  it('la sesión que parpadea entre cargando, error y autenticada no rebota la dirección', () => {
    const claves = new Set()
    let estado = { initialized: true, user: { id: 'u1' }, perfil: { id: 'p1', rol: 'jefe' }, authStatus: 'authenticated' }
    const onRuta = k => claves.add(k)
    const arbol = () => <MemoryRouter initialEntries={['/finanzas']}><Arbol estado={estado} onRuta={onRuta} /></MemoryRouter>
    const { rerender } = render(arbol())
    const secuencia = [
      { perfil: null, authStatus: 'denied' },
      { perfil: { id: 'p1', rol: 'jefe' }, authStatus: 'error' },
      { perfil: { id: 'p1', rol: 'jefe' }, authStatus: 'authenticated' },
      { perfil: null, authStatus: 'loading-profile' },
    ]
    for (let vuelta = 0; vuelta < 60; vuelta += 1) {
      for (const parche of secuencia) {
        estado = { ...estado, ...parche }
        act(() => rerender(arbol()))
      }
    }
    // Con sesión abierta nunca hubo una navegación: la dirección inicial se mantiene.
    expect(claves.size).toBe(1)
  })
})
