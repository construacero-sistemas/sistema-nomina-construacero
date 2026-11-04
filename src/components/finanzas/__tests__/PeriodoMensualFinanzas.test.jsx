// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import PeriodoMensualFinanzas from '../PeriodoMensualFinanzas.jsx'

const rates = { usd: 410, usdt: 450, principal: 410, nombrePrincipal: 'BCV Dólar ($)', unidadPrincipal: 'USD', tasaFallback: null, source: 'BCV', lastUpdate: '2026-10-01', stale: false }

function wallet(overrides = {}) {
  return {
    cuentaCustodiaId: 'wallet-1', nombre: 'Caja USD', moneda: 'USD', activo: true,
    saldoApertura: null, saldoAperturaUsd: null, saldoCalculado: null,
    metodoApertura: null, diferenciaApertura: null, diferenciaCierre: null,
    ...overrides,
  }
}

function renderPanel(props = {}) {
  const onOpen = vi.fn(async () => ({}))
  const onClose = vi.fn(async () => ({}))
  const onRefresh = vi.fn(async () => {})
  const utils = render(
    <PeriodoMensualFinanzas
      periodo={{ mes: '2026-10-01', estado: 'sin_apertura', cuentas: [], cuentasPendientes: [], cierreAnterior: [], ...props.periodo }}
      saldos={null}
      cuentas={props.cuentas || [{ id: 'wallet-1', nombre: 'Caja USD', moneda: 'USD', activo: true }]}
      loading={false}
      error=""
      pending={false}
      rates={props.rates || rates}
      cierrePendiente={props.cierrePendiente ?? false}
      onRefresh={onRefresh}
      onOpen={onOpen}
      onConfirmClose={onClose}
    />,
  )
  return { ...utils, onOpen, onClose, onRefresh }
}

afterEach(cleanup)

describe('PeriodoMensualFinanzas — aviso y apertura guiada', () => {
  it('muestra el aviso pre-apertura y bloquea el wizard sin tasas confirmadas', () => {
    renderPanel({ rates: { ...rates, usd: 0 } })
    expect(screen.getByRole('status')).toHaveTextContent(/todavía no está abierto/i)
    expect(screen.getByRole('button', { name: /Abrir Octubre 2026/ })).toBeDisabled()
  })

  it('el wizard congela las tasas y envía el saldo físico de cada cuenta', async () => {
    const { onOpen, onRefresh } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    // Sin paso de tasas: el wizard abre directo en cuentas y saldos (paso 1 de 2).
    expect(screen.getByText(/Cuentas y saldos/)).toBeInTheDocument()
    expect(screen.queryByText(/^1\. Tasas$/)).not.toBeInTheDocument()

    const saldoInput = screen.getByLabelText(/Saldo nuevo/)
    fireEvent.change(saldoInput, { target: { value: '250.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    // El párrafo de revisión se compara completo: React parte el texto en varios nodos.
    const revision = screen.getByText(/Tasa congelada/).closest('p')
    expect(revision).toHaveTextContent('Tasa congelada (BCV Dólar ($)): 410,00 VES/USD')
    expect(revision).toHaveTextContent('USD/VES 410,00')
    expect(revision).toHaveTextContent('USDT/VES 450,00')

    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    const call = onOpen.mock.calls[0][0]
    expect(call.accion).toBe('aperturar')
    expect(call.mesInicio).toBe('2026-10-01')
    expect(call.idempotencyKey).toBeTruthy()
    expect(call.payload.tasaUsdVes).toBe('410')
    expect(call.payload.tasaUsdtVes).toBe('450')
    expect(call.payload.cuentas).toEqual([
      { cuentaCustodiaId: 'wallet-1', metodo: 'saldo_real', saldoReal: 250.5, tasaUsdVes: '410', tasaUsdtVes: '450' },
    ])
    await vi.waitFor(() => {
      expect(onRefresh).toHaveBeenCalled()
      expect(screen.getByText(/Apertura mensual confirmada/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Confirmar apertura/ })).not.toBeInTheDocument()
  })

  it('normaliza la coma decimal del conteo físico', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    const saldoInput = screen.getByLabelText(/Saldo nuevo/)
    fireEvent.change(saldoInput, { target: { value: '1,5' } })
    expect(saldoInput).toHaveValue('1.5')
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled()
  })

  it('reutiliza la clave de idempotencia entre reintentos de la apertura', async () => {
    const { onOpen, onRefresh } = renderPanel()
    onOpen.mockRejectedValueOnce(new Error('Fallo de red transitorio'))
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    fireEvent.change(screen.getByLabelText(/Saldo nuevo/), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Fallo de red transitorio/))
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(2))
    // Misma clave: el reintento es un replay idempotente, no una operación nueva.
    expect(onOpen.mock.calls[1][0].idempotencyKey).toBe(onOpen.mock.calls[0][0].idempotencyKey)
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})

describe('PeriodoMensualFinanzas — tasa principal elegida en la cabecera', () => {
  it('muestra la tasa principal con su nombre y congela esa misma tasa en la apertura', async () => {
    const elegida = { usd: 880.12, usdt: 996.7, principal: 1100.5, nombrePrincipal: 'Tasa Manual', unidadPrincipal: 'USD', tasaFallback: null, source: 'BCV', lastUpdate: '2026-10-16', stale: false }
    const { onOpen } = renderPanel({ rates: elegida })
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    fireEvent.change(screen.getByLabelText(/Saldo nuevo/), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByText(/Tasa congelada \(Tasa Manual\)/)).toBeInTheDocument()
    expect(screen.getByText(/1\.100,50 VES\/USD/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen.mock.calls[0][0].payload.tasaUsdVes).toBe('880.12')
    expect(onOpen.mock.calls[0][0].payload.tasaUsdtVes).toBe('996.7')
  })

  it('usa la unidad de la tasa principal en la revisión (VES/EUR con BCV €)', () => {
    const eur = { ...rates, principal: 1050, nombrePrincipal: 'BCV Euro (€)', unidadPrincipal: 'EUR' }
    renderPanel({ rates: eur })
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    fireEvent.change(screen.getByLabelText(/Saldo nuevo/), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByText(/1\.050,00 VES\/EUR/)).toBeInTheDocument()
  })
})

describe('PeriodoMensualFinanzas — saldo anterior sin cierre previo', () => {
  // Primer mes del libro mensual: no existe cierre anterior, pero el libro sí
  // tiene saldo (histórico neto) y movimientos ya registrados en el mes.
  const conActividad = {
    periodo: {
      mes: '2026-10-01', estado: 'sin_apertura', cuentasPendientes: [], cierreAnterior: [],
      cuentas: [wallet({ saldoHistorico: '1000.000000', movimientosMes: '250.000000' })],
    },
  }

  it('muestra el saldo del libro al inicio del mes en vez de "No disponible"', () => {
    renderPanel(conActividad)
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    expect(screen.getByText(/Saldo anterior: 750,00 USD \(saldo del libro\)/)).toBeInTheDocument()
    expect(screen.queryByText(/No disponible/)).not.toBeInTheDocument()
  })

  it('ofrece heredar el saldo del libro solo cuando es no negativo y lo guarda como conteo', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderPanel(conActividad)
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    // Saldo del libro 750 (1000 - 250): la opción debe existir como fuente.
    await user.click(screen.getByRole('combobox', { name: /Saldo de apertura de Caja USD/ }))
    await user.click(screen.getByRole('option', { name: /Usar el saldo del libro/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByText(/Caja USD: 750,00 USD/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    // Conteo derivado = saldo heredado + movimientos del mes; el servidor deriva la misma apertura.
    expect(onOpen.mock.calls[0][0].payload.cuentas[0]).toMatchObject({ metodo: 'saldo_real', saldoReal: 1000 })
  })

  it('oculta la opción del libro cuando el saldo heredado es negativo', async () => {
    const user = userEvent.setup()
    const negativo = { periodo: { ...conActividad.periodo, cuentas: [wallet({ saldoHistorico: '100.000000', movimientosMes: '250.000000' })] } }
    renderPanel(negativo)
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    await user.click(screen.getByRole('combobox', { name: /Saldo de apertura de Caja USD/ }))
    expect(screen.queryByRole('option', { name: /Usar el saldo del libro/ })).not.toBeInTheDocument()
  })

  it('la revisión muestra la apertura neta de los movimientos del mes', async () => {
    const { onOpen } = renderPanel(conActividad)
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    fireEvent.change(screen.getByLabelText(/Saldo nuevo/), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByText(/Caja USD: 750,00 USD/)).toBeInTheDocument()
    expect(screen.getByText(/menos movimientos del mes/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen.mock.calls[0][0].payload.cuentas[0]).toMatchObject({ saldoReal: 1000, motivo: null })
  })

  it('no exige motivo frente al saldo del libro y permite arrancar el mes en 0', async () => {
    const sinMovimientos = {
      periodo: {
        mes: '2026-10-01', estado: 'sin_apertura', cuentasPendientes: [], cierreAnterior: [],
        cuentas: [wallet({ saldoHistorico: '300.000000', movimientosMes: '0' })],
      },
    }
    const { onOpen } = renderPanel(sinMovimientos)
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    fireEvent.change(screen.getByLabelText(/Saldo nuevo/), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    // Sin cierre previo el servidor no exige motivo: el wizard tampoco lo exige.
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen.mock.calls[0][0].payload.cuentas[0]).toMatchObject({ saldoReal: 0, motivo: null })
  })

  it('el descubierto (apertura en negativo) no bloquea y exige motivo', async () => {
    const { onOpen } = renderPanel(conActividad)
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    // Con 250 de movimientos en el mes, un conteo de 100 deja la apertura en -150.
    fireEvent.change(screen.getByLabelText(/Saldo nuevo/), { target: { value: '100' } })
    expect(screen.getByText(/Descubierto/)).toBeInTheDocument()
    // Regla simple 254: el descubierto se permite, no se bloquea el paso.
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/diferencia/i)
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    fireEvent.change(screen.getByLabelText(/Motivo de la diferencia/), { target: { value: 'Descubierto por caja verificada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen.mock.calls[0][0].payload.cuentas[0]).toMatchObject({ saldoReal: 100, motivo: 'Descubierto por caja verificada' })
  })
})

describe('PeriodoMensualFinanzas — motivo frente al cierre anterior', () => {
  // Con cierre previo el motivo es obligatorio ante cualquier diferencia y la
  // apertura nunca puede quedar por debajo de ese cierre (regla del servidor).
  const conCierre = {
    periodo: {
      mes: '2026-10-01', estado: 'sin_apertura', cuentasPendientes: [],
      cierreAnterior: [{ cuentaCustodiaId: 'wallet-1', moneda: 'USD', saldo: '750.000000' }],
      cuentas: [wallet({ saldoHistorico: '750.000000', movimientosMes: '0' })],
    },
  }

  it('exige motivo cuando la apertura difiere del cierre anterior', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderPanel(conCierre)
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    await user.click(screen.getByRole('combobox', { name: /Saldo de apertura de Caja USD/ }))
    await user.click(screen.getByRole('option', { name: 'Ingresar un saldo nuevo' }))
    fireEvent.change(screen.getByLabelText(/Saldo nuevo/), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    // El wizard es aria-modal: el mensaje de validación vive dentro del diálogo como alerta.
    expect(screen.getByRole('alert')).toHaveTextContent(/frente al saldo anterior/)
    expect(onOpen).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    fireEvent.change(screen.getByLabelText(/Motivo de la diferencia/), { target: { value: 'Diferencia verificada contra el libro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen.mock.calls[0][0].payload.cuentas[0]).toMatchObject({ motivo: 'Diferencia verificada contra el libro' })
  })

  it('permite aperturar por debajo del cierre anterior con motivo (faltante documentado)', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderPanel(conCierre)
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    await user.click(screen.getByRole('combobox', { name: /Saldo de apertura de Caja USD/ }))
    await user.click(screen.getByRole('option', { name: 'Ingresar un saldo nuevo' }))
    fireEvent.change(screen.getByLabelText(/Saldo nuevo/), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText(/Motivo de la diferencia/), { target: { value: 'Merma documentada en acta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    // Regla simple 254: el faltante frente al cierre anterior se permite y queda
    // registrado con su motivo (antes el servidor lo bloqueaba sin salida).
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen.mock.calls[0][0].payload.cuentas[0]).toMatchObject({ saldoReal: 500, motivo: 'Merma documentada en acta' })
  })
})

describe('PeriodoMensualFinanzas — conteo vacío no es cero', () => {
  it('no deja avanzar ni confirmar con un conteo vacío y no inventa saldos', () => {
    const { onOpen } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    // Sin escribir el conteo, "Siguiente" debe estar bloqueado.
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('la revisión marca la cuenta sin conteo en vez de mostrar 0,00 y bloquea confirmar', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderPanel({ periodo: { mes: '2026-10-01', estado: 'sin_apertura', cuentasPendientes: [], cierreAnterior: [], cuentas: [wallet({ saldoHistorico: '0', movimientosMes: '0' })] } })
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    // Forzar una fila sin conteo: cambiar a conteo físico deja el campo vacío.
    await user.click(screen.getByRole('combobox', { name: /Saldo de apertura de Caja USD/ }))
    await user.click(screen.getByRole('option', { name: 'Ingresar un saldo nuevo' }))
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('PeriodoMensualWizardModal — validación no intrusiva del conteo', () => {
  it('no marca en rojo los campos intactos; el error aparece al salir del campo', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    const saldoInput = screen.getByLabelText(/Saldo nuevo/)
    // Nada de errores antes de interactuar: el aviso vive en el pie del wizard.
    expect(screen.queryByText(/Ingresa el saldo nuevo/)).not.toBeInTheDocument()
    expect(saldoInput.className).not.toMatch(/rose/)
    fireEvent.blur(saldoInput)
    expect(screen.getByText(/Ingresa el saldo nuevo\./)).toBeInTheDocument()
    expect(saldoInput.className).toMatch(/rose/)
  })

  it('el placeholder orienta el formato del conteo en vez de parecer un valor', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    expect(screen.getByPlaceholderText('Ej.: 1.500,00')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('0.00')).not.toBeInTheDocument()
  })
})

describe('PeriodoMensualWizardModal — motivo opcional con mínimo', () => {
  it('el banner nombra el origen del saldo de referencia y exige 8 caracteres si se escribe motivo', async () => {
    const { onOpen } = renderPanel({
      periodo: {
        mes: '2026-10-01', estado: 'sin_apertura', cuentasPendientes: [], cierreAnterior: [],
        cuentas: [wallet({ saldoHistorico: '300.000000', movimientosMes: '0' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /Abrir Octubre 2026/ }))
    fireEvent.change(screen.getByLabelText(/Saldo nuevo/), { target: { value: '0' } })
    // Sin cierre previo el origen es el saldo del libro, y el banner lo dice.
    expect(screen.getByText(/frente al saldo del libro \(300,00 USD\)/)).toBeInTheDocument()
    expect(screen.getByText(/Motivo opcional/)).toBeInTheDocument()

    // Si se escribe un motivo, aunque sea opcional, mínimo 8 caracteres.
    fireEvent.change(screen.getByLabelText(/Motivo de la diferencia/), { target: { value: 'ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos 8 caracteres/)
    expect(onOpen).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    fireEvent.change(screen.getByLabelText(/Motivo de la diferencia/), { target: { value: 'Diferencia verificada en caja' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen.mock.calls[0][0].payload.cuentas[0]).toMatchObject({ saldoReal: 0, motivo: 'Diferencia verificada en caja' })
  })
})

describe('PeriodoMensualFinanzas — ventana real de cierre', () => {
  const periodoAbierto = {
    cierrePendiente: true,
    periodo: {
      mes: '2026-09-01', estado: 'abierto', cuentasPendientes: [], cierreAnterior: [],
      cuentas: [wallet({ saldoApertura: 100, saldoAperturaUsd: 100, saldoCalculado: 120, metodoApertura: 'saldo_real' })],
    },
  }

  it('sin cierre pendiente no se ofrece cerrar el mes corriente', () => {
    renderPanel({
      periodo: {
        mes: '2026-10-01', estado: 'abierto', cuentasPendientes: [], cierreAnterior: [],
        cuentas: [wallet({ saldoApertura: 100, saldoAperturaUsd: 100, saldoCalculado: 120, metodoApertura: 'saldo_real' })],
      },
    })
    expect(screen.queryByRole('button', { name: /Empezar cierre/ })).not.toBeInTheDocument()
    expect(screen.getByText(/el cierre se habilita el primer día de Noviembre 2026/)).toBeInTheDocument()
  })

  it('con cierre pendiente se ofrece cerrar el mes anterior y se explica la ventana', () => {
    renderPanel(periodoAbierto)
    expect(screen.getByRole('button', { name: /Empezar cierre/ })).toBeInTheDocument()
    expect(screen.getByText(/Septiembre 2026 está listo para cerrar/)).toBeInTheDocument()
  })
})

describe('PeriodoMensualFinanzas — asistente de cierre en 3 pasos', () => {
  const periodoAbierto = {
    cierrePendiente: true,
    periodo: {
      mes: '2026-09-01', estado: 'abierto', cuentasPendientes: [], cierreAnterior: [],
      cuentas: [wallet({ saldoApertura: 100, saldoAperturaUsd: 100, saldoCalculado: 120, movimientosMes: 20, metodoApertura: 'saldo_real' })],
    },
  }
  const empezar = () => fireEvent.click(screen.getByRole('button', { name: /Empezar cierre/ }))

  it('el conteo empieza vacío: no se puede avanzar sin una acción en cada cuenta', () => {
    const { onClose } = renderPanel(periodoAbierto)
    empezar()
    expect(screen.getByLabelText('Saldo contado de Caja USD')).toHaveValue('')
    expect(screen.getByText('0 de 1 cuenta(s) listas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"Coincide" copia el saldo del sistema y cierra sin diferencias tras revisar', async () => {
    const { onClose, onRefresh } = renderPanel(periodoAbierto)
    empezar()
    fireEvent.click(screen.getByRole('button', { name: 'Coincide' }))
    expect(screen.getByLabelText('Saldo contado de Caja USD')).toHaveValue('120')
    expect(screen.queryByLabelText(/Motivo de la diferencia/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    // Revisión: con cuánto empezó, los movimientos y con cuánto cierra; nada se envía todavía.
    expect(within(screen.getByRole('dialog')).getByText('Empezó con')).toBeInTheDocument()
    expect(screen.getByText(/ya no se podrán crear, editar ni anular/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Cerrar Septiembre 2026/ }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const call = onClose.mock.calls[0][0]
    expect(call).toMatchObject({ accion: 'cerrar', mesInicio: '2026-09-01' })
    expect(call.payload.cuentas).toEqual([
      { cuentaCustodiaId: 'wallet-1', saldoReal: 120, motivo: null, tasaUsdVes: '410', tasaUsdtVes: '450' },
    ])
    await vi.waitFor(() => expect(screen.getByText('Septiembre 2026 cerrado')).toBeInTheDocument())
    expect(onRefresh).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Descargar PDF del cierre/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir Octubre 2026' })).toBeInTheDocument()
  })

  it('una diferencia pide el motivo en el momento y lo exige (mín. 8 caracteres)', async () => {
    const { onClose } = renderPanel(periodoAbierto)
    empezar()
    fireEvent.change(screen.getByLabelText('Saldo contado de Caja USD'), { target: { value: '100' } })
    expect(screen.getByText(/Diferencia: -20,00 USD/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Motivo de la diferencia de Caja USD'), { target: { value: 'corto' } })
    expect(screen.getByText(/al menos 8 caracteres/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Motivo de la diferencia de Caja USD'), { target: { value: 'Merma documentada en acta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Cerrar Septiembre 2026/ }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onClose.mock.calls[0][0].payload.cuentas[0]).toMatchObject({ saldoReal: 100, motivo: 'Merma documentada en acta' })
  })

  it('"Cancelar" no envía nada y un fallo conserva la clave para reintentar', async () => {
    const { onClose } = renderPanel(periodoAbierto)
    empezar()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('button', { name: 'Coincide' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    onClose.mockRejectedValueOnce(new Error('Fallo de red transitorio'))
    empezar()
    fireEvent.click(screen.getByRole('button', { name: 'Coincide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Cerrar Septiembre 2026/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Fallo de red transitorio/)
    fireEvent.click(screen.getByRole('button', { name: /Cerrar Septiembre 2026/ }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(2))
    expect(onClose.mock.calls[1][0].idempotencyKey).toBe(onClose.mock.calls[0][0].idempotencyKey)
  })

  it('sin tasas del día explica por qué no se puede cerrar', () => {
    renderPanel({ ...periodoAbierto, rates: { ...rates, usd: 0 } })
    expect(screen.getByText(/Falta la tasa del día/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Empezar cierre/ })).toBeDisabled()
  })

  it('muestra el equivalente a la tasa del día: Bs en dólares y dólares en Bs', () => {
    renderPanel({
      cierrePendiente: true,
      periodo: {
        mes: '2026-09-01', estado: 'abierto', cuentasPendientes: [], cierreAnterior: [],
        cuentas: [
          wallet({ nombre: 'Cuenta Bs', moneda: 'VES', saldoApertura: 0, saldoCalculado: 82000 }),
          wallet({ cuentaCustodiaId: 'wallet-2', nombre: 'Caja $', moneda: 'USD', saldoApertura: 0, saldoCalculado: 10 }),
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /Empezar cierre/ }))
    const dialogo = within(screen.getByRole('dialog'))
    // 82.000 Bs ÷ 410 = $200; 10 USD × 410 = 4.100 Bs.
    expect(dialogo.getByText(/≈ \$200,00 USD/)).toBeInTheDocument()
    expect(dialogo.getByText(/≈ 4\.100,00 Bs/)).toBeInTheDocument()
  })
})

describe('PeriodoMensualFinanzas — tabla de control mensual', () => {
  it('con el mes sin abrir muestra solo el padrón de cuentas, sin columnas de guiones', () => {
    renderPanel({
      periodo: {
        mes: '2026-10-01', estado: 'sin_apertura', cuentasPendientes: [], cierreAnterior: [],
        cuentas: [wallet({ nombre: 'BANESCO', moneda: 'VES' }), wallet({ cuentaCustodiaId: 'wallet-2', nombre: 'ZELLE', moneda: 'USD' })],
      },
    })
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Cuenta', 'Moneda'])
    expect(screen.getByText(/Al abrir el mes verás aquí con cuánto empezó/)).toBeInTheDocument()
  })

  const cerrado = cuentas => ({ periodo: { mes: '2026-09-01', estado: 'cerrado', cuentasPendientes: [], cierreAnterior: [], cuentas } })

  it('encabezados claros y la diferencia de cierre como sub-línea', () => {
    renderPanel(cerrado([wallet({ nombre: 'Caja Bs', moneda: 'VES', saldoApertura: 5000, saldoAperturaUsd: 100, saldoCalculado: 5200, diferenciaCierre: 200 })]))
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual([
      'Cuenta', 'Moneda', 'Al empezar el mes', 'Ahora (según movimientos)',
    ])
    expect(screen.getAllByText(/Diferencia al cerrar: 200,00 VES/).length).toBe(2)
  })

  it('una sola línea de equivalente: al empezar usa el dólar fijado ese día; ahora, la tasa de hoy', () => {
    renderPanel(cerrado([wallet({ nombre: 'Caja Bs', moneda: 'VES', saldoApertura: 8200, saldoAperturaUsd: 100, saldoCalculado: 8200 })]))
    // Al empezar: $100 fijado (no se recalcula). Ahora: 8.200 ÷ 410 = $20.
    expect(screen.getAllByText('≈ $100,00').length).toBe(2)
    expect(screen.getAllByText('≈ $20,00').length).toBe(2)
    expect(screen.queryByText(/USD hoy|al abrir/)).not.toBeInTheDocument()
  })

  it('las cuentas en dólares muestran su equivalente en Bs', () => {
    renderPanel(cerrado([wallet({ saldoApertura: 100, saldoAperturaUsd: 100, saldoCalculado: 120, diferenciaCierre: 0 })]))
    // 120 USD × 410 = 49.200 Bs.
    expect(screen.getAllByText('≈ 49.200,00 Bs').length).toBe(2)
    expect(screen.getAllByText(/Diferencia al cerrar: 0,00 USD/).length).toBe(2)
  })

  it('valora el USDT de hoy con la tasa USDT/VES relativa', () => {
    renderPanel({ ...cerrado([wallet({ nombre: 'Gaby3737', moneda: 'USDT', saldoApertura: 100, saldoAperturaUsd: 90, saldoCalculado: 100 })]), rates: { ...rates, usd: 400, usdt: 440 } })
    // 100 USDT × 440 ÷ 400 = $110.
    expect(screen.getAllByText('≈ $110,00').length).toBe(2)
  })

  it('con saldo 0 no muestra equivalentes, y sin tasa no inventa el de hoy', () => {
    renderPanel(cerrado([wallet({ nombre: 'Vacía', moneda: 'VES', saldoApertura: 0, saldoAperturaUsd: 0, saldoCalculado: 0 })]))
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument()
    cleanup()
    renderPanel({ ...cerrado([wallet({ nombre: 'Caja Bs', moneda: 'VES', saldoApertura: 8200, saldoAperturaUsd: 100, saldoCalculado: 8200 })]), rates: { ...rates, usd: 0 } })
    expect(screen.getAllByText('≈ $100,00').length).toBe(2)
    expect(screen.getAllByText(/≈/).length).toBe(2)
  })
})
