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
    const [indexHtml, loginSource, shellSource] = await Promise.all([
      readProjectFile('index.html'),
      readProjectFile('compat/modules/auth/LoginPage.jsx'),
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
    expect(loginSource).not.toContain('Gestión de cotizaciones, inventario y clientes')
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
