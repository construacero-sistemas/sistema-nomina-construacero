-- supabase/migrations/245_converge_administracion_to_jefe.sql
-- Convergencia final: administracion deja de ser un rol operativo; jefe es el
-- único rol administrativo. Las migraciones anteriores conservan el histórico.
-- Esta migración NO recrea usuarios ni modifica PINs, IDs, estados o relaciones.

BEGIN;

-- La regla de negocio vigente permite como máximo dos jefes activos por cuenta.
-- Si al converger se excede, se aborta toda la transacción antes de modificar filas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.usuarios
    WHERE activo = true AND rol IN ('administracion', 'jefe')
    GROUP BY cuenta_id
    HAVING count(*) > 2
  ) THEN
    RAISE EXCEPTION 'No se puede converger administracion a jefe: una cuenta supera el máximo de 2 jefes activos';
  END IF;
END;
$$;

-- Inventario transaccional para auditar la conversión sin guardar secretos.
CREATE TEMP TABLE _admin_to_jefe ON COMMIT DROP AS
SELECT id, cuenta_id, nombre, rol, activo
FROM public.usuarios
WHERE rol = 'administracion';

UPDATE public.usuarios
SET rol = 'jefe', actualizado_en = now()
WHERE rol = 'administracion';

INSERT INTO public.auditoria(
  cuenta_id, usuario_id, usuario_nombre, usuario_rol, categoria, accion,
  descripcion, entidad_tipo, entidad_id, meta
)
SELECT cuenta_id, id, nombre, 'jefe', 'USUARIOS', 'ROL_CONVERGENCIA_ADMINISTRACION_A_JEFE',
  'Rol administracion convertido a jefe; credenciales e identidad preservadas',
  'usuario', id,
  jsonb_build_object('rolAnterior', 'administracion', 'rolNuevo', 'jefe', 'activo', activo)
FROM _admin_to_jefe;

-- El CHECK final no permite nuevas filas administracion, pero conserva los
-- roles heredados del POS para que la migración no cambie dominios ajenos.
ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_administracion_check;
ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_rol_check CHECK (rol IN (
    'supervisor', 'vendedor', 'vendedor_sin_comision',
    'logistica', 'desarrollador', 'jefe', 'finanzas', 'nomina'
  ));

CREATE OR REPLACE FUNCTION public.roles_capacidad(p_capacidad TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_capacidad
    WHEN 'verNomina'          THEN ARRAY['desarrollador', 'jefe', 'nomina']
    WHEN 'administrarNomina'  THEN ARRAY['desarrollador', 'jefe', 'nomina']
    WHEN 'verFinanzas'        THEN ARRAY['desarrollador', 'finanzas', 'jefe']
    WHEN 'operarFinanzas'     THEN ARRAY['desarrollador', 'finanzas', 'jefe']
    WHEN 'verSaldos'          THEN ARRAY['desarrollador', 'jefe']
    WHEN 'gestionarUsuarios'  THEN ARRAY['desarrollador', 'jefe']
    WHEN 'administrarSistema' THEN ARRAY['desarrollador', 'jefe']
    ELSE ARRAY[]::TEXT[]
  END;
$$;

CREATE OR REPLACE FUNCTION public.roles_operativos()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT DISTINCT rol
    FROM unnest(
      public.roles_capacidad('verNomina') || public.roles_capacidad('administrarNomina') ||
      public.roles_capacidad('verFinanzas') || public.roles_capacidad('operarFinanzas') ||
      public.roles_capacidad('verSaldos') || public.roles_capacidad('gestionarUsuarios') ||
      public.roles_capacidad('administrarSistema')
    ) AS rol
    ORDER BY rol
  );
$$;

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

REVOKE ALL ON FUNCTION public.roles_capacidad(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roles_capacidad(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.roles_operativos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roles_operativos() TO authenticated;
REVOKE ALL ON FUNCTION public.get_rol_actual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rol_actual() TO authenticated;
REVOKE ALL ON FUNCTION public.listar_usuarios_login() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_login() TO authenticated;

COMMENT ON CONSTRAINT usuarios_rol_check ON public.usuarios IS
  'Roles vigentes: jefe=total, finanzas=solo Finanzas sin saldos, nomina=solo Nomina. administracion fue convergido a jefe en la migracion 245.';
COMMENT ON FUNCTION public.roles_capacidad(TEXT) IS
  'Espejo SQL final de la matriz server/lib/permissions.js; administracion ya no es operativo.';

COMMIT;
