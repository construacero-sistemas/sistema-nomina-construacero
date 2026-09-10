// @vitest-environment jsdom
// src/components/nomina/__tests__/TabEmpleados.test.jsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TabEmpleados from '../TabEmpleados.jsx'

let mockAllConfigs = []
let mockClientes = []
const mockActualizarMutate = vi.fn().mockResolvedValue({ ok: true })

vi.mock('../../../hooks/useNomina', () => ({
  useConfigEmpleados: () => ({
    data: mockAllConfigs,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useNominaEmpleados: () => ({
    data: mockClientes,
    isLoading: false,
  }),
  useActualizarConfigEmpleado: () => ({
    mutateAsync: mockActualizarMutate,
    isPending: false,
  }),
  usePosVendedores: () => ({ data: [] }),
  useCrearConfigEmpleado: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../../hooks/useMonedaNomina.js', () => ({
  default: () => ({
    fmtBs: (val) => `Bs. ${val}`,
    shortLabelTasa: 'BCV',
  }),
}))

vi.mock('../RateSelector.jsx', () => ({
  default: () => <div data-testid="rate-selector">RateSelector</div>,
}))

describe('TabEmpleados — Alerta de configuración y Bajas', () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  function renderTab(esAdmin = true) {
    return render(
      <QueryClientProvider client={qc}>
        <TabEmpleados esAdmin={esAdmin} />
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    qc.clear()
  })

  it('no muestra alerta sin configurar cuando todos los empleados (activos o bajas) tienen config', () => {
    mockClientes = [
      { id: 'emp-1', nombre: 'Alejandra Hidalgo', tipo_cliente: 'personal', activo: true },
      { id: 'emp-2', nombre: 'Edgar Ramirez', tipo_cliente: 'personal', activo: true },
      { id: 'emp-3', nombre: 'Jose Chofer', tipo_cliente: 'personal', activo: true },
      { id: 'emp-4', nombre: 'Luis Ramírez', tipo_cliente: 'personal', activo: true },
    ]

    mockAllConfigs = [
      { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Admin', salario_dia_usd: 15, horas_jornada: 8, activo: true, empleado: mockClientes[0] },
      { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Vendedor', salario_dia_usd: 10, horas_jornada: 8, activo: true, empleado: mockClientes[1] },
      { id: 'cfg-3', empleado_id: 'emp-3', cargo: 'Chofer', salario_dia_usd: 12, horas_jornada: 8, activo: false, empleado: mockClientes[2] }, // Baja
      { id: 'cfg-4', empleado_id: 'emp-4', cargo: 'Ventas', salario_dia_usd: 10, horas_jornada: 8, activo: false, empleado: mockClientes[3] }, // Baja
    ]

    renderTab(true)

    // La alerta no debe existir
    expect(screen.queryByText(/sin configurar en nómina/i)).toBeNull()

    // El botón de bajas debe mostrar la cantidad correcta (2)
    const btnBajas = screen.getByRole('button', { name: /Bajas \(2\)/i })
    expect(btnBajas).toBeTruthy()

    // Conteo de activos es 2
    expect(screen.getByText('Todos (2)')).toBeTruthy()
  })

  it('muestra la alerta de sin configurar únicamente si hay personal en clientes sin ninguna config', () => {
    mockClientes = [
      { id: 'emp-1', nombre: 'Alejandra Hidalgo', tipo_cliente: 'personal', activo: true },
      { id: 'emp-2', nombre: 'Nuevo Trabajador', tipo_cliente: 'personal', activo: true },
    ]

    mockAllConfigs = [
      { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Admin', salario_dia_usd: 15, horas_jornada: 8, activo: true, empleado: mockClientes[0] },
    ]

    renderTab(true)

    // Debe mostrar la alerta con 1 trabajador sin configurar
    expect(screen.getByText(/trabajador sin configurar en nómina/i)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Configurar/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('al hacer clic en Bajas (N) muestra las tarjetas de empleados dados de baja con opción de reactivar', async () => {
    mockClientes = [
      { id: 'emp-1', nombre: 'Alejandra Hidalgo', tipo_cliente: 'personal', activo: true },
      { id: 'emp-2', nombre: 'Jose Chofer', tipo_cliente: 'personal', activo: true },
    ]

    mockAllConfigs = [
      { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Admin', salario_dia_usd: 15, horas_jornada: 8, activo: true, empleado: mockClientes[0] },
      { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Chofer', salario_dia_usd: 12, horas_jornada: 8, activo: false, empleado: mockClientes[1] },
    ]

    renderTab(true)

    const btnBajas = screen.getByRole('button', { name: /Bajas \(1\)/i })
    fireEvent.click(btnBajas)

    // Debe mostrar el badge de "Dado de baja" y botón Reactivar
    expect(screen.getByText('Dado de baja')).toBeTruthy()
    const btnReactivar = screen.getByRole('button', { name: /Reactivar/i })
    expect(btnReactivar).toBeTruthy()

    fireEvent.click(btnReactivar)
    expect(mockActualizarMutate).toHaveBeenCalledWith({ id: 'cfg-2', activo: true })
  })
})
