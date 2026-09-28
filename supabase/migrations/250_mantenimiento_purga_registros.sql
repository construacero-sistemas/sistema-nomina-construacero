-- supabase/migrations/250_mantenimiento_purga_registros.sql
-- Zona de mantenimiento: purga TOTAL de registros operativos (Nómina + Finanzas)
-- a petición del jefe, con RESPALDO OBLIGATORIO previo en purga_backups.
--
-- NOTA A LA REGLA DE ORO (mig. 227): los registros contables normalmente NO se
-- borran (finanzas_movimientos solo se anula; nómina se conserva). Esta purga es
-- la excepción explícita para arrancar el sistema en limpio (dato de prueba /
-- puesta en marcha), y por eso el respaldo previo es INELUDIBLE y cada ejecución
-- queda en purga_backups + purga_log + auditoría del Worker.
--
-- NUNCA se tocan: usuarios (cuentas), clientes (empleados), configuraciones,
-- catálogos (conceptos, reglas, horarios, feriados, categorías), cuentas_custodia
-- (carteras; sus saldos se derivan de los movimientos) ni la tasa manual global
-- (nomina_tasas_snapshot con periodo_id IS NULL).

-- 1) Respaldo obligatorio de cada purga (payload = copia exacta de las filas).
CREATE TABLE IF NOT EXISTS public.purga_backups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ejecutado_por    UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ejecutado_nombre TEXT,
  modulos          TEXT[] NOT NULL,
  payload          JSONB NOT NULL,
  total_filas      BIGINT NOT NULL DEFAULT 0,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purga_backups_cuenta
  ON public.purga_backups(cuenta_id, creado_en DESC);

ALTER TABLE public.purga_backups ENABLE ROW LEVEL SECURITY;

-- El Worker lee respaldos y bitácora con el service key (el resto de roles: nada).
GRANT SELECT ON public.purga_backups TO service_role;
GRANT SELECT ON public.purga_log TO service_role;

-- 2) Previo: cuántas filas borraría cada módulo (sin tocar nada).
CREATE OR REPLACE FUNCTION public.mantenimiento_purge_preview(
  p_cuenta_id UUID,
  p_modulos TEXT[] DEFAULT ARRAY['nomina','finanzas']::TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  res JSONB := '{}'::jsonb;
  n BIGINT;
BEGIN
  IF 'finanzas' = ANY(p_modulos) THEN
    SELECT count(*) INTO n FROM public.finanzas_nomina_asignaciones WHERE cuenta_id = p_cuenta_id;
    res := res || jsonb_build_object('finanzas_nomina_asignaciones', n);
    SELECT count(*) INTO n FROM public.finanzas_operacion_contexto WHERE cuenta_id = p_cuenta_id;
    res := res || jsonb_build_object('finanzas_operacion_contexto', n);
    SELECT count(*) INTO n FROM public.finanzas_operaciones WHERE cuenta_id = p_cuenta_id;
    res := res || jsonb_build_object('finanzas_operaciones', n);
    SELECT count(*) INTO n FROM public.finanzas_movimientos WHERE cuenta_id = p_cuenta_id;
    res := res || jsonb_build_object('finanzas_movimientos', n);
    SELECT count(*) INTO n FROM public.finanzas_libro_version WHERE cuenta_id = p_cuenta_id;
    res := res || jsonb_build_object('finanzas_libro_version', n);
  END IF;
  IF 'nomina' = ANY(p_modulos) THEN
    SELECT count(*) INTO n FROM public.nomina_linea_conceptos WHERE cuenta_id = p_cuenta_id;
    res := res || jsonb_build_object('nomina_linea_conceptos', n);
    SELECT count(*) INTO n FROM public.nomina_lineas WHERE cuenta_id = p_cuenta_id;
    res := res || jsonb_build_object('nomina_lineas', n);
    SELECT count(*) INTO n FROM public.registro_asistencia WHERE cuenta_id = p_cuenta_id;
    res := res || jsonb_build_object('registro_asistencia', n);
    SELECT count(*) INTO n FROM public.nomina_tasas_snapshot WHERE cuenta_id = p_cuenta_id AND periodo_id IS NOT NULL;
    res := res || jsonb_build_object('nomina_tasas_snapshot', n);
    SELECT count(*) INTO n FROM public.nomina_periodos WHERE cuenta_id = p_cuenta_id;
    res := res || jsonb_build_object('nomina_periodos', n);
  END IF;
  RETURN res;
END $$;

-- 3) Purga atómica: respalda, borra en orden de claves foráneas y registra.
CREATE OR REPLACE FUNCTION public.mantenimiento_purgar(
  p_cuenta_id UUID,
  p_modulos TEXT[],
  p_operador_id UUID,
  p_ejecutado_nombre TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor public.usuarios%ROWTYPE;
  payload JSONB := '{}'::jsonb;
  filas JSONB;
  por_tabla JSONB := '{}'::jsonb;
  total BIGINT := 0;
  n BIGINT;
  vinculados BIGINT;
  backup_id UUID;
BEGIN
  -- Serializa con pagos/transfers y purgas de retención.
  PERFORM pg_advisory_xact_lock(250, 1);

  SELECT * INTO actor FROM public.usuarios u
   WHERE u.id = p_operador_id AND u.cuenta_id = p_cuenta_id AND u.activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador no encontrado o inactivo';
  END IF;
  -- La capacidad se deriva de la matriz única (espejo SQL, mig. 243): nunca
  -- roles literales aquí. Debe coincidir con la guarda del Worker
  -- (requireCapacidad(operador, 'gestionarUsuarios')).
  IF NOT (actor.rol = ANY(public.roles_capacidad('gestionarUsuarios'))) THEN
    RAISE EXCEPTION 'Solo los roles con capacidad gestionarUsuarios pueden purgar registros';
  END IF;
  IF p_modulos IS NULL OR COALESCE(array_length(p_modulos, 1), 0) = 0
     OR NOT (p_modulos <@ ARRAY['nomina','finanzas']::TEXT[]) THEN
    RAISE EXCEPTION 'Módulos inválidos: solo nomina y/o finanzas';
  END IF;

  -- Coherencia: nómina no se purga sola si hay pagos de nómina vinculados
  -- (finanzas_nomina_asignaciones); esos pagos pertenecen a Finanzas.
  IF 'nomina' = ANY(p_modulos) AND NOT ('finanzas' = ANY(p_modulos)) THEN
    SELECT count(*) INTO vinculados
      FROM public.finanzas_nomina_asignaciones a
      JOIN public.nomina_lineas l ON l.id = a.linea_id AND l.cuenta_id = a.cuenta_id
     WHERE a.cuenta_id = p_cuenta_id;
    IF vinculados > 0 THEN
      RAISE EXCEPTION 'Hay % pago(s) de nómina vinculados; selecciona también Finanzas', vinculados;
    END IF;
  END IF;

  -- RESPALDO PREVIO: copia exacta de cada fila que se va a borrar.
  IF 'finanzas' = ANY(p_modulos) THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.finanzas_nomina_asignaciones a WHERE a.cuenta_id = p_cuenta_id;
    payload := payload || jsonb_build_object('finanzas_nomina_asignaciones', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.finanzas_operacion_contexto a WHERE a.cuenta_id = p_cuenta_id;
    payload := payload || jsonb_build_object('finanzas_operacion_contexto', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.finanzas_operaciones a WHERE a.cuenta_id = p_cuenta_id;
    payload := payload || jsonb_build_object('finanzas_operaciones', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.finanzas_movimientos a WHERE a.cuenta_id = p_cuenta_id;
    payload := payload || jsonb_build_object('finanzas_movimientos', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.finanzas_libro_version a WHERE a.cuenta_id = p_cuenta_id;
    payload := payload || jsonb_build_object('finanzas_libro_version', filas);
  END IF;
  IF 'nomina' = ANY(p_modulos) THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.nomina_linea_conceptos a WHERE a.cuenta_id = p_cuenta_id;
    payload := payload || jsonb_build_object('nomina_linea_conceptos', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.nomina_lineas a WHERE a.cuenta_id = p_cuenta_id;
    payload := payload || jsonb_build_object('nomina_lineas', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.registro_asistencia a WHERE a.cuenta_id = p_cuenta_id;
    payload := payload || jsonb_build_object('registro_asistencia', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.nomina_tasas_snapshot a WHERE a.cuenta_id = p_cuenta_id AND a.periodo_id IS NOT NULL;
    payload := payload || jsonb_build_object('nomina_tasas_snapshot', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.nomina_periodos a WHERE a.cuenta_id = p_cuenta_id;
    payload := payload || jsonb_build_object('nomina_periodos', filas);
  END IF;

  INSERT INTO public.purga_backups (cuenta_id, ejecutado_por, ejecutado_nombre, modulos, payload)
  VALUES (p_cuenta_id, p_operador_id, p_ejecutado_nombre, p_modulos, payload)
  RETURNING id INTO backup_id;

  -- Los entrelazados contables (mig. 220/238) PROHÍBEN borrar movimientos ligados
  -- a operaciones y tocar nómina pagada/cerrada: protegen el día a día. La purga
  -- de mantenimiento es la excepción explícita (el respaldo ya quedó guardado
  -- arriba), así que se desactivan SOLO esos triggers con nombre dentro de esta
  -- transacción y se restauran antes del commit. Las claves foráneas del sistema
  -- siguen activas y el borrado las respeta (hijos antes que padres). El advisory
  -- lock (250, 1) serializa contra pagos/transferencias.
  ALTER TABLE public.finanzas_movimientos DISABLE TRIGGER finanzas_movimiento_operation_guard;
  ALTER TABLE public.finanzas_movimientos DISABLE TRIGGER finanzas_lock_statement;
  ALTER TABLE public.nomina_lineas DISABLE TRIGGER nomina_linea_operation_guard;
  ALTER TABLE public.nomina_lineas DISABLE TRIGGER nomina_lineas_lock_statement;
  ALTER TABLE public.nomina_lineas DISABLE TRIGGER nomina_linea_tenant_guard;
  ALTER TABLE public.nomina_periodos DISABLE TRIGGER nomina_periodo_operation_guard;
  ALTER TABLE public.nomina_periodos DISABLE TRIGGER nomina_periodos_lock_statement;
  ALTER TABLE public.nomina_linea_conceptos DISABLE TRIGGER nomina_linea_concepto_tenant_guard;
  ALTER TABLE public.nomina_tasas_snapshot DISABLE TRIGGER nomina_tasa_periodo_tenant_guard;
  ALTER TABLE public.registro_asistencia DISABLE TRIGGER nomina_asistencia_tenant_guard;

  -- Borrado en orden de claves foráneas (hijos antes que padres).
  IF 'finanzas' = ANY(p_modulos) THEN
    DELETE FROM public.finanzas_nomina_asignaciones WHERE cuenta_id = p_cuenta_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n; por_tabla := por_tabla || jsonb_build_object('finanzas_nomina_asignaciones', n);
    DELETE FROM public.finanzas_operacion_contexto WHERE cuenta_id = p_cuenta_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n; por_tabla := por_tabla || jsonb_build_object('finanzas_operacion_contexto', n);
    -- finanzas_movimientos.operacion_id referencia a finanzas_operaciones:
    -- los movimientos se borran ANTES que sus operaciones.
    DELETE FROM public.finanzas_movimientos WHERE cuenta_id = p_cuenta_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n; por_tabla := por_tabla || jsonb_build_object('finanzas_movimientos', n);
    DELETE FROM public.finanzas_operaciones WHERE cuenta_id = p_cuenta_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n; por_tabla := por_tabla || jsonb_build_object('finanzas_operaciones', n);
    DELETE FROM public.finanzas_libro_version WHERE cuenta_id = p_cuenta_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n; por_tabla := por_tabla || jsonb_build_object('finanzas_libro_version', n);
  END IF;
  IF 'nomina' = ANY(p_modulos) THEN
    DELETE FROM public.nomina_linea_conceptos WHERE cuenta_id = p_cuenta_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n; por_tabla := por_tabla || jsonb_build_object('nomina_linea_conceptos', n);
    DELETE FROM public.nomina_lineas WHERE cuenta_id = p_cuenta_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n; por_tabla := por_tabla || jsonb_build_object('nomina_lineas', n);
    DELETE FROM public.registro_asistencia WHERE cuenta_id = p_cuenta_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n; por_tabla := por_tabla || jsonb_build_object('registro_asistencia', n);
    -- La tasa manual global (periodo_id IS NULL) se conserva a propósito.
    DELETE FROM public.nomina_tasas_snapshot WHERE cuenta_id = p_cuenta_id AND periodo_id IS NOT NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n; por_tabla := por_tabla || jsonb_build_object('nomina_tasas_snapshot', n);
    DELETE FROM public.nomina_periodos WHERE cuenta_id = p_cuenta_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n; por_tabla := por_tabla || jsonb_build_object('nomina_periodos', n);
  END IF;

  -- Restaurar los entrelazados contables inmediatamente (misma transacción).
  ALTER TABLE public.finanzas_movimientos ENABLE TRIGGER finanzas_movimiento_operation_guard;
  ALTER TABLE public.finanzas_movimientos ENABLE TRIGGER finanzas_lock_statement;
  ALTER TABLE public.nomina_lineas ENABLE TRIGGER nomina_linea_operation_guard;
  ALTER TABLE public.nomina_lineas ENABLE TRIGGER nomina_lineas_lock_statement;
  ALTER TABLE public.nomina_lineas ENABLE TRIGGER nomina_linea_tenant_guard;
  ALTER TABLE public.nomina_periodos ENABLE TRIGGER nomina_periodo_operation_guard;
  ALTER TABLE public.nomina_periodos ENABLE TRIGGER nomina_periodos_lock_statement;
  ALTER TABLE public.nomina_linea_conceptos ENABLE TRIGGER nomina_linea_concepto_tenant_guard;
  ALTER TABLE public.nomina_tasas_snapshot ENABLE TRIGGER nomina_tasa_periodo_tenant_guard;
  ALTER TABLE public.registro_asistencia ENABLE TRIGGER nomina_asistencia_tenant_guard;

  -- Bitácora de purga (misma tabla que la retención).
  INSERT INTO public.purga_log (cuenta_id, ejecutado_por, ejecutado_nombre, disparador, dry_run, retencion_meses, cutoff, resumen, total_eliminadas)
  VALUES (p_cuenta_id, p_operador_id, p_ejecutado_nombre, 'manual', false, 0, CURRENT_DATE,
          jsonb_build_object('tipo', 'mantenimiento', 'modulos', to_jsonb(p_modulos), 'por_tabla', por_tabla, 'backup_id', backup_id),
          total);

  RETURN jsonb_build_object(
    'backup_id', backup_id,
    'total_eliminadas', total,
    'por_tabla', por_tabla,
    'modulos', to_jsonb(p_modulos)
  );
END $$;

-- Solo el Worker (service_role) puede ejecutar estas funciones.
REVOKE ALL ON FUNCTION public.mantenimiento_purge_preview(UUID, TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mantenimiento_purge_preview(UUID, TEXT[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mantenimiento_purge_preview(UUID, TEXT[]) TO service_role;

REVOKE ALL ON FUNCTION public.mantenimiento_purgar(UUID, TEXT[], UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mantenimiento_purgar(UUID, TEXT[], UUID, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mantenimiento_purgar(UUID, TEXT[], UUID, TEXT, TEXT) TO service_role;
