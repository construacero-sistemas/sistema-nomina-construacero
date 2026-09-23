-- supabase/migrations/243_roles_operativos_autorizacion.sql
-- Alinea la autorización SQL con la matriz única de roles (server/lib/permissions.js).
--
-- Problemática: la migración 242 amplió el CHECK de roles y retiró el trigger de
-- rol único, pero el resto del SQL seguía exigiendo 'administracion'. Medido por
-- `npm run test:db` antes de esta migración: 31 brechas de paridad. En concreto,
--   * get_rol_actual() devolvía NULL para cualquier rol que no fuera administración,
--     así que todas las políticas RLS con get_rol_actual() IN (...) negaban a
--     jefe, finanzas y nomina (incluidas las que ya listaban 'jefe');
--   * listar_usuarios_login() solo listaba perfiles de administración, de modo que
--     los demás roles no podían ni seleccionarse al iniciar sesión;
--   * las RLS de nómina, finanzas y custodia solo admitían administración.
-- Resultado: los roles nuevos podían iniciar sesión pero la base les negaba todo.
--
-- Solución: el SQL mantiene un espejo EXACTO de la matriz en un solo lugar,
-- public.roles_capacidad(capacidad), y todas las políticas lo consultan por nombre
-- de capacidad. `scripts/check-project.mjs` compara ese espejo con
-- rolesConCapacidad() de la matriz única y falla si divergen, así que no hay dos
-- listas de roles escritas a mano: una en JS (fuente de verdad) y su espejo en SQL.
--
-- Los roles heredados (supervisor, vendedor, vendedor_sin_comision, logistica)
-- quedan FUERA de roles_operativos(): las políticas históricas '= logistica'
-- (asistencia, feriados y horarios) permanecen en la base pero son inertes porque
-- get_rol_actual() nunca devuelve un rol no operativo.
--
-- Los guardianes de actor de las RPC se alinean en la migración 244.
BEGIN;

-- ── 1. Espejo SQL de la matriz única ──────────────────────────────────────────
-- Una sola definición por capacidad. El orden de los roles no importa para las
-- políticas (= ANY), pero se mantiene el de la matriz para facilitar la lectura.
CREATE OR REPLACE FUNCTION public.roles_capacidad(p_capacidad TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_capacidad
    WHEN 'verNomina'         THEN ARRAY['administracion', 'desarrollador', 'jefe', 'nomina']
    WHEN 'administrarNomina' THEN ARRAY['administracion', 'desarrollador', 'jefe', 'nomina']
    WHEN 'verFinanzas'       THEN ARRAY['administracion', 'desarrollador', 'finanzas', 'jefe']
    WHEN 'operarFinanzas'    THEN ARRAY['administracion', 'desarrollador', 'finanzas', 'jefe']
    WHEN 'verSaldos'         THEN ARRAY['administracion', 'desarrollador', 'jefe']
    WHEN 'gestionarUsuarios' THEN ARRAY['administracion', 'desarrollador', 'jefe']
    WHEN 'administrarSistema' THEN ARRAY['administracion', 'desarrollador', 'jefe']
    ELSE ARRAY[]::TEXT[]
  END;
$$;

-- Roles con acceso operativo a algún módulo: la unión de todas las capacidades,
-- derivada (nunca escrita a mano).
CREATE OR REPLACE FUNCTION public.roles_operativos()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT DISTINCT rol FROM unnest(
      public.roles_capacidad('verNomina') || public.roles_capacidad('administrarNomina') ||
      public.roles_capacidad('verFinanzas') || public.roles_capacidad('operarFinanzas') ||
      public.roles_capacidad('verSaldos') || public.roles_capacidad('gestionarUsuarios') ||
      public.roles_capacidad('administrarSistema')) AS rol
    ORDER BY rol
  );
$$;

-- Las políticas RLS evalúan estas funciones con el rol `authenticated`.
REVOKE ALL ON FUNCTION public.roles_capacidad(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roles_capacidad(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.roles_operativos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roles_operativos() TO authenticated;
COMMENT ON FUNCTION public.roles_capacidad(TEXT) IS
  'Espejo SQL de la matriz de capacidades (server/lib/permissions.js). check:project compara ambos.';
COMMENT ON FUNCTION public.roles_operativos() IS
  'Roles con acceso a algún módulo del sistema; excluye los roles heredados del POS.';

-- ── 2. Resolución del rol: el rol real, nunca un rol único ────────────────────
-- Reemplaza la versión de la migración 222 (que devolvía 'administracion' o NULL).
-- No se reintroduce el bypass del "desarrollador virtual": el rol se lee siempre
-- de la fila activa del operador dentro de la cuenta autenticada.
CREATE OR REPLACE FUNCTION public.get_rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.rol
  FROM public.usuarios u
  WHERE u.id = public.get_operador_id()
    AND u.cuenta_id = auth.uid()
    AND u.activo = true
    AND u.rol = ANY(public.roles_operativos());
$$;

REVOKE ALL ON FUNCTION public.get_rol_actual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rol_actual() TO authenticated;
COMMENT ON FUNCTION public.get_rol_actual() IS
  'Rol operativo del operador seleccionado (matriz única). NULL si está inactivo, es de otra cuenta o tiene un rol heredado.';

-- ── 3. Selección de usuario en el login ───────────────────────────────────────
-- Antes listaba solo administración; ahora lista todos los perfiles operativos
-- activos de la cuenta. La firma y la proyección no cambian (nunca PIN ni salt).
CREATE OR REPLACE FUNCTION public.listar_usuarios_login()
RETURNS TABLE(
  id UUID,
  nombre TEXT,
  rol TEXT,
  color TEXT,
  imagen_url TEXT,
  markup_pct NUMERIC,
  es_externo BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.nombre, u.rol, u.color, NULL::TEXT, u.markup_pct, u.es_externo
  FROM public.usuarios u
  WHERE u.cuenta_id = auth.uid()
    AND u.activo = true
    AND u.rol = ANY(public.roles_operativos())
  ORDER BY u.nombre;
$$;

REVOKE ALL ON FUNCTION public.listar_usuarios_login() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_login() TO authenticated;

-- ── 4. RLS por capacidad ──────────────────────────────────────────────────────
-- Cada política se reescribe con la capacidad que le corresponde en la matriz.
-- Las políticas RESTRICTIVE de tenant de las migraciones 213/221/228 no se tocan:
-- siguen exigiéndose además de estas (AND).

-- 4.1 Nómina (administrarNomina). Antes: ('administracion','jefe','desarrollador').
DROP POLICY IF EXISTS nomina_config_admin_all ON public.nomina_config_empleado;
CREATE POLICY nomina_config_admin_all ON public.nomina_config_empleado
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')));

DROP POLICY IF EXISTS asistencia_admin_all ON public.registro_asistencia;
CREATE POLICY asistencia_admin_all ON public.registro_asistencia
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')));

DROP POLICY IF EXISTS nomina_periodos_admin_all ON public.nomina_periodos;
CREATE POLICY nomina_periodos_admin_all ON public.nomina_periodos
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')));

DROP POLICY IF EXISTS nomina_lineas_admin_all ON public.nomina_lineas;
CREATE POLICY nomina_lineas_admin_all ON public.nomina_lineas
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')));

DROP POLICY IF EXISTS nomina_feriados_admin_all ON public.nomina_feriados;
CREATE POLICY nomina_feriados_admin_all ON public.nomina_feriados
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')));

DROP POLICY IF EXISTS nomina_horarios_admin_all ON public.nomina_horarios;
CREATE POLICY nomina_horarios_admin_all ON public.nomina_horarios
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')));

DROP POLICY IF EXISTS nomina_conceptos_admin_all ON public.nomina_conceptos;
CREATE POLICY nomina_conceptos_admin_all ON public.nomina_conceptos
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')));

DROP POLICY IF EXISTS nomina_linea_conceptos_admin_all ON public.nomina_linea_conceptos;
CREATE POLICY nomina_linea_conceptos_admin_all ON public.nomina_linea_conceptos
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')));

DROP POLICY IF EXISTS nomina_reglas_legal_admin_all ON public.nomina_reglas_legal;
CREATE POLICY nomina_reglas_legal_admin_all ON public.nomina_reglas_legal
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')));

DROP POLICY IF EXISTS nomina_tasas_snapshot_admin_all ON public.nomina_tasas_snapshot;
CREATE POLICY nomina_tasas_snapshot_admin_all ON public.nomina_tasas_snapshot
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarNomina')));

-- 4.2 Finanzas (verFinanzas): el rol finanzas opera el libro y lo ve.
DROP POLICY IF EXISTS finanzas_categorias_admin_all ON public.finanzas_categorias;
CREATE POLICY finanzas_categorias_admin_all ON public.finanzas_categorias
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('verFinanzas')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('verFinanzas')));

DROP POLICY IF EXISTS finanzas_movimientos_admin_all ON public.finanzas_movimientos;
CREATE POLICY finanzas_movimientos_admin_all ON public.finanzas_movimientos
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('verFinanzas')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('verFinanzas')));

-- 4.3 Custodia y saldos (verSaldos): el rol finanzas NUNCA entra aquí.
DROP POLICY IF EXISTS cuentas_custodia_admin_all ON public.cuentas_custodia;
CREATE POLICY cuentas_custodia_admin_all ON public.cuentas_custodia
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('verSaldos')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('verSaldos')));

-- 4.4 Auditoría de purga (administrarSistema). La lista era equivalente, pero se
-- expresa por capacidad para que no pueda divergir de la matriz.
DROP POLICY IF EXISTS purga_log_admin_all ON public.purga_log;
CREATE POLICY purga_log_admin_all ON public.purga_log
  FOR ALL TO authenticated
  USING (get_rol_actual() = ANY(public.roles_capacidad('administrarSistema')))
  WITH CHECK (get_rol_actual() = ANY(public.roles_capacidad('administrarSistema')));

COMMIT;
