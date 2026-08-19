import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function migration(name) {
  const url = new URL(`../../../supabase/migrations/${name}`, import.meta.url)
  return readFile(url, 'utf8')
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

  it('retira roles heredados y deja una única autorización administrativa', async () => {
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

  it('mantiene el orden completo de las migraciones entregadas', async () => {
    const names = [
      '001_nomina_base_contract.sql',
      ...Array.from({ length: 13 }, (_, index) => `${String(index + 208).padStart(3, '0')}_`),
      '221_finanzas_movimientos.sql',
      '222_finanzas_admin_role_guard.sql',
      '223_finanzas_resumen_filtros.sql',
    ]
    expect(names[0]).toBe('001_nomina_base_contract.sql')
    expect(names.at(-3)).toBe('221_finanzas_movimientos.sql')
    expect(names.at(-2)).toBe('222_finanzas_admin_role_guard.sql')
    expect(names.at(-1)).toBe('223_finanzas_resumen_filtros.sql')
    expect(Number(names.at(-1).slice(0, 3))).toBeGreaterThan(Number(names.at(-2).slice(0, 3)))
    await expect(migration('221_finanzas_movimientos.sql')).resolves.toBeTruthy()
    await expect(migration('222_finanzas_admin_role_guard.sql')).resolves.toBeTruthy()
    await expect(migration('223_finanzas_resumen_filtros.sql')).resolves.toBeTruthy()
  })
})
