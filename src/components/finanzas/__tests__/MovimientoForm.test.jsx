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

function renderForm(cuentas = [{ id: '10000000-0000-4000-8000-000000000001', nombre: 'Caja Efectivo $', tipo: 'efectivo_usd', moneda: 'USD', saldo: 500, saldoConfirmado: true, activo: true }]) {
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

  it('muestra una sola opción de Bolívares digitales y conserva cuenta y comprobante', async () => {
    const user = userEvent.setup()
    const cuentas = [
      { id: 'bank-1', nombre: 'Banco Venezuela', tipo: 'banco_ves', moneda: 'VES', activo: true },
      { id: 'bank-2', nombre: 'Provincial', tipo: 'banco_ves', moneda: 'VES', activo: true },
    ]
    renderForm(cuentas)
    const metodoTrigger = screen.getAllByRole('combobox').find(c => c.textContent.includes('Efectivo $'))
    await user.click(metodoTrigger)

    expect(await screen.findAllByRole('option', { name: /bolívares digitales/i })).toHaveLength(1)
    expect(screen.queryByRole('option', { name: /transferencia bancaria|pago móvil|punto de venta|banco en bolívares/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /bolívares digitales/i }))

    expect(screen.getByLabelText(/comprobante|referencia/i)).toBeInTheDocument()
    const cuentaTrigger = screen.getAllByRole('combobox').find(c => /desde qué cuenta/i.test(c.textContent))
    await user.click(cuentaTrigger)
    expect(await screen.findByRole('option', { name: /banco venezuela/i })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /provincial/i })).toBeInTheDocument()
  })

  it('atribuye a una cuenta de origen (Banesco) y permite dividir en partes', async () => {
    const user = userEvent.setup()
    const cuentasConBancos = [
      { id: 'c-ban', nombre: 'Banesco', banco: 'Banesco', tipo: 'banco_ves', moneda: 'VES', saldo: 200, activo: true },
      { id: 'c-bnc', nombre: 'BNC', banco: 'BNC', tipo: 'banco_ves', moneda: 'VES', saldo: 300, activo: true },
    ]
    const { onClose } = renderForm(cuentasConBancos)
    await fillValidForm(user)
    await pickCategory(user, 'Sueldos')

    // Elegir método bancario → aparece la cuenta de origen.
    const metodoTrigger = screen.getAllByRole('combobox').find(c => /efectivo \$/i.test(c.textContent))
    await user.click(metodoTrigger)
    const opBanco = await screen.findByRole('option', { name: /bolívares digitales/i })
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
    expect(payload.metodoPago).toBe('Bolívares digitales')
    expect(payload.cuentaOrigen).toBe('Banesco')
    expect(payload.cuentaCustodiaId).toBe('c-ban')
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
    expect(payload.cuentaCustodiaId).toBe('c-bin')
  })

  it('en efectivo la asignación de caja es automática y no renderiza el selector secundario de cuenta', async () => {
    const user = userEvent.setup()
    const cuentasConCaja = [
      { id: 'c-caja-usd', nombre: 'Caja Efectivo $', tipo: 'efectivo_usd', moneda: 'USD', saldo: 500, activo: true },
    ]
    const { onClose } = renderForm(cuentasConCaja)
    await fillValidForm(user)
    await pickCategory(user, 'General')

    // El método por defecto es Efectivo $: NO debe haber selector secundario de cuenta
    expect(screen.queryByText(/cuenta \/ billetera de origen/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/¿desde qué cuenta\?/i)).not.toBeInTheDocument()

    // Pero al enviar, se enlaza automáticamente a la caja de efectivo
    const form = screen.getByRole('dialog').querySelector('form')
    if (form) fireEvent.submit(form)
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.metodoPago).toBe('Efectivo $')
    expect(payload.cuentaOrigen).toBe('Caja Efectivo $')
    expect(payload.cuentaCustodiaId).toBe('c-caja-usd')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('invariante anti-huérfanos: sin cuenta seleccionada NO envía nada y avisa', async () => {
    const user = userEvent.setup()
    // Método bancario con DOS cuentas: el selector aparece vacío por defecto.
    const cuentasConDosBancos = [
      { id: 'c-ban-1', nombre: 'Banco Venezuela', tipo: 'banco_ves', moneda: 'VES', activo: true },
      { id: 'c-ban-2', nombre: 'Provincial', tipo: 'banco_ves', moneda: 'VES', activo: true },
    ]
    renderForm(cuentasConDosBancos)
    await fillValidForm(user)
    await pickCategory(user, 'General')

    // Cambiar a Bolívares digitales: el selector queda sin selección.
    const metodoTrigger = screen.getAllByRole('combobox').find(c => c.textContent.includes('Efectivo $'))
    await user.click(metodoTrigger)
    await user.click(await screen.findByRole('option', { name: /bolívares digitales/i }))

    const form = screen.getByRole('dialog').querySelector('form')
    if (form) fireEvent.submit(form)

    expect(await screen.findByText(/selecciona la cuenta de origen/i)).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('permite ingresar montos con coma (teclado español de iPhone) y los normaliza a número decimal', async () => {
    const user = userEvent.setup()
    const { onClose } = renderForm()
    await user.click(screen.getByRole('button', { name: /egreso/i }))
    const concepto = screen.getByPlaceholderText(/pago de flete/i)
    await user.type(concepto, 'Pago con coma decimal')
    await pickCategory(user, 'Sueldos')

    const montoInput = screen.getByPlaceholderText('0.00')
    // Simular escritura con coma (ej. 125,50)
    await user.type(montoInput, '125,50')
    expect(montoInput.value).toBe('125.50')

    const form = screen.getByRole('dialog').querySelector('form')
    if (form) fireEvent.submit(form)

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    const payload = mutateAsync.mock.calls[0][0]
    expect(payload.monto).toBe(125.5)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('permite iniciar el monto directamente con punto o coma (.5 -> 0.5)', async () => {
    const user = userEvent.setup()
    renderForm()
    const montoInput = screen.getByPlaceholderText('0.00')
    await user.type(montoInput, ',75')
    expect(montoInput.value).toBe('0.75')
  })
})
