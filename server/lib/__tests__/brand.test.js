import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))

async function readProjectFile(path) {
  return readFile(join(root, path), 'utf8')
}

describe('identidad de Nómina y Finanzas Construacero Carabobo', () => {
  it('conserva la interfaz y el flujo de login del sistema de referencia', async () => {
    const [indexHtml, loginSource, pinModalSource, shellSource] = await Promise.all([
      readProjectFile('index.html'),
      readProjectFile('compat/modules/auth/LoginPage.jsx'),
      readProjectFile('compat/components/auth/LoginPinModal.jsx'),
      readProjectFile('src/NominaApp.jsx'),
    ])

    expect(indexHtml).toContain('<title>Nómina y Finanzas · Construacero Carabobo</title>')
    expect(indexHtml).toContain('Nómina y finanzas de Construacero Carabobo C.A.')
    expect(loginSource).toContain('¿Quién está operando?')
    expect(loginSource).toContain('Selecciona tu usuario e ingresa tu PIN')
    expect(loginSource).toContain('LoginPinModal')
    expect(loginSource).toContain('switchOperator')
    expect(loginSource).toContain("listar_usuarios_login")
    expect(loginSource).toContain('Nómina y Finanzas')
    expect(loginSource).toContain('login-stage')
    expect(loginSource).toContain('login-panel')
    expect(loginSource).toContain('login-empty')
    expect(loginSource).toContain('Aún no hay operadores disponibles')
    expect(loginSource).toContain('Actualizar operadores')
    expect(loginSource).toContain('login-field-control')
    expect(loginSource).toContain('login-submit')
    expect(loginSource).toContain('nomina-login-email')
    expect(loginSource).toContain('nomina-login-password')
    expect(loginSource).toContain('noValidate')
    expect(loginSource).toContain('Ingresa un correo válido.')
    expect(loginSource).toContain('login-form-error')
    expect(loginSource).toContain('operator-grid')
    expect(loginSource).toContain('operator-card')
    expect(loginSource).toContain('operator-list-summary')
    expect(loginSource).not.toContain('Completa este campo')
    expect(loginSource).not.toContain('Gestión de cotizaciones, inventario y clientes')
    expect(pinModalSource).toContain('pin-modal-backdrop')
    expect(pinModalSource).toContain('pin-modal-card')
    expect(pinModalSource).toContain('pin-modal-pad')
    expect(pinModalSource).toContain('pin-modal-input')
    expect(pinModalSource).toContain('aria-modal="true"')
    expect(shellSource).toContain('Nómina y Finanzas')
    expect(shellSource).toContain('className="loader"')
    expect(shellSource).toContain('className="loader-square"')
    expect(shellSource).toContain('Array.from({ length: 7 }')
    expect(shellSource).toContain('md:hidden')
    expect(shellSource).toContain('translate-x-0')
    expect(shellSource).toContain('safe-area-inset-bottom')
  })

  it('escanea los puentes visuales y oculta scrollbars como el proyecto de referencia', async () => {
    const tailwindSource = await readProjectFile('tailwind.config.js')

    expect(tailwindSource).toContain("'./compat/**/*.{js,jsx}'")
    expect(tailwindSource).toContain("darkMode: 'class'")
    expect(tailwindSource).toContain('.scrollbar-hide')
  })

  it('mantiene el loader cuadrado y los estilos del proyecto de referencia', async () => {
    const cssSource = await readProjectFile('compat/index.css')

    expect(cssSource).toContain('@keyframes square-animation')
    expect(cssSource).toContain('.loader-square:nth-of-type(7)')
    expect(cssSource).toContain('animation: square-animation 10s ease-in-out infinite both')
    expect(cssSource).toContain('.login-form-error')
    expect(cssSource).toContain('@media (max-width: 639px) and (max-height: 560px)')
    expect(cssSource).toContain('overflow-y: auto')
    expect(cssSource).toContain('.operator-grid.single')
    expect(cssSource).toContain('.operator-card-avatar')
  })

  it('incluye los assets corporativos servidos por la pantalla de acceso', async () => {
    const [logo, favicon] = await Promise.all([
      stat(join(root, 'public/logo.png')),
      stat(join(root, 'public/favicon.png')),
    ])

    expect(logo.size).toBeGreaterThan(0)
    expect(favicon.size).toBeGreaterThan(0)
  })
})
