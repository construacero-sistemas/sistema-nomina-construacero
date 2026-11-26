// @vitest-environment jsdom
// src/components/nomina/__tests__/TabEmpleados.test.jsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TabEmpleados from '../TabEmpleados.jsx'

let mockAllConfigs = []
let mockClientes = []
let mockAsistencia = undefined
let mockConfigNomina = undefined
const mockActualizarMutate = vi.fn().mockResolvedValue({ ok: true })
const mockEliminarMutate = vi.fn().mockResolvedValue({ ok: true })

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
  useEliminarConfigEmpleado: () => ({
    mutateAsync: mockEliminarMutate,
    isPending: false,
  }),
  usePosVendedores: () => ({ data: [] }),
  useAsistencia: () => ({ data: mockAsistencia }),
  useFeriados: () => ({ data: [] }),
  useConfigNomina: () => ({ data: mockConfigNomina }),
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

  function renderTab(esAdmin = true, puedePagarComision = true, puedeGestionarNomina = true) {
    return render(
      <QueryClientProvider client={qc}>
        <TabEmpleados
          esAdmin={esAdmin}
          puedePagarComision={puedePagarComision}
          puedeGestionarNomina={puedeGestionarNomina}
        />
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    qc.clear()
    mockAsistencia = undefined
    mockConfigNomina = undefined
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

  it('oculta Pagar Comisión al rol de nómina: pagar una comisión exige operar Finanzas en el servidor', () => {
    mockClientes = [{ id: 'emp-1', nombre: 'Niki Ramirez', tipo_cliente: 'personal', activo: true }]
    mockAllConfigs = [
      { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Vendedor', salario_dia_usd: 0, horas_jornada: 8, activo: true, empleado: mockClientes[0] },
    ]

    renderTab(true, false, true)

    expect(screen.queryByRole('button', { name: /Pagar Comisión/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Configurar/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Baja/i })).toBeTruthy()
  })

  it('oculta alta, edición, baja y el interruptor a quien no puede gestionar personal (el servidor le responde 403)', () => {
    mockClientes = [{ id: 'emp-1', nombre: 'Alejandra Hidalgo', tipo_cliente: 'personal', activo: true }]
    mockAllConfigs = [
      { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Administración', salario_dia_usd: 15, horas_jornada: 8, activo: true, empleado: mockClientes[0] },
      { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Chofer', salario_dia_usd: 12, horas_jornada: 8, activo: false, empleado: { id: 'emp-2', nombre: 'Jose Chofer', tipo_cliente: 'personal' } },
    ]

    renderTab(true, false, false)

    expect(screen.queryByRole('button', { name: /Nuevo Empleado/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Configurar/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Baja$/ })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText(/sin configurar en nómina/i)).toBeNull()

    // La lectura de la plantilla sigue disponible para ese rol.
    expect(screen.getByText('Todos (1)')).toBeTruthy()
    expect(screen.getByText('Alejandra Hidalgo')).toBeTruthy()

    // En Bajas tampoco hay acciones de escritura, pero la ficha se puede consultar.
    fireEvent.click(screen.getByRole('button', { name: /Bajas \(1\)/i }))
    expect(screen.getByText('Jose Chofer')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Reactivar/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Eliminar/i })).toBeNull()
  })

  it('no ofrece Pagar Comisión ni el filtro de vendedores: los vendedores no van en la nómina', () => {
    mockClientes = [{ id: 'emp-1', nombre: 'Niki Ramirez', tipo_cliente: 'personal', activo: true }]
    mockAllConfigs = [
      { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Vendedor', salario_dia_usd: 0, horas_jornada: 8, activo: true, empleado: mockClientes[0] },
    ]

    renderTab(true, true)

    // Aunque el operador pueda operar Finanzas, la bandera VENDEDORES_EN_NOMINA lo apaga.
    expect(screen.queryByRole('button', { name: /Pagar Comisión/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Vendedores \(/ })).toBeNull()
    expect(screen.queryByText('Vendedores (Comisión)')).toBeNull()
  })

  it('muestra en la ficha qué días trabaja cada persona y marca la semana por defecto', () => {
    mockClientes = [
      { id: 'emp-1', nombre: 'Niki Ramirez', tipo_cliente: 'personal', activo: true },
      { id: 'emp-2', nombre: 'Josue Marciales', tipo_cliente: 'personal', activo: true },
    ]
    mockAllConfigs = [
      { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Vendedor', salario_dia_usd: 0, horas_jornada: 8, activo: true, empleado: mockClientes[0], dias_laborables: [1, 2, 3, 4, 5, 6], horario_configurado: true },
      { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Vendedor', salario_dia_usd: 0, horas_jornada: 8, activo: true, empleado: mockClientes[1], dias_laborables: [1, 2, 3, 4, 5], horario_configurado: false },
    ]

    renderTab(true, true, true)

    expect(screen.getByText(/^Lun a Sáb/)).toBeTruthy()
    expect(screen.getByText(/^Lun a Vie/)).toBeTruthy()
    expect(screen.getByText('(por defecto)')).toBeTruthy()
    expect(screen.queryByText('(sin fijar)')).toBeNull()
  })

  it('la tarjeta muestra sueldo mensual, la semana con su bono, la hora extra y cómo va la semana', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-13T12:00:00'))
    try {
      mockClientes = [{ id: 'emp-1', nombre: 'Alejandra Hidalgo', tipo_cliente: 'personal', activo: true }]
      mockAllConfigs = [{ id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Administración', salario_dia_usd: 9.3333, horas_jornada: 8, hora_inicio: '08:00', hora_fin: '17:00', activo: true, empleado: mockClientes[0], dias_laborables: [1, 2, 3, 4, 5], horario_configurado: true }]
      mockConfigNomina = { nomina_monto_hora_extra_usd: 2.5, nomina_semana_inicio: 4 }
      mockAsistencia = { registros: [
        { empleado_id: 'emp-1', fecha: '2026-11-12', hora_entrada: '08:00', hora_salida: '17:00', horas_normales: 8 },
        { empleado_id: 'emp-1', fecha: '2026-11-13', es_ausencia: true },
      ] }

      renderTab(true, true, true)

      expect(screen.getByText('$280,00')).toBeTruthy()
      expect(screen.getByText('$65,33')).toBeTruthy()
      expect(screen.getByText('Sueldo $30,33 + bono $35,00')).toBeTruthy()
      expect(screen.queryByTestId('rate-selector')).toBeNull()
      expect(screen.queryByText(/^Tasa:$/)).toBeNull()
      expect(screen.getByText('$2,50')).toBeTruthy()
      expect(screen.queryByText('Tarifa / hora')).toBeNull()
      expect(screen.queryByText(/Ingreso:/)).toBeNull()
      expect(screen.getByText('4 de 5 días')).toBeTruthy()
      expect(screen.getByText('· 1 falta')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('el interruptor de Asistencia aplica el cambio directo cuando el perfil cobra por comisión', () => {
    mockClientes = [{ id: 'emp-1', nombre: 'Niki Ramirez', tipo_cliente: 'personal', activo: true }]
    mockAllConfigs = [
      { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Vendedor', salario_dia_usd: 0, horas_jornada: 8, activo: true, empleado: mockClientes[0] },
    ]

    renderTab(true, true, true)

    fireEvent.click(screen.getByRole('switch', { name: /Quitar a Niki Ramirez de la zona de Asistencia/i }))

    expect(mockActualizarMutate).toHaveBeenCalledWith({ id: 'cfg-1', controlaAsistencia: false })
  })

  it('pide confirmación antes de quitar de Asistencia a un perfil con salario fijo y no lo aplica si se cancela', () => {
    mockClientes = [{ id: 'emp-1', nombre: 'Alejandra Hidalgo', tipo_cliente: 'personal', activo: true }]
    mockAllConfigs = [
      { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Administración', salario_dia_usd: 15, horas_jornada: 8, activo: true, empleado: mockClientes[0] },
    ]

    renderTab(true, true)

    fireEvent.click(screen.getByRole('switch', { name: /Quitar a Alejandra Hidalgo de la zona de Asistencia/i }))

    // Aún no se toca nada: primero se explica que su período quedaría en $0.
    expect(mockActualizarMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/tiene un salario fijo de/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Cancelar$/i }))
    expect(mockActualizarMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('switch', { name: /Quitar a Alejandra Hidalgo de la zona de Asistencia/i }))
    fireEvent.click(screen.getByRole('button', { name: /Quitar de Asistencia/i }))
    expect(mockActualizarMutate).toHaveBeenCalledWith({ id: 'cfg-1', controlaAsistencia: false })
  })

  it('al hacer clic en Eliminar en Bajas abre el modal de confirmación y llama a eliminarConfig', async () => {
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

    // Botón eliminar debe estar presente
    const btnEliminar = screen.getByRole('button', { name: /Eliminar/i })
    expect(btnEliminar).toBeTruthy()

    // Clic en eliminar abre el modal
    fireEvent.click(btnEliminar)

    // El modal de confirmación debe mostrar el título y el botón definitivo
    expect(screen.getByText(/Eliminar trabajador definitivamente/i)).toBeTruthy()
    expect(screen.getByText(/¿Eliminar permanentemente a Jose Chofer\?/i)).toBeTruthy()

    const btnConfirmar = screen.getByRole('button', { name: /Eliminar definitivamente/i })
    fireEvent.click(btnConfirmar)

    expect(mockEliminarMutate).toHaveBeenCalledWith({
      id: 'cfg-2', incluirHistorial: false, empleadoId: 'emp-2', confirmarNombre: '',
    })
  })

  it('calcula Esta semana por exclusión sin marcajes y la oculta en perfiles sin control de asistencia', () => {
    mockClientes = [
      { id: 'emp-1', nombre: 'Alejandra Hidalgo', tipo_cliente: 'personal', activo: true },
      { id: 'emp-2', nombre: 'Vendedor Fijo', tipo_cliente: 'personal', activo: true },
    ]
    mockAllConfigs = [
      { id: 'cfg-1', empleado_id: 'emp-1', cargo: 'Admin', salario_dia_usd: 15, horas_jornada: 8, activo: true, controla_asistencia: true, dias_laborables: [1, 2, 3, 4, 5], empleado: mockClientes[0] },
      { id: 'cfg-2', empleado_id: 'emp-2', cargo: 'Ventas', salario_dia_usd: 15, horas_jornada: 8, activo: true, controla_asistencia: false, dias_laborables: [1, 2, 3, 4, 5], empleado: mockClientes[1] },
    ]
    mockAsistencia = { registros: [] }

    renderTab(true)

    expect(screen.getByText(/Esta semana:/i)).toBeTruthy()
    expect(screen.getAllByText(/Esta semana:/i)).toHaveLength(1)
  })
})
