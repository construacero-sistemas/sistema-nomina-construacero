import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function migration(name) {
  const url = new URL(`../../../supabase/migrations/${name}`, import.meta.url)
  return readFile(url, 'utf8')
}

// Las negaciones juzgan el CÓDIGO: los comentarios citan a propósito el patrón
// anterior (rol único) para explicar el cambio.
function soloCodigo(sql) {
  return sql.split('\n').filter(linea => !linea.trimStart().startsWith('--')).join('\n')
}

describe('contrato SQL de Finanzas y autorización', () => {
  it('define libro financiero con precisión, tenant, RLS, idempotencia y resumen server-side', async () => {
    const sql = await migration('221_finanzas_movimientos.sql')

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.finanzas_categorias')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.finanzas_movimientos')
    expect(sql).toContain('monto_ves          NUMERIC(24,6) GENERATED ALWAYS AS')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_finanzas_movimiento_idempotency')
    expect(sql).toContain('ALTER TABLE public.finanzas_categorias ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE public.finanzas_movimientos ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.finanzas_resumen')
    expect(sql).toContain('p_tipo TEXT DEFAULT NULL')
    expect(sql).toContain('p_categoria TEXT DEFAULT NULL')
    expect(sql).toContain('m.estado = \'activo\'')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.finanzas_resumen')
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.finanzas_movimientos/i)
  })

  it('222 — guardia histórica de rol único (sustituida por 242 y alineada por 243)', async () => {
    const sql = await migration('222_finanzas_admin_role_guard.sql')

    expect(sql).toContain("WHERE rol <> 'administracion'")
    expect(sql).toContain('usuarios_rol_administracion_check')
    expect(sql).toContain("CHECK (rol = 'administracion') NOT VALID")
    expect(sql).toContain('nomina_single_role_guard')
    expect(sql).toContain("IF NEW.rol IS DISTINCT FROM 'administracion'")
    expect(sql).toContain("AND u.rol = 'administracion'")
    expect(sql).toContain("AND u.rol = 'administracion'\n  ORDER BY u.nombre")
    expect(sql).not.toContain('desarrollador virtual')
  })

  it('243 — el espejo SQL de roles y la resolución por capacidad sustituyen al rol único', async () => {
    const sql = await migration('243_roles_operativos_autorizacion.sql')

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.roles_capacidad')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.roles_operativos')
    for (const capacidad of ['verNomina', 'administrarNomina', 'verFinanzas', 'operarFinanzas', 'verSaldos', 'gestionarUsuarios', 'administrarSistema']) {
      expect(sql).toContain(`WHEN '${capacidad}'`)
    }
    // La resolución del rol acepta cualquier rol operativo, no un rol único.
    expect(sql).toContain('AND u.rol = ANY(public.roles_operativos())')
    expect(sql).toContain('AND u.rol = ANY(public.roles_operativos())\n  ORDER BY u.nombre')
    // Las políticas se expresan por capacidad.
    expect(sql).toContain("get_rol_actual() = ANY(public.roles_capacidad('administrarNomina'))")
    expect(sql).toContain("get_rol_actual() = ANY(public.roles_capacidad('verFinanzas'))")
    expect(sql).toContain("get_rol_actual() = ANY(public.roles_capacidad('verSaldos'))")
    expect(soloCodigo(sql)).not.toMatch(/get_rol_actual\(\) = 'administracion'/)
    // Sin bypass de "desarrollador virtual": el rol sale siempre de la fila real.
    expect(sql).not.toContain('00000000-0000-0000-0000-000000000000')
  })

  it('244 — los guardianes de actor distinguen traspaso de pagos de nómina', async () => {
    const sql = await migration('244_roles_operativos_operaciones.sql')

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.finanzas_operar')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.finanzas_asignar_custodia')
    // Misma capacidad por tipo que el servidor (CAPACIDAD_POR_TIPO).
    expect(sql).toContain("WHEN p_tipo = 'traspaso' THEN 'operarFinanzas' ELSE 'administrarNomina'")
    expect(sql).toContain("rol = ANY(public.roles_capacidad('operarFinanzas'))")
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.finanzas_operar(UUID,UUID,TEXT,TEXT,JSONB,TEXT) TO service_role')
    expect(soloCodigo(sql)).not.toMatch(/u\.rol = 'administracion'/)
  })

  it('245 — converge administracion a jefe preservando identidad y cerrando el rol antiguo', async () => {
    const sql = await migration('245_converge_administracion_to_jefe.sql')
    expect(sql).toContain("UPDATE public.usuarios")
    expect(sql).toContain("SET rol = 'jefe'")
    expect(sql).toContain("WHERE rol = 'administracion'")
    expect(sql).toContain("CREATE TEMP TABLE _admin_to_jefe")
    expect(sql).toContain('ROL_CONVERGENCIA_ADMINISTRACION_A_JEFE')
    expect(sql).toContain("HAVING count(*) > 2")
    expect(sql).toContain("WHEN 'verSaldos'          THEN ARRAY['desarrollador', 'jefe']")
    expect(sql).toContain("WHEN 'gestionarUsuarios'  THEN ARRAY['desarrollador', 'jefe']")
    expect(sql).toContain("ADD CONSTRAINT usuarios_rol_check CHECK")
    expect(sql).toContain("'jefe', 'finanzas', 'nomina'")
    const code = soloCodigo(sql)
    expect(code).not.toContain("WHEN 'verSaldos'          THEN ARRAY['administracion'")
    expect(code).not.toContain("WHEN 'gestionarUsuarios'  THEN ARRAY['administracion'")
  })

  it('248 — aplica comisiones POS en una transacción, con locks, tenant y guardián de capacidad', async () => {
    const sql = await migration('248_nomina_comisiones_atomicas.sql')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.nomina_aplicar_comisiones_pos')
    expect(sql).toContain('PERFORM pg_advisory_xact_lock(238, 1)')
    expect(sql).toContain("public.roles_capacidad('gestionarUsuarios')")
    expect(sql).toContain('FOR UPDATE')
    expect(sql).toContain('WHERE l.cuenta_id = p_cuenta_id AND l.periodo_id = p_periodo_id AND l.empleado_id = employee_id')
    expect(sql).toContain('INSERT INTO public.auditoria')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.nomina_aplicar_comisiones_pos')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.nomina_aplicar_comisiones_pos(UUID,UUID,UUID,JSONB,TEXT)\n  TO service_role')
  })

  it('mantiene el orden completo de las migraciones entregadas', async () => {
    const names = [
      '001_nomina_base_contract.sql',
      ...Array.from({ length: 13 }, (_, index) => `${String(index + 208).padStart(3, '0')}_`),
      '221_finanzas_movimientos.sql',
      '222_finanzas_admin_role_guard.sql',
      '223_finanzas_resumen_filtros.sql',
      '243_roles_operativos_autorizacion.sql',
      '244_roles_operativos_operaciones.sql',
      '245_converge_administracion_to_jefe.sql',
      '246_nomina_control_asistencia.sql',
      '247_nomina_horarios_unico.sql',
      '248_nomina_comisiones_atomicas.sql',
    ]
    expect(names[0]).toBe('001_nomina_base_contract.sql')
    expect(names.indexOf('243_roles_operativos_autorizacion.sql')).toBeLessThan(names.indexOf('244_roles_operativos_operaciones.sql'))
    expect(names.indexOf('244_roles_operativos_operaciones.sql')).toBeLessThan(names.indexOf('245_converge_administracion_to_jefe.sql'))
    expect(names.at(-3)).toBe('246_nomina_control_asistencia.sql')
    expect(names.at(-2)).toBe('247_nomina_horarios_unico.sql')
    expect(names.at(-1)).toBe('248_nomina_comisiones_atomicas.sql')
    expect(Number(names.at(-1).slice(0, 3))).toBeGreaterThan(Number(names.at(-2).slice(0, 3)))
    await expect(migration('221_finanzas_movimientos.sql')).resolves.toBeTruthy()
    await expect(migration('222_finanzas_admin_role_guard.sql')).resolves.toBeTruthy()
    await expect(migration('245_converge_administracion_to_jefe.sql')).resolves.toBeTruthy()
    await expect(migration('248_nomina_comisiones_atomicas.sql')).resolves.toBeTruthy()
  })
})
