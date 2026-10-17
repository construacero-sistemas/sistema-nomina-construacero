// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    expect(screen.getByRole('status')).toHaveTextContent(/no está aperturado/i)
    expect(screen.getByRole('button', { name: /Iniciar apertura guiada/ })).toBeDisabled()
  })

  it('el wizard congela las tasas y envía el saldo físico de cada cuenta', async () => {
    const { onOpen, onRefresh } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    // Sin paso de tasas: el wizard abre directo en cuentas y saldos (paso 1 de 2).
    expect(screen.getByText(/Cuentas y saldos/)).toBeInTheDocument()
    expect(screen.queryByText(/^1\. Tasas$/)).not.toBeInTheDocument()

    const saldoInput = screen.getByLabelText(/Saldo contado/)
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
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    const saldoInput = screen.getByLabelText(/Saldo contado/)
    fireEvent.change(saldoInput, { target: { value: '1,5' } })
    expect(saldoInput).toHaveValue('1.5')
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled()
  })

  it('reutiliza la clave de idempotencia entre reintentos de la apertura', async () => {
    const { onOpen, onRefresh } = renderPanel()
    onOpen.mockRejectedValueOnce(new Error('Fallo de red transitorio'))
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '250' } })
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
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '250' } })
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
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '100' } })
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
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    expect(screen.getByText(/Saldo anterior: 750,00 USD \(saldo del libro\)/)).toBeInTheDocument()
    expect(screen.queryByText(/No disponible/)).not.toBeInTheDocument()
  })

  it('ofrece heredar el saldo del libro solo cuando es no negativo y lo guarda como conteo', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderPanel(conActividad)
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    // Saldo del libro 750 (1000 - 250): la opción debe existir como fuente.
    await user.click(screen.getByRole('combobox', { name: /Fuente del saldo de Caja USD/ }))
    await user.click(screen.getByRole('option', { name: 'Saldo del libro al inicio del mes' }))
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
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    await user.click(screen.getByRole('combobox', { name: /Fuente del saldo de Caja USD/ }))
    expect(screen.queryByRole('option', { name: 'Saldo del libro al inicio del mes' })).not.toBeInTheDocument()
  })

  it('la revisión muestra la apertura neta de los movimientos del mes', async () => {
    const { onOpen } = renderPanel(conActividad)
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '1000' } })
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
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    // Sin cierre previo el servidor no exige motivo: el wizard tampoco lo exige.
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen.mock.calls[0][0].payload.cuentas[0]).toMatchObject({ saldoReal: 0, motivo: null })
  })

  it('bloquea el paso si el conteo dejaría la apertura en negativo', () => {
    renderPanel(conActividad)
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    // Con 250 de movimientos en el mes, un conteo de 100 deja la apertura en -150.
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '100' } })
    expect(screen.getByText(/La apertura quedaría en negativo/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
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
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    await user.click(screen.getByRole('combobox', { name: /Fuente del saldo de Caja USD/ }))
    await user.click(screen.getByRole('option', { name: 'Conteo físico verificado' }))
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    // El wizard es aria-modal: el mensaje de validación vive dentro del diálogo como alerta.
    expect(screen.getByRole('alert')).toHaveTextContent(/frente al cierre anterior/)
    expect(onOpen).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    fireEvent.change(screen.getByLabelText(/Motivo si difiere del saldo anterior/), { target: { value: 'Diferencia verificada contra el libro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen.mock.calls[0][0].payload.cuentas[0]).toMatchObject({ motivo: 'Diferencia verificada contra el libro' })
  })

  it('no permite aperturar por debajo del cierre anterior aunque haya motivo', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderPanel(conCierre)
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    await user.click(screen.getByRole('combobox', { name: /Fuente del saldo de Caja USD/ }))
    await user.click(screen.getByRole('option', { name: 'Conteo físico verificado' }))
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText(/Motivo si difiere del saldo anterior/), { target: { value: 'Merma documentada en acta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    expect(screen.getByRole('alert')).toHaveTextContent(/no puede quedar por debajo del cierre anterior/)
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('PeriodoMensualFinanzas — conteo vacío no es cero', () => {
  it('no deja avanzar ni confirmar con un conteo vacío y no inventa saldos', () => {
    const { onOpen } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    // Sin escribir el conteo, "Siguiente" debe estar bloqueado.
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('la revisión marca la cuenta sin conteo en vez de mostrar 0,00 y bloquea confirmar', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderPanel({ periodo: { mes: '2026-10-01', estado: 'sin_apertura', cuentasPendientes: [], cierreAnterior: [], cuentas: [wallet({ saldoHistorico: '0', movimientosMes: '0' })] } })
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    // Forzar una fila sin conteo: cambiar a conteo físico deja el campo vacío.
    await user.click(screen.getByRole('combobox', { name: /Fuente del saldo de Caja USD/ }))
    await user.click(screen.getByRole('option', { name: 'Conteo físico verificado' }))
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    expect(onOpen).not.toHaveBeenCalled()
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
    expect(screen.queryByRole('button', { name: /Cerrar mes/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Conteo físico de cierre/)).not.toBeInTheDocument()
    expect(screen.getByText(/se habilita el primer día del mes siguiente/)).toBeInTheDocument()
  })

  it('con cierre pendiente se ofrece cerrar el mes anterior y se explica la ventana', () => {
    renderPanel(periodoAbierto)
    expect(screen.getByRole('button', { name: /Cerrar mes/ })).toBeInTheDocument()
    expect(screen.getByText(/Cierre pendiente de Septiembre 2026/)).toBeInTheDocument()
  })
})

describe('PeriodoMensualFinanzas — cierre con diferencias', () => {
  const periodoAbierto = {
    cierrePendiente: true,
    periodo: {
      mes: '2026-09-01', estado: 'abierto', cuentasPendientes: [], cierreAnterior: [],
      cuentas: [wallet({ saldoApertura: 100, saldoAperturaUsd: 100, saldoCalculado: 120, metodoApertura: 'saldo_real' })],
    },
  }

  it('sin motivo exige justificación y no confirma el cierre', () => {
    const { onClose } = renderPanel(periodoAbierto)
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '130' } })
    fireEvent.click(screen.getByRole('button', { name: /Cerrar mes/ }))
    expect(screen.getByRole('status')).toHaveTextContent(/Justifica con al menos 8 caracteres/)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('con motivo documentado congela el saldo contado y confirma', async () => {
    const { onClose, onRefresh } = renderPanel(periodoAbierto)
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '130' } })
    fireEvent.change(screen.getByLabelText(/Motivo de diferencia/), { target: { value: 'Conteo físico documentado' } })
    fireEvent.click(screen.getByRole('button', { name: /Cerrar mes/ }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const call = onClose.mock.calls[0][0]
    expect(call.accion).toBe('cerrar')
    expect(call.mesInicio).toBe('2026-09-01')
    expect(call.payload.cuentas).toEqual([
      { cuentaCustodiaId: 'wallet-1', saldoReal: 130, motivo: 'Conteo físico documentado', tasaUsdVes: '410', tasaUsdtVes: '450' },
    ])
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('el conteo vacío en el cierre no se convierte en cero', () => {
    const { onClose } = renderPanel(periodoAbierto)
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Cerrar mes/ }))
    expect(screen.getByRole('status')).toHaveTextContent(/un campo vacío no es cero/)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('el cierre no permite contado por debajo del saldo del libro aunque haya motivo', () => {
    const { onClose } = renderPanel(periodoAbierto)
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText(/Motivo de diferencia/), { target: { value: 'Merma documentada en acta' } })
    fireEvent.click(screen.getByRole('button', { name: /Cerrar mes/ }))
    expect(screen.getByRole('status')).toHaveTextContent(/no puede quedar por debajo del saldo del libro/)
    expect(onClose).not.toHaveBeenCalled()
  })
})
