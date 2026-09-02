-- 227_retencion_purga.sql
-- Sistema de retención y purga inteligente para el tier gratuito de Supabase.
--
-- Recordatorio del modelo: la base es multi-tenant (cada negocio es una cuenta_id).
-- El tier gratuito comparte ~500 MB de BD entre TODOS los tenants, así que la purga
-- es la válvula que impide el crecimiento indefinido.
--
-- REGLA DE ORO (seguridad contable): NUNCA se borran registros contables/legales:
--   * finanzas_movimientos  -> solo se anulan (lo garantiza la migración 221).
--   * nomina_lineas / nomina_linea_conceptos / nomina_periodos -> se conservan.
--
-- Qué SÍ se purga (datos derivados de alto volumen), SOLO si quedan fuera del rango
-- de un período abierto/cerrado (que podría recalcularse o reabrirse):
--   * registro_asistencia   (1 fila por empleado por día -> el mayor volumen)
--   * nomina_tasas_snapshot (snapshots de conversión históricos)
--   * auditoria             (logs de auditoría antiguos, puro bitácora)

-- 1) Ventana de retención por negocio (meses), en la configuración existente.
ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS retencion_meses INTEGER NOT NULL DEFAULT 3
  CHECK (retencion_meses BETWEEN 1 AND 36);

-- 2) Bitácora de cada ejecución de purga (auditable y trazable).
CREATE TABLE IF NOT EXISTS public.purga_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ejecutado_por   UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ejecutado_nombre TEXT,
  disparador      TEXT NOT NULL CHECK (disparador IN ('manual','cron')),
  dry_run         BOOLEAN NOT NULL DEFAULT false,
  retencion_meses INTEGER NOT NULL,
  cutoff          DATE NOT NULL,
  resumen         JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_eliminadas BIGINT NOT NULL DEFAULT 0,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purga_log_cuenta_ts
  ON public.purga_log(cuenta_id, creado_en DESC);

ALTER TABLE public.purga_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purga_log_tenant_restrictive ON public.purga_log;
CREATE POLICY purga_log_tenant_restrictive ON public.purga_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());
DROP POLICY IF EXISTS purga_log_admin_all ON public.purga_log;
CREATE POLICY purga_log_admin_all ON public.purga_log
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion','jefe','desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion','jefe','desarrollador'));

-- 3) Función de purga. Ejecuta en servidor (sin descargar filas al Worker -> cero egress).
--    p_dry_run = true  -> devuelve conteos sin borrar nada (modo "simulación").
--    p_dry_run = false -> borra y devuelve los conteos reales.
-- Devuelve (tabla, eliminadas) y es idempotente: cada llamada se registra en purga_log.
CREATE OR REPLACE FUNCTION public.retencion_purga(
  p_cuenta_id UUID,
  p_meses INTEGER DEFAULT 3,
  p_dry_run BOOLEAN DEFAULT true,
  p_disparador TEXT DEFAULT 'manual',
  p_ejecutado_por UUID DEFAULT NULL,
  p_ejecutado_nombre TEXT DEFAULT NULL
)
RETURNS TABLE(tabla TEXT, eliminadas BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff DATE;
  v_asistencia BIGINT;
  v_snapshots BIGINT;
  v_auditoria BIGINT;
  v_nombre TEXT;
BEGIN
  v_cutoff := (now() AT TIME ZONE 'America/Caracas')::date - (p_meses * interval '1 month');

  -- Asistencia: SOLO fuera del rango de un período abierto o cerrado (recalculable).
  SELECT count(*) INTO v_asistencia
  FROM public.registro_asistencia ra
  WHERE ra.cuenta_id = p_cuenta_id
    AND ra.fecha < v_cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.nomina_periodos p
      WHERE p.cuenta_id = ra.cuenta_id
        AND p.estado IN ('abierto','cerrado')
        AND ra.fecha BETWEEN p.desde AND p.hasta
    );

  -- Snapshots de tasa: SOLO los sueltos (sin período abierto/cerrado que los reutilice).
  SELECT count(*) INTO v_snapshots
  FROM public.nomina_tasas_snapshot s
  WHERE s.cuenta_id = p_cuenta_id
    AND s.fecha < v_cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.nomina_periodos p
      WHERE p.cuenta_id = s.cuenta_id
        AND p.estado IN ('abierto','cerrado')
        AND p.id = s.periodo_id
    );

  -- Auditoría: puro log, se recorta por antigüedad.
  SELECT count(*) INTO v_auditoria
  FROM public.auditoria a
  WHERE a.cuenta_id = p_cuenta_id
    AND a.ts < v_cutoff;

  IF NOT p_dry_run THEN
    DELETE FROM public.registro_asistencia ra
    WHERE ra.cuenta_id = p_cuenta_id
      AND ra.fecha < v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.nomina_periodos p
        WHERE p.cuenta_id = ra.cuenta_id
          AND p.estado IN ('abierto','cerrado')
          AND ra.fecha BETWEEN p.desde AND p.hasta
      );

    DELETE FROM public.nomina_tasas_snapshot s
    WHERE s.cuenta_id = p_cuenta_id
      AND s.fecha < v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.nomina_periodos p
        WHERE p.cuenta_id = s.cuenta_id
          AND p.estado IN ('abierto','cerrado')
          AND p.id = s.periodo_id
      );

    DELETE FROM public.auditoria a
    WHERE a.cuenta_id = p_cuenta_id
      AND a.ts < v_cutoff;
  END IF;

  -- Registrar la ejecución (incluso dry-run, para trazabilidad).
  SELECT nombre INTO v_nombre FROM public.usuarios u
  WHERE u.id = COALESCE(p_ejecutado_por, '00000000-0000-0000-0000-000000000000')
    AND u.cuenta_id = p_cuenta_id
  LIMIT 1;

  INSERT INTO public.purga_log (
    cuenta_id, ejecutado_por, ejecutado_nombre, disparador, dry_run,
    retencion_meses, cutoff, resumen, total_eliminadas
  ) VALUES (
    p_cuenta_id, p_ejecutado_por, COALESCE(p_ejecutado_nombre, v_nombre), p_disparador, p_dry_run,
    p_meses, v_cutoff, jsonb_build_object(
      'registro_asistencia', v_asistencia,
      'nomina_tasas_snapshot', v_snapshots,
      'auditoria', v_auditoria
    ),
    COALESCE(v_asistencia,0) + COALESCE(v_snapshots,0) + COALESCE(v_auditoria,0)
  );

  RETURN QUERY
    SELECT 'registro_asistencia'::TEXT, v_asistencia
    UNION ALL SELECT 'nomina_tasas_snapshot', v_snapshots
    UNION ALL SELECT 'auditoria', v_auditoria;
END;
$$;

REVOKE ALL ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) IS
  'Purga datos derivados antiguos dejando intactos los registros contables. Solo el Worker (service-role) debe invocarla; el navegador no tiene permiso.';

-- 4) Purga GLOBAL para el cron: recorre todos los negocios y aplica su propia
--    ventana de retención (retencion_meses). El worker la llama con service-role.
CREATE OR REPLACE FUNCTION public.retencion_purga_todos(
  p_dry_run BOOLEAN DEFAULT true,
  p_disparador TEXT DEFAULT 'cron'
)
RETURNS TABLE(cuenta_id UUID, retencion_meses INTEGER, total_eliminadas BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_meses INTEGER;
BEGIN
  FOR r IN
    -- Cubre todos los negocios con datos de purga, tengan o no fila de configuración.
    SELECT DISTINCT cuenta_id FROM (
      SELECT cuenta_id FROM public.registro_asistencia
      UNION SELECT cuenta_id FROM public.nomina_tasas_snapshot
      UNION SELECT cuenta_id FROM public.auditoria
      UNION SELECT cuenta_id FROM public.configuracion_negocio
    ) cuentas
  LOOP
    SELECT coalesce(retencion_meses, 3) INTO v_meses
    FROM public.configuracion_negocio c
    WHERE c.cuenta_id = r.cuenta_id LIMIT 1;
    PERFORM public.retencion_purga(r.cuenta_id, v_meses, p_dry_run, p_disparador, NULL, NULL);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.retencion_purga_todos(BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retencion_purga_todos(BOOLEAN, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retencion_purga_todos(BOOLEAN, TEXT) TO service_role;

COMMENT ON FUNCTION public.retencion_purga_todos(BOOLEAN, TEXT) IS
  'Barrido de purga para el cron: aplica la ventana de retención de cada negocio. Solo service-role.';
COMMENT ON TABLE public.purga_log IS
  'Trazabilidad de cada purga (manual o cron, dry-run o real) por negocio.';
COMMENT ON COLUMN public.configuracion_negocio.retencion_meses IS
  'Ventana de retención en meses: la purga conserva este número de meses de historial operativo.';
