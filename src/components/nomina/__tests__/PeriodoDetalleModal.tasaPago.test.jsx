// @vitest-environment jsdom
// src/components/nomina/__tests__/PeriodoDetalleModal.tasaPago.test.jsx
// Guardrail de tasa congelada al cerrar/pagar en el detalle simplificado (Hoja semanal):
// - Un período/línea pagado conserva su monto congelado en Bs (total_pagado_bs / tasa congelada).
// - Abierto sin cerrar, no muestra tasa activa ni conversión en vivo (se define al cerrar).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let lineasData = []
let tasasData = []

vi.mock('../../../hooks/useNomina', () => ({
  useConfigNomina: () => ({ data: undefined, isLoading: false }),
  useNominaLineas: () => ({ data: lineasData, isLoading: false, isError: false, refetch: vi.fn() }),
  useRevertirPagoLinea: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReabrirPeriodo: () => ({ mutate: vi.fn(), isPending: false }),
  useTasasPeriodo: () => ({ data: tasasData, isLoading: false }),
}))
vi.mock('../../../hooks/useHojaSemanal.js', () => ({
  default: () => ({
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    data: {
      bonoSemanal: 35,
      semanas: 1,
      filas: lineasData.map(l => ({
        lineaId: l.id,
        empleadoId: l.empleado_id || 'e1',
        nombre: l.empleado?.nombre || 'pedro perez',
        sueldoMensual: (Number(l.salario_dia_usd_snap) || 0) * 30,
        diasTrabajados: Number(l.dias_trabajados || 0),
        semana: Number(l.monto_normal_usd || 0),
        sueldoSemanal: Math.max(0, Number(l.monto_normal_usd || 0) - 35),
        bonoSemanal: Math.min(35, Number(l.monto_normal_usd || 0)),
        horasExtra: Number(l.horas_extra || 0),
        totalExtras: Number(l.monto_extra_usd || 0),
        diasDescansoTrabajados: Number(l.dias_sabado || 0) + Number(l.dias_feriado || 0),
        valorDescansoTrabajado: Number(l.monto_sabado_usd || 0) + Number(l.monto_feriado_usd || 0),
        otrosPagos: Number(l.bonos_usd || 0) + Number(l.comisiones_pos_usd || 0),
        totalACobrar: Number(l.total_bruto_usd || 0),
        descuentos: Number(l.deducciones_usd || 0),
        neto: Number(l.total_neto_usd || 0),
        pagado: Boolean(l.pagado),
        tasaPago: l.tasa_pago_usd_ves ?? null,
        totalPagadoBs: l.total_pagado_bs ?? null,
      })),
      totales: {
        empleados: lineasData.length,
        sueldoSemanal: 15,
        bonoSemanal: 35,
        horasExtra: 0,
        totalExtras: 0,
        diasDescansoTrabajados: 0,
        valorDescansoTrabajado: 0,
        otrosPagos: lineasData.reduce((s, l) => s + Number(l.bonos_usd || 0) + Number(l.comisiones_pos_usd || 0), 0),
        totalACobrar: lineasData.reduce((s, l) => s + Number(l.total_bruto_usd || 0), 0),
        descuentos: lineasData.reduce((s, l) => s + Number(l.deducciones_usd || 0), 0),
        neto: lineasData.reduce((s, l) => s + Number(l.total_neto_usd || 0), 0),
      },
    },
  }),
}))

const fmtBsMock = n => `${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`

vi.mock('../../../hooks/useMonedaNomina.js', () => ({
  default: () => ({
    aBs: n => Number(n) * 100,
    fmtBs: fmtBsMock,
    tasaActiva: 100,
    shortLabelTasa: 'BCV',
  }),
  formatBs: fmtBsMock,
  formatUsd: n => `$${n}`,
}))
vi.mock('../../../../compat/hooks/useConfigNegocio.js', () => ({
  useConfigNegocio: () => ({ data: {} }),
}))

const PeriodoDetalleModal = (await import('../PeriodoDetalleModal.jsx')).default

afterEach(() => cleanup())

function lineaBase(overrides = {}) {
  return {
    id: 'l1',
    empleado: { nombre: 'pedro perez' },
    cargo_snap: 'Obrero',
    salario_dia_usd_snap: 10,
    dias_trabajados: 5,
    dias_descanso: 2,
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

function renderModal(linea, periodoOverrides = {}, tasas = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  lineasData = [linea]
  tasasData = tasas
  return render(
    <QueryClientProvider client={qc}>
      <PeriodoDetalleModal
        periodo={{ id: 'p1', nombre: 'Semana 47-2026', estado: 'abierto', desde: '2026-09-01', hasta: '2026-09-07', ...periodoOverrides }}
        esAdmin
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('PeriodoDetalleModal — Hoja semanal y tasa congelada', () => {
  it('línea pagada: muestra el total_pagado_bs congelado, no la conversión en vivo', async () => {
    renderModal(
      lineaBase({
        pagado: true,
        total_neto_usd: 50,
        tasa_pago_usd_ves: 804.81,
        total_pagado_bs: 40240.5,
      }),
      { estado: 'pagado' },
      [{ moneda_origen: 'USD', valor: 804.81, fuente: 'MANUAL', fecha: '2026-09-07' }],
    )
    await screen.findAllByText('Pedro Perez', { exact: false })

    expect(screen.getAllByText(/40\.240,50 Bs/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/804,81 Bs\/\$ · MANUAL/).length).toBeGreaterThan(0)
    const fila = screen.getByRole('rowheader', { name: /^Pedro Perez/ }).closest('tr')
    expect(fila).toHaveTextContent('40.240,50 Bs')
    const enVivo = (5000).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    expect(fila.textContent).not.toContain(enVivo)
  })

  it('período abierto sin cerrar: no muestra selector ni Bs con tasa activa y avisa que se define al cerrar', async () => {
    renderModal(lineaBase({ pagado: false, total_neto_usd: 50 }))
    await screen.findAllByText('Pedro Perez', { exact: false })

    expect(screen.getByText(/se define al cerrar/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cambiar.*tasa/i })).toBeNull()
    expect(screen.queryByText(/Tasa de nómina/)).toBeNull()
    const enVivo = (5000).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const fila = screen.getByRole('rowheader', { name: /^Pedro Perez/ }).closest('tr')
    expect(fila).toHaveTextContent('50,00')
    expect(fila.textContent).not.toContain(`${enVivo} Bs`)
  })

  it('línea pagada sin total_pagado_bs guardado (tasa NULL): no inventa Bs con tasa activa ni rompe', async () => {
    renderModal(lineaBase({ pagado: true, tasa_pago_usd_ves: null, total_pagado_bs: null }))
    await screen.findAllByText('Pedro Perez', { exact: false })
    const enVivo = (5000).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const fila = screen.getByRole('rowheader', { name: /^Pedro Perez/ }).closest('tr')
    expect(fila).toHaveTextContent('50,00')
    expect(fila.textContent).not.toContain(`${enVivo} Bs`)
  })

  it('muestra el sueldo mensual (salario_dia × 30) bajo el nombre en la Hoja semanal', async () => {
    renderModal(lineaBase({ salario_dia_usd_snap: 10 }))
    await screen.findAllByText('Pedro Perez', { exact: false })
    expect(screen.getAllByText(/300,00 al mes/).length).toBeGreaterThan(0)
  })

  it('presenta fichas en móvil y tabla completa sin recibos individuales', async () => {
    renderModal(lineaBase({ horas_normales: 8, horas_extra: 2, monto_normal_usd: 40, total_neto_usd: 45, bonos_usd: 5 }))
    await screen.findAllByText('Pedro Perez', { exact: false })

    const listaMovil = screen.getByRole('list', { name: 'Hoja semanal por persona' })
    expect(within(listaMovil).getByText('Pedro Perez')).toBeInTheDocument()
    expect(within(listaMovil).getByText('Totales (1)')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Recibos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Todos los recibos PDF/i })).not.toBeInTheDocument()
  })

  it('no ofrece «Importar Comisiones POS» y muestra «Otros pagos» cuando un ajuste trae comisiones históricas', async () => {
    renderModal({ ...lineaBase(), comisiones_pos_usd: 12.5 })
    await screen.findAllByText('Pedro Perez', { exact: false })
    expect(screen.queryByRole('button', { name: /importar comisiones pos/i })).toBeNull()
    expect(screen.getAllByText('Otros pagos').length).toBeGreaterThan(0)
  })
})
