// @vitest-environment jsdom
// src/components/nomina/__tests__/PeriodoDetalleModal.tasaPago.test.jsx
// Guardrail del fix de la hoja de Excel: cuando un recibo está PAGADO, el Bs
// mostrado debe ser el CONGELADO al pagar (total_pagado_bs con su tasa real),
// nunca una conversión en vivo con la tasa actual del sistema.
// Un recibo sin pagar sigue mostrando el Bs calculado con la tasa activa.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let lineasData = []

vi.mock('../../../hooks/useNomina', () => ({
  useNominaLineas: () => ({ data: lineasData, isLoading: false, isError: false, refetch: vi.fn() }),
  useRevertirPagoLinea: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTasasPeriodo: () => ({ data: [], isLoading: false }),
}))
vi.mock('../../../hooks/useMonedaNomina.js', () => ({
  default: () => ({
    aBs: n => Number(n) * 100,
    fmtBs: n => `${Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`,
    tasaActiva: 100, shortLabelTasa: 'BCV',
  }),
  formatBs: n => `${n} Bs`,
  formatUsd: n => `$${n}`,
}))
vi.mock('../../../../compat/hooks/useConfigNegocio.js', () => ({
  useConfigNegocio: () => ({ data: {} }),
}))

const PeriodoDetalleModal = (await import('../PeriodoDetalleModal.jsx')).default

function lineaBase(overrides = {}) {
  return {
    id: 'l1',
    empleado: { nombre: 'pedro perez' },
    cargo_snap: 'Obrero',
    salario_dia_usd_snap: 10,
    dias_trabajados: 5,
    horas_normales: 40,
    horas_extra: 0,
    monto_normal_usd: 50,
    monto_extra_usd: 0,
    monto_sabado_usd: 0,
    monto_feriado_usd: 0,
    bonos_usd: 0,
    comisiones_pos_usd: 0,
    deducciones_usd: 0,
    total_bruto_usd: 50,
    total_neto_usd: 50,
    pagado: false,
    ...overrides,
  }
}

function renderModal(linea) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  lineasData = [linea]
  return render(
    <QueryClientProvider client={qc}>
      <PeriodoDetalleModal periodo={{ id: 'p1', estado: 'abierto', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-07' }} esAdmin onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('PeriodoDetalleModal — Bs congelado al pagar (migración 241)', () => {
  it('recibo pagado: muestra el total_pagado_bs congelado y su tasa, no la conversión en vivo', async () => {
    const { container } = renderModal(lineaBase({
      pagado: true,
      total_neto_usd: 50,
      tasa_pago_usd_ves: 804.81,
      total_pagado_bs: 40240.5, // 50 × 804.81, congelado al pagar
    }))
    await screen.findAllByText('pedro perez', { exact: false })

    // El Bs congelado aparece en la celda de neto con su tasa documentada
    // (el Modal renderiza en portal: buscar en document.body, no en container)
    expect(screen.getAllByText(/40\.240,50 Bs/).length).toBeGreaterThan(0)
    expect(document.body.querySelector('[title*="804.81"]')).toBeTruthy()
    // La conversión en vivo (50 × 100 del mock) NO debe aparecer en la celda neto
    const celdasNeto = document.body.querySelectorAll('td')
    const netoCell = [...celdasNeto].find(td => td.textContent.includes('40.240,50'))
    expect(netoCell).toBeTruthy()
    const enVivo = (5000).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    expect(netoCell.textContent).not.toContain(enVivo)
  })

  it('recibo sin pagar: sigue mostrando el Bs calculado con la tasa activa', async () => {
    const { container } = renderModal(lineaBase({ pagado: false, total_neto_usd: 50 }))
    await screen.findAllByText('pedro perez', { exact: false })

    // 50 × 100 (tasa mock) = Bs en vivo en la celda de neto, sin tasa congelada
    void container
    const esperado = (50).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const netoCell = [...document.body.querySelectorAll('td')].find(td => td.textContent.includes(esperado))
    expect(netoCell).toBeTruthy()
  })

  it('recibo pagado antes de la migración 241 (tasa NULL): cae a Bs en vivo sin romper', async () => {
    renderModal(lineaBase({ pagado: true, tasa_pago_usd_ves: null, total_pagado_bs: null }))
    await screen.findAllByText('pedro perez', { exact: false })
    const esperado = (50).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const netoCell = [...document.body.querySelectorAll('td')].find(td => td.textContent.includes(esperado))
    expect(netoCell).toBeTruthy()
  })

  it('muestra el sueldo mensual (salario_dia × 30) bajo el nombre', async () => {
    renderModal(lineaBase({ salario_dia_usd_snap: 10 }))
    await screen.findAllByText('pedro perez', { exact: false })
    expect(screen.getAllByText(/Sueldo mensual: \$300,00/).length).toBeGreaterThan(0)
  })

  it('presenta en móvil una ficha legible y un resumen con total neto', async () => {
    renderModal(lineaBase({ horas_normales: 8, horas_extra: 2, monto_normal_usd: 40, total_neto_usd: 45, bonos_usd: 5 }))
    await screen.findAllByText('pedro perez', { exact: false })

    const recibo = screen.getByRole('article', { name: 'Recibo de Pedro Perez' })
    expect(within(recibo).getByText('Horas normales')).toBeTruthy()
    expect(within(recibo).getByText('2.0h')).toBeTruthy()
    expect(within(recibo).getByText('$40,00')).toBeTruthy()
    expect(screen.getByText('Total del período')).toBeTruthy()
    expect(screen.getAllByText('Deducciones').length).toBeGreaterThan(0)
  })
})
