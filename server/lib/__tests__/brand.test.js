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
    const [indexHtml, loginSource, pinModalSource, shellSource, authStoreSource, employeeModalSource, userCardSource, pwaSource] = await Promise.all([
      readProjectFile('index.html'),
      readProjectFile('compat/modules/auth/LoginPage.jsx'),
      readProjectFile('compat/components/auth/LoginPinModal.jsx'),
      readProjectFile('src/NominaApp.jsx'),
      readProjectFile('compat/store/useAuthStore.js'),
      readProjectFile('src/components/nomina/EmpleadoConfigModal.jsx'),
      readProjectFile('compat/modules/auth/UserCard.jsx'),
      readProjectFile('compat/modules/auth/PwaInstallButton.jsx'),
    ])

    expect(indexHtml).toContain('<title>Nómina y Finanzas · Construacero Carabobo</title>')
    expect(indexHtml).toContain('Nómina y finanzas de Construacero Carabobo C.A.')
    expect(loginSource).toContain('Bienvenido')
    expect(loginSource).toContain('El acceso quedará guardado en este dispositivo')
    expect(loginSource).toContain("/store/useAuthStore")
    expect(authStoreSource).toContain("/api/auth/me")
    expect(loginSource).toContain('Acceso a la cuenta')
    expect(loginSource).toContain('login-stage')
    expect(loginSource).toContain('login-panel')
    expect(loginSource).not.toContain('operator-grid')
    expect(loginSource).not.toContain('listar_usuarios_login')
    expect(loginSource).not.toContain('Cambiar usuario')
    expect(loginSource).toContain('login-field-control')
    expect(loginSource).toContain('login-field-icon')
    expect(loginSource).toContain('login-field-password-control')
    expect(loginSource).toContain('submitReady')
    expect(loginSource).toContain('login-submit')
    expect(loginSource).toContain('nomina-login-email')
    expect(loginSource).toContain('nomina-login-password')
    expect(loginSource).toContain('noValidate')
    expect(loginSource).toContain('Ingresa un correo válido.')
    expect(loginSource).toContain('login-form-error')
    expect(shellSource).toContain('Cerrar sesión')
    expect(shellSource).toContain('await logout()')
    expect(userCardSource).toContain('operator-card')
    expect(userCardSource).toContain('operator-card-avatar-wrap')
    expect(userCardSource).toContain("label: 'Cuenta'")
    expect(pwaSource).toContain('beforeinstallprompt')
    expect(loginSource).not.toContain('supabase.auth.signOut')
    expect(loginSource).not.toContain('Completa este campo')
    expect(loginSource).not.toContain('Gestión de cotizaciones, inventario y clientes')
    expect(pinModalSource).toContain('pin-modal-backdrop')
    expect(pinModalSource).toContain('pin-modal-card')
    expect(pinModalSource).toContain('aria-modal="true"')
    expect(shellSource).toContain("label: 'Nómina'")
    expect(shellSource).toContain('className="loader"')
    expect(shellSource).toContain('className="loader-square"')
    expect(shellSource).toContain('Array.from({ length: 7 }')
    expect(shellSource).toContain('md:hidden')
    expect(shellSource).toContain('translate-x-0')
    expect(shellSource).toContain('safe-area-inset-bottom')
    expect(authStoreSource).toContain("signOut({ scope: 'local' })")
    expect(authStoreSource).toContain('finally {')
    expect(authStoreSource).toContain('/api/auth/me')
    expect(authStoreSource).toContain('VITE_AUTH_DEBUG')
    expect(await readProjectFile('scripts/check-local-dev.mjs')).toContain('SUPABASE_SERVICE_KEY')
    expect(employeeModalSource).toContain('tipo_cliente === \'personal\'')
    expect(employeeModalSource).toContain('Nombre completo')
    expect(employeeModalSource).toContain('Registra aquí al empleado')
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
    expect(cssSource).toContain('.login-field-icon')
    expect(cssSource).toContain('padding-left: 44px !important')
    expect(cssSource).toContain('.login-field-password-control')
    expect(cssSource).toContain('.login-submit:disabled')
    expect(cssSource).toContain('@media (max-width: 639px) and (max-height: 560px)')
    expect(cssSource).not.toContain("@import './styles/pin.css'")
    expect(cssSource).toContain('.operator-grid.single')
    expect(cssSource).toContain('.operator-card-avatar')
    expect(cssSource).toContain('.operator-card-avatar-wrap')
    expect(cssSource).toContain('.operator-card-role')
    expect(cssSource).toContain('text-wrap: balance')
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
