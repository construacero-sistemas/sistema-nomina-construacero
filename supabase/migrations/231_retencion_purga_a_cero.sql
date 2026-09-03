-- 231_retencion_purga_a_cero.sql
-- Permite retención de 0 meses (purga total a 0) y mejora retencion_purga
-- para que al purgar con 0 meses elimine todos los registros de auditoría,
-- asistencia, snapshots y logs de purgas anteriores, dejando las tablas en 0.

-- 1. Ampliar el CHECK de configuracion_negocio para admitir 0 meses
ALTER TABLE public.configuracion_negocio
  DROP CONSTRAINT IF EXISTS configuracion_negocio_retencion_meses_check,
  DROP CONSTRAINT IF EXISTS check_retencion_meses;

ALTER TABLE public.configuracion_negocio
  ADD CONSTRAINT configuracion_negocio_retencion_meses_check CHECK (retencion_meses BETWEEN 0 AND 36);

-- 2. Mejorar función de purga para soportar p_meses = 0 (dejar en 0)
CREATE OR REPLACE FUNCTION public.retencion_purga(
  p_cuenta_id UUID,
  p_meses INTEGER DEFAULT 0,
  p_dry_run BOOLEAN DEFAULT false,
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
  v_cutoff_ts TIMESTAMPTZ;
  v_asistencia BIGINT := 0;
  v_snapshots BIGINT := 0;
  v_auditoria BIGINT := 0;
  v_purga_log BIGINT := 0;
  v_nombre TEXT;
BEGIN
  IF p_meses = 0 THEN
    -- Purga completa a cero: cubre todo hasta este instante
    v_cutoff := (now() AT TIME ZONE 'America/Caracas')::date + 1;
    v_cutoff_ts := now() + interval '1 second';
  ELSE
    v_cutoff := (now() AT TIME ZONE 'America/Caracas')::date - (p_meses * interval '1 month');
    v_cutoff_ts := now() - (p_meses * interval '1 month');
  END IF;

  -- 1. Asistencia diaria
  SELECT count(*) INTO v_asistencia
  FROM public.registro_asistencia ra
  WHERE ra.cuenta_id = p_cuenta_id
    AND ra.fecha < v_cutoff
    AND (p_meses = 0 OR NOT EXISTS (
      SELECT 1 FROM public.nomina_periodos p
      WHERE p.cuenta_id = ra.cuenta_id
        AND p.estado IN ('abierto','cerrado')
        AND ra.fecha BETWEEN p.desde AND p.hasta
    ));

  -- 2. Snapshots de tasa
  SELECT count(*) INTO v_snapshots
  FROM public.nomina_tasas_snapshot s
  WHERE s.cuenta_id = p_cuenta_id
    AND s.fecha < v_cutoff
    AND (p_meses = 0 OR NOT EXISTS (
      SELECT 1 FROM public.nomina_periodos p
      WHERE p.cuenta_id = s.cuenta_id
        AND p.estado IN ('abierto','cerrado')
        AND p.id = s.periodo_id
    ));

  -- 3. Auditoría
  SELECT count(*) INTO v_auditoria
  FROM public.auditoria a
  WHERE a.cuenta_id = p_cuenta_id
    AND a.ts <= v_cutoff_ts;

  -- 4. Purga logs antiguos
  SELECT count(*) INTO v_purga_log
  FROM public.purga_log pl
  WHERE pl.cuenta_id = p_cuenta_id
    AND (p_meses = 0 OR pl.creado_en <= v_cutoff_ts);

  IF NOT p_dry_run THEN
    DELETE FROM public.registro_asistencia ra
    WHERE ra.cuenta_id = p_cuenta_id
      AND ra.fecha < v_cutoff
      AND (p_meses = 0 OR NOT EXISTS (
        SELECT 1 FROM public.nomina_periodos p
        WHERE p.cuenta_id = ra.cuenta_id
          AND p.estado IN ('abierto','cerrado')
          AND ra.fecha BETWEEN p.desde AND p.hasta
      ));

    DELETE FROM public.nomina_tasas_snapshot s
    WHERE s.cuenta_id = p_cuenta_id
      AND s.fecha < v_cutoff
      AND (p_meses = 0 OR NOT EXISTS (
        SELECT 1 FROM public.nomina_periodos p
        WHERE p.cuenta_id = s.cuenta_id
          AND p.estado IN ('abierto','cerrado')
          AND p.id = s.periodo_id
      ));

    DELETE FROM public.auditoria a
    WHERE a.cuenta_id = p_cuenta_id
      AND a.ts <= v_cutoff_ts;

    DELETE FROM public.purga_log pl
    WHERE pl.cuenta_id = p_cuenta_id
      AND (p_meses = 0 OR pl.creado_en <= v_cutoff_ts);
  END IF;

  -- Registrar la ejecución en purga_log para constancia
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
      'auditoria', v_auditoria,
      'purga_log', v_purga_log
    ),
    COALESCE(v_asistencia,0) + COALESCE(v_snapshots,0) + COALESCE(v_auditoria,0) + COALESCE(v_purga_log,0)
  );

  RETURN QUERY
    SELECT 'registro_asistencia'::TEXT, v_asistencia
    UNION ALL SELECT 'nomina_tasas_snapshot', v_snapshots
    UNION ALL SELECT 'auditoria', v_auditoria
    UNION ALL SELECT 'purga_log', v_purga_log;
END;
$$;

REVOKE ALL ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) TO service_role;
