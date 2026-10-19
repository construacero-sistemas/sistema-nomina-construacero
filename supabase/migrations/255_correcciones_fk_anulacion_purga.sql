-- 255_correcciones_fk_anulacion_purga.sql
-- Cuatro correcciones de esquema (ver docs/BITACORA_PROYECTO.md):
--   F1  nomina_pagos.empleado_id pasa a ser una llave foránea REAL hacia los
--       empleados (public.clientes, mismo destino que el resto de empleado_id
--       del sistema). La tabla nomina_pagos es legada de la base viva y no
--       nace de estas migraciones, así que la corrección se aplica solo si
--       existe; queda expuesta en nomina_pagos_fk_empleado_real() para poder
--       reproducirla y verificarla.
--   F2  La descripción de la retención queda desacoplada de la descripción de
--       la purga: cada documento se define por sí mismo.
--   F4  La anulación de un movimiento exige usuario O motivo, no ambos.
--   F5  La purga conserva SOLO lo exigido (contabilidad intacta, ventana de
--       retención y períodos abiertos), elimina por orden de riesgo y reporta
--       cuánto falta (pendientes) además de lo eliminado.
-- Rollback: restaurar el CHECK de 221_finanzas_movimientos.sql, los comentarios
-- previos de 227_retencion_purga.sql y la definición original de retencion_purga.
BEGIN;

-- ── F4: la anulación exige usuario O motivo, no ambos ─────────────────────
-- El CHECK original exigía SIEMPRE motivo_anulacion al anular. Ahora exige el
-- usuario que anula O el motivo (al menos uno): quien anula siempre queda
-- registrado por el Worker, y el motivo deja de ser obligatorio.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.finanzas_movimientos'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%anulado_en%'
  LOOP
    EXECUTE format('ALTER TABLE public.finanzas_movimientos DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.finanzas_movimientos
  ADD CONSTRAINT chk_finanzas_movimientos_anulacion
  CHECK ((estado = 'activo' AND anulado_en IS NULL AND anulado_por IS NULL) OR
         (estado = 'anulado' AND anulado_en IS NOT NULL
          AND (anulado_por IS NOT NULL OR motivo_anulacion IS NOT NULL)));

COMMENT ON CONSTRAINT chk_finanzas_movimientos_anulacion ON public.finanzas_movimientos IS
  'La anulación exige usuario O motivo, no ambos: basta con el usuario que anula (anulado_por) o con el motivo (motivo_anulacion).';

-- ── F2: descripción de retención desacoplada de la descripción de purga ───
COMMENT ON COLUMN public.configuracion_negocio.retencion_meses IS
  'Ventana de retención del negocio en meses: cuántos meses de historial operativo se conserva vigente por negocio.';

COMMENT ON TABLE public.purga_log IS
  'Trazabilidad de cada ejecución de purga (manual o cron, dry-run o real) por negocio.';

-- ── F5: purga con conservación mínima, orden por riesgo y reporte ────────
DROP FUNCTION IF EXISTS public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.retencion_purga(
  p_cuenta_id UUID,
  p_meses INTEGER DEFAULT 3,
  p_dry_run BOOLEAN DEFAULT true,
  p_disparador TEXT DEFAULT 'manual',
  p_ejecutado_por UUID DEFAULT NULL,
  p_ejecutado_nombre TEXT DEFAULT NULL
)
RETURNS TABLE(tabla TEXT, eliminadas BIGINT, pendientes BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff DATE;
  v_aud_del BIGINT;  v_aud_total BIGINT;  v_aud_keep BIGINT;
  v_snap_del BIGINT; v_snap_total BIGINT; v_snap_keep BIGINT;
  v_asis_del BIGINT; v_asis_total BIGINT; v_asis_keep BIGINT;
  v_nombre TEXT;
BEGIN
  v_cutoff := (now() AT TIME ZONE 'America/Caracas')::date - (p_meses * interval '1 month');

  -- Conserva SOLO lo exigido:
  --   * los registros contables/legales (movimientos, líneas, períodos) nunca
  --     se tocan (regla de oro de la migración 221/227);
  --   * dentro de la ventana de retención (fecha >= cutoff) se conserva todo;
  --   * fuera de la ventana solo se conserva lo que un período ABIERTO necesita
  --     para recalcular la nómina. Un período cerrado ya no protege datos
  --     derivados: su nómina calculada vive en nomina_lineas y se conserva.
  --
  -- Orden de riesgo (menor a mayor): auditoria (puro log), nomina_tasas_snapshot
  -- (derivado) y registro_asistencia (el dato operativo más sensible).
  SELECT count(*), count(*) FILTER (WHERE a.ts < v_cutoff)
    INTO v_aud_total, v_aud_del
  FROM public.auditoria a WHERE a.cuenta_id = p_cuenta_id;
  v_aud_keep := v_aud_total - v_aud_del;

  SELECT count(*), count(*) FILTER (
           WHERE s.fecha < v_cutoff AND NOT EXISTS (
             SELECT 1 FROM public.nomina_periodos p
             WHERE p.cuenta_id = s.cuenta_id
               AND p.estado = 'abierto'
               AND p.id = s.periodo_id))
    INTO v_snap_total, v_snap_del
  FROM public.nomina_tasas_snapshot s WHERE s.cuenta_id = p_cuenta_id;
  v_snap_keep := v_snap_total - v_snap_del;

  SELECT count(*), count(*) FILTER (
           WHERE ra.fecha < v_cutoff AND NOT EXISTS (
             SELECT 1 FROM public.nomina_periodos p
             WHERE p.cuenta_id = ra.cuenta_id
               AND p.estado = 'abierto'
               AND ra.fecha BETWEEN p.desde AND p.hasta))
    INTO v_asis_total, v_asis_del
  FROM public.registro_asistencia ra WHERE ra.cuenta_id = p_cuenta_id;
  v_asis_keep := v_asis_total - v_asis_del;

  IF NOT p_dry_run THEN
    DELETE FROM public.auditoria a
    WHERE a.cuenta_id = p_cuenta_id AND a.ts < v_cutoff;

    DELETE FROM public.nomina_tasas_snapshot s
    WHERE s.cuenta_id = p_cuenta_id
      AND s.fecha < v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.nomina_periodos p
        WHERE p.cuenta_id = s.cuenta_id
          AND p.estado = 'abierto'
          AND p.id = s.periodo_id);

    DELETE FROM public.registro_asistencia ra
    WHERE ra.cuenta_id = p_cuenta_id
      AND ra.fecha < v_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.nomina_periodos p
        WHERE p.cuenta_id = ra.cuenta_id
          AND p.estado = 'abierto'
          AND ra.fecha BETWEEN p.desde AND p.hasta);
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
      'orden_riesgo', jsonb_build_array('auditoria', 'nomina_tasas_snapshot', 'registro_asistencia'),
      'auditoria', jsonb_build_object('eliminadas', v_aud_del, 'pendientes', v_aud_keep),
      'nomina_tasas_snapshot', jsonb_build_object('eliminadas', v_snap_del, 'pendientes', v_snap_keep),
      'registro_asistencia', jsonb_build_object('eliminadas', v_asis_del, 'pendientes', v_asis_keep)
    ),
    v_aud_del + v_snap_del + v_asis_del
  );

  -- Reporte en el mismo orden de riesgo: lo eliminado y cuánto falta
  -- (filas pendientes que se conservan: dentro de la ventana o de un período abierto).
  RETURN QUERY
    SELECT 'auditoria'::TEXT, v_aud_del, v_aud_keep
    UNION ALL SELECT 'nomina_tasas_snapshot', v_snap_del, v_snap_keep
    UNION ALL SELECT 'registro_asistencia', v_asis_del, v_asis_keep;
END;
$$;

REVOKE ALL ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) TO service_role;

-- Descripción propia de la purga (F2): se fija DESPUÉS de recrear la función
-- para que quede en el OID nuevo y no en el de la definición anterior.
COMMENT ON FUNCTION public.retencion_purga(UUID, INTEGER, BOOLEAN, TEXT, UUID, TEXT) IS
  'Elimina datos derivados antiguos (asistencia, snapshots de tasa y auditoría): conserva lo exigido (contabilidad intacta y períodos abiertos), borra por orden de riesgo y reporta eliminadas y pendientes por tabla. Solo el Worker (service-role) debe invocarla.';

-- ── F1: nomina_pagos.empleado_id → llave foránea real ─────────────────────
CREATE OR REPLACE FUNCTION public.nomina_pagos_fk_empleado_real() RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_huerfanos BIGINT := 0;
BEGIN
  IF to_regclass('public.nomina_pagos') IS NULL THEN
    RETURN 'sin tabla nomina_pagos';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.nomina_pagos'::regclass
      AND attname = 'empleado_id'
      AND NOT attisdropped
  ) THEN
    RETURN 'sin columna empleado_id';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.nomina_pagos'::regclass
      AND contype = 'f'
      AND conname = 'fk_nomina_pagos_empleado'
  ) THEN
    RETURN 'ya aplicada';
  END IF;

  -- Huérfanos: empleado_id que no existe en la tabla de empleados.
  SELECT count(*) INTO v_huerfanos
  FROM public.nomina_pagos p
  WHERE p.empleado_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = p.empleado_id);

  ALTER TABLE public.nomina_pagos
    ADD CONSTRAINT fk_nomina_pagos_empleado
    FOREIGN KEY (empleado_id) REFERENCES public.clientes(id) ON DELETE RESTRICT NOT VALID;

  CREATE INDEX IF NOT EXISTS idx_nomina_pagos_empleado
    ON public.nomina_pagos(empleado_id);

  IF v_huerfanos = 0 THEN
    ALTER TABLE public.nomina_pagos VALIDATE CONSTRAINT fk_nomina_pagos_empleado;
    RETURN 'FK real validada';
  END IF;

  -- Con huérfanos la FK queda NOT VALID: las altas nuevas ya no crean más
  -- huérfanos y el reporte dice cuántos hay que corregir a mano.
  RETURN format('FK real NOT VALID: %s empleado_id huérfanos por corregir', v_huerfanos);
END $$;

REVOKE ALL ON FUNCTION public.nomina_pagos_fk_empleado_real() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nomina_pagos_fk_empleado_real() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nomina_pagos_fk_empleado_real() TO service_role;

COMMENT ON FUNCTION public.nomina_pagos_fk_empleado_real() IS
  'Convierte nomina_pagos.empleado_id en una llave foránea real hacia public.clientes(id). Idempotente: no-op si la tabla legada no existe.';

SELECT public.nomina_pagos_fk_empleado_real();

COMMIT;
