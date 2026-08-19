-- 222_finanzas_admin_role_guard.sql
-- Finanzas opera con un único rol: administracion.
-- Conserva los registros históricos, desactiva operadores heredados y bloquea
-- cualquier alta o cambio futuro que no sea administración.
UPDATE public.usuarios
SET activo = false, actualizado_en = now()
WHERE rol <> 'administracion';

ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_rol_administracion_check
  CHECK (rol = 'administracion') NOT VALID;

ALTER TABLE public.finanzas_movimientos
  ADD COLUMN IF NOT EXISTS anulacion_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_finanzas_anulacion_idempotency
  ON public.finanzas_movimientos(cuenta_id, anulacion_idempotency_key)
  WHERE anulacion_idempotency_key IS NOT NULL;

ALTER TABLE public.finanzas_movimientos
  DROP CONSTRAINT IF EXISTS finanzas_anulacion_key_length;
ALTER TABLE public.finanzas_movimientos
  ADD CONSTRAINT finanzas_anulacion_key_length
  CHECK (anulacion_idempotency_key IS NULL OR char_length(anulacion_idempotency_key) BETWEEN 16 AND 128);

CREATE OR REPLACE FUNCTION public.nomina_only_administration_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rol IS DISTINCT FROM 'administracion' THEN
    RAISE EXCEPTION 'Este sistema solo admite el rol administracion'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nomina_single_role_guard ON public.usuarios;
CREATE TRIGGER nomina_single_role_guard
  BEFORE INSERT OR UPDATE OF rol ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.nomina_only_administration_role();

CREATE OR REPLACE FUNCTION public.get_rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = public.get_operador_id()
      AND u.cuenta_id = auth.uid()
      AND u.activo = true
      AND u.rol = 'administracion'
  ) THEN 'administracion' ELSE NULL END;
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
    AND u.rol = 'administracion'
  ORDER BY u.nombre;
$$;

REVOKE ALL ON FUNCTION public.get_rol_actual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rol_actual() TO authenticated;
REVOKE ALL ON FUNCTION public.listar_usuarios_login() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_login() TO authenticated;

COMMENT ON FUNCTION public.nomina_only_administration_role() IS
  'Bloquea roles heredados en nuevas altas y cambios; solo administración opera este sistema.';
COMMENT ON COLUMN public.finanzas_movimientos.anulacion_idempotency_key IS
  'Clave de reintento de la anulación; evita duplicar auditoría o mutación contable.';
