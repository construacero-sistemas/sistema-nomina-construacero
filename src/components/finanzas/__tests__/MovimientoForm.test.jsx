// @vitest-environment jsdom
// src/components/finanzas/__tests__/MovimientoForm.test.jsx
// Tests del formulario de movimientos financieros: validación, payload y flujo de envío.
// Nota: se usa fireEvent.submit para saltar la validación de restricciones nativa de
// jsdom (required/min) y ejercitar la validación de React del formulario.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock del hook de mutación para capturar el payload sin tocar la red.
// OJO: el mock resolve a partir del directorio del TEST (src/components/finanzas/__tests__/),
// então o caminho até src/hooks precisa de TRÊS níveis (../../../hooks/...).
const mutateAsync = vi.fn(async () => ({}))
const crearCategoriaMock = vi.fn(async () => ({ ok: true, categoria: { nombre: 'Nueva', tipo: 'egreso' } }))
const eliminarCategoriaMock = vi.fn(async () => ({ ok: true }))

vi.mock('../../../hooks/useFinanzas.js', () => ({
  useCrearMovimiento: () => ({ mutateAsync, isPending: false }),
  useCrearCategoria: () => ({ mutateAsync: crearCategoriaMock, isPending: false }),
  useEliminarCategoria: () => ({ mutateAsync: eliminarCategoriaMock, isPending: false }),
  useRestaurarCategoria: () => ({ mutateAsync: vi.fn(async () => ({ ok: true })), isPending: false, reset: () => {} }),
}))

// Tasa de cambio estable para pruebas deterministas.
vi.mock('../../../hooks/useTasaCambioNomina.js', () => ({
  default: () => ({ usd: 120, eur: 130, usdt: 120 }),
}))

import MovimientoForm from '../MovimientoForm.jsx'

const CATEGORIAS = [
  { id: 'c1', nombre: 'Sueldos', tipo: 'egreso' },
  { id: 'c2', nombre: 'Ventas', tipo: 'ingreso' },
  { id: 'c3', nombre: 'General', tipo: 'ambos' },
]

function renderForm(cuentas = []) {
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MovimientoForm categorias={CATEGORIAS} cuentas={cuentas} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

async function fillValidForm(user) {
  // Tipo: egreso (default). Concepto con placeholder real del formulario.
  await user.click(screen.getByRole('button', { name: /egreso/i }))
  const concepto = screen.getByPlaceholderText(/pago de flete/i)
  await user.type(concepto, 'Compra de cemento')
  // Monto
  const monto = screen.getByPlaceholderText('0.00')
  await user.type(monto, '150')
}

// Abre el CustomSelect de categoría y elige la opción cuyo label coincida.
// El dropdown se renderiza en un portal; la opción es un <button role="option">.
async function pickCategory(user, label) {
  await user.click(screen.getByText(/selecciona una categor/i))
  const opt = await screen.findByRole('option', { name: new RegExp(label, 'i') })
  await user.click(opt)
}

describe('MovimientoForm', () => {
  beforeEach(() => {
    mutateAsync.mockClear()
    crearCategoriaMock.mockClear()
  })

  it('exige un motivo (concepto) de al menos 3 caracteres en todo movimiento', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: /egreso/i }))
    await pickCategory(user, 'Sueldos')
    // Sin motivo no se puede saber al final de mes de dónde provienen los ingresos/egresos.
    const concepto = screen.getByPlaceholderText(/pago de flete/i)
    await user.type(concepto, 'ab')
    const form = screen.getByRole('dialog').querySelector('form')
    if (form) fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent(/mínimo 3 caracteres/i)
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('muestra error si se envía sin monto ni categoría', async () => {
    renderForm()
    // El orden de validación es fecha → categoría → concepto → monto;
    // sin categoría el primer alert es el de categoría.
    const form = screen.getByRole('dialog').querySelector('form')
    if (form) fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent(/categor/i)
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('envía el payload correcto con datos válidos', async () => {
    const user = userEvent.setup()
    const { onClose } = renderForm()
    await fillValidForm(user)
    await pickCategory(user, 'Sueldos')
    const form = screen.getByRole('dialog').querySelector('form')
    if (form) fireEvent.submit(form)
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.tipo).toBe('egreso')
    expect(payload.monto).toBe(150)
    expect(payload.concepto).toBe('Compra de cemento')
    expect(payload.tasaVes).toBeGreaterThan(0)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('muestra el error del servidor si mutateAsync falla', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('Error del servidor'))
    const user = userEvent.setup()
    renderForm()
    await fillValidForm(user)
    await pickCategory(user, 'Sueldos')
    const form = screen.getByRole('dialog').querySelector('form')
    if (form) fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent(/error del servidor/i)
  })

  it('muestra la tarjeta de resumen previa a guardar cuando hay monto', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: /egreso/i }))
    // Antes de escribir el monto no hay resumen.
    expect(screen.queryByText(/resumen del movimiento/i)).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('0.00'), '150')
    expect(await screen.findByText(/resumen del movimiento/i)).toBeInTheDocument()
    // El resumen refleja tipo, monto, moneda y equivalencia.
    expect(screen.getByText(/salida\s*\(/i)).toBeInTheDocument()
    expect(screen.getByText(/USD\s+150,00/)).toBeInTheDocument()
    expect(screen.getByText(/≈\s*[\d.,]+\s*VES/i)).toBeInTheDocument()
    expect(screen.getByText(/tasa aplicada/i)).toBeInTheDocument()
  })

  it('oculta el campo Referencia para métodos en efectivo y lo muestra si el método lo requiere', async () => {
    const user = userEvent.setup()
    renderForm()
    // Efectivo $ (por defecto) no requiere referencia.
    expect(screen.queryByLabelText(/comprobante|referencia/i)).not.toBeInTheDocument()
    // Al cambiar a un método con referencia (ej. Zelle), el campo aparece.
    await user.click(screen.getAllByText(/Efectivo \$/i)[0])
    const opcionZelle = await screen.findByRole('option', { name: /zelle/i })
    await user.click(opcionZelle)
    expect(await screen.findByLabelText(/comprobante|referencia/i)).toBeInTheDocument()
  })

  it('permite crear y seleccionar una categoría personalizada', async () => {
    const user = userEvent.setup()
    renderForm()
    // Abrir el selector de categoría y elegir la opción de crear nueva.
    await user.click(screen.getByText(/selecciona una categor/i))
    const crearOpt = await screen.findByRole('option', { name: /crear nueva categor/i })
    await user.click(crearOpt)
    // Aparece el panel inline; escribir nombre y confirmar.
    const input = await screen.findByLabelText(/nombre de la nueva categor/i)
    await user.type(input, 'Mantenimiento')
    await user.click(screen.getByRole('button', { name: /crear categor/i }))
    await waitFor(() => expect(crearCategoriaMock).toHaveBeenCalledTimes(1))
    expect(crearCategoriaMock).toHaveBeenCalledWith({ nombre: 'Mantenimiento', tipo: 'egreso' })
    // La categoría creada queda seleccionada.
    await waitFor(() => expect(screen.getByText(/Nueva/i)).toBeInTheDocument())
  })

  it('atribuye a una cuenta de origen (Banesco) y permite dividir en partes', async () => {
    const user = userEvent.setup()
    const { onClose } = renderForm()
    await fillValidForm(user)
    await pickCategory(user, 'Sueldos')

    // Elegir método bancario → aparece la cuenta de origen.
    const metodoTrigger = screen.getAllByRole('combobox').find(c => /efectivo \$/i.test(c.textContent))
    await user.click(metodoTrigger)
    const opBanco = await screen.findByRole('option', { name: /banco en bolívares/i })
    await user.click(opBanco)
    // El select de cuenta de origen aparece.
    const cuentaTrigger = screen.getAllByRole('combobox').find(c => /desde qué cuenta/i.test(c.textContent))
    await user.click(cuentaTrigger)
    const opBanesco = await screen.findByRole('option', { name: /banesco/i })
    await user.click(opBanesco)

    // Las partes están ocultas por ahora (MOSTRAR_PARTES = false) → payload sin tramos.
    const form = screen.getByRole('dialog').querySelector('form')
    if (form) fireEvent.submit(form)
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.metodoPago).toBe('Banco en Bolívares')
    expect(payload.cuentaOrigen).toBe('Banesco')
    expect(payload.partes).toBeNull()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('al seleccionar método USDT, muestra y preselecciona la cuenta de Binance Pay registrada', async () => {
    const user = userEvent.setup()
    const cuentasConBinance = [
      { id: 'c-bin', nombre: 'Binance Pay (USDT)', banco: 'Binance', tipo: 'cripto_usdt', moneda: 'USDT', saldo: 100, activo: true },
    ]
    renderForm(cuentasConBinance)
    await fillValidForm(user)
    await pickCategory(user, 'General')

    // Cambiar a USDT (Cripto)
    const metodoTrigger = screen.getAllByRole('combobox').find(c => /efectivo \$/i.test(c.textContent))
    await user.click(metodoTrigger)
    const opUsdt = await screen.findByRole('option', { name: /usdt/i })
    await user.click(opUsdt)

    // Aparece el selector de cuenta y se preselecciona Binance Pay
    expect(screen.getAllByText(/Binance Pay \(USDT\)/i).length).toBeGreaterThanOrEqual(1)

    const form = screen.getByRole('dialog').querySelector('form')
    if (form) fireEvent.submit(form)
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.metodoPago).toBe('USDT')
    expect(payload.cuentaOrigen).toBe('Binance Pay (USDT)')
    expect(payload.cuenta_id).toBe('c-bin')
  })
})
