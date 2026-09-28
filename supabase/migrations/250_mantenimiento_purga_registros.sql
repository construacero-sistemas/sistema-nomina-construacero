-- supabase/migrations/250_mantenimiento_purga_registros.sql
-- Zona de mantenimiento: purga de registros operativos (Nómina + Finanzas) a
-- petición del JEFE, con RESPALDO OBLIGATORIO previo en purga_backups.
--
-- ALCANCE:
--   * Modo TOTAL (p_desde y p_hasta en NULL): todo el histórico de los módulos
--     elegidos, igual que siempre.
--   * Modo RANGO (p_desde y/o p_hasta): solo lo que cae en el rango de fechas
--     y TODO lo que depende de ello por clave foránea (hijos antes que padres):
--       - registro_asistencia: por su `fecha`.
--       - nomina_periodos: los cuyo tramo [desde, hasta] cruza el rango; se
--         eliminan completos con sus líneas, conceptos y tasas congeladas.
--       - finanzas_movimientos: por su `fecha`.
--       - finanzas_operaciones y finanzas_nomina_asignaciones: por `creado_en`.
--       - Hijos siempre: conceptos de la línea borrada, movimientos/pagos/
--         contexto de la operación borrada y pagos que referencian un
--         movimiento o una línea borrada.
--     En modo rango NO se tocan la tasa manual global (periodo_id IS NULL) ni
--     finanzas_libro_version (contador del libro: debe seguir siendo monótono).
--
-- AUTORIZACIÓN (doble compuerta, paridad Worker ↔ SQL):
--   * Worker: requireCapacidad(operador, 'purgarRegistros') — matriz única.
--   * SQL: actor.rol ∈ public.roles_capacidad('purgarRegistros') — solo jefe.
--   La capacidad `purgarRegistros` es EXCLUSIVA del rol principal (jefe): ni el
--   rol técnico `desarrollador` purga (decisión del negocio, 2026-09-28).
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
  desde            DATE,
  hasta            DATE,
  payload          JSONB NOT NULL,
  total_filas      BIGINT NOT NULL DEFAULT 0,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La tabla ya existe en staging (sincronización previa de esta migración).
ALTER TABLE public.purga_backups ADD COLUMN IF NOT EXISTS desde DATE;
ALTER TABLE public.purga_backups ADD COLUMN IF NOT EXISTS hasta DATE;

CREATE INDEX IF NOT EXISTS idx_purga_backups_cuenta
  ON public.purga_backups(cuenta_id, creado_en DESC);

ALTER TABLE public.purga_backups ENABLE ROW LEVEL SECURITY;

-- El Worker lee respaldos y bitácora con el service key (el resto de roles: nada).
GRANT SELECT ON public.purga_backups TO service_role;
GRANT SELECT ON public.purga_log TO service_role;

-- Firmas previas de esta misma migración (la migración se re-sincroniza en
-- staging): eliminarlas para que PostgREST no resuelva llamadas ambiguas entre
-- la firma vieja y la nueva con rango de fechas.
DROP FUNCTION IF EXISTS public.mantenimiento_purge_preview(UUID, TEXT[]);
DROP FUNCTION IF EXISTS public.mantenimiento_purgar(UUID, TEXT[], UUID, TEXT, TEXT);

-- 2) Espejo SQL de la matriz única (server/lib/permissions.js): agrega la
-- capacidad `purgarRegistros` (solo jefe). Nunca se autoriza por roles
-- literales fuera de este espejo: las compuertas consultan por nombre.
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
    WHEN 'purgarRegistros'    THEN ARRAY['jefe']
    ELSE ARRAY[]::TEXT[]
  END;
$$;

REVOKE ALL ON FUNCTION public.roles_capacidad(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.roles_capacidad(TEXT) TO authenticated;

-- 3) Núcleo compartido por el previo y la purga: calcula los conjuntos objetivo
-- UNA sola vez (previo = cuenta exacta de lo que la purga borraría) y, solo con
-- p_ejecutar, respalda y borra. SECURITY DEFINER y sin grants: lo invocan las
-- dos funciones públicas de abajo, jamás un cliente.
CREATE OR REPLACE FUNCTION public.mantenimiento_purga_core(
  p_cuenta_id UUID,
  p_modulos TEXT[],
  p_desde DATE,
  p_hasta DATE,
  p_ejecutar BOOLEAN,
  p_operador_id UUID DEFAULT NULL,
  p_ejecutado_nombre TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_todo BOOLEAN := (p_desde IS NULL AND p_hasta IS NULL);
  payload JSONB := '{}'::jsonb;
  filas JSONB;
  por_tabla JSONB := '{}'::jsonb;
  total BIGINT := 0;
  n BIGINT;
  vinculados BIGINT;
  backup_id UUID;
  v_per UUID[] := '{}';
  v_lin UUID[] := '{}';
  v_conc UUID[] := '{}';
  v_asis UUID[] := '{}';
  v_tasas UUID[] := '{}';
  v_ops UUID[] := '{}';
  v_mov UUID[] := '{}';
  v_asig UUID[] := '{}';
  v_libro BOOLEAN := false;
BEGIN
  IF p_modulos IS NULL OR COALESCE(array_length(p_modulos, 1), 0) = 0
     OR NOT (p_modulos <@ ARRAY['nomina','finanzas']::TEXT[]) THEN
    RAISE EXCEPTION 'Módulos inválidos: solo nomina y/o finanzas' USING ERRCODE = 'PT400';
  END IF;
  IF p_desde IS NOT NULL AND p_hasta IS NOT NULL AND p_desde > p_hasta THEN
    RAISE EXCEPTION 'Rango de fechas inválido: desde (%) es posterior a hasta (%)', p_desde, p_hasta
      USING ERRCODE = 'PT400';
  END IF;

  -- Serializa con pagos/transferencias y purgas de retención (solo al escribir).
  IF p_ejecutar THEN
    PERFORM pg_advisory_xact_lock(250, 1);
  END IF;

  -- Conjuntos objetivo: los MISMOS para el previo y la purga. El rango se aplica
  -- a la fecha del propio registro; los hijos se arrastran por clave foránea.
  IF 'nomina' = ANY(p_modulos) THEN
    SELECT COALESCE(array_agg(p.id), '{}') INTO v_per
      FROM public.nomina_periodos p
     WHERE p.cuenta_id = p_cuenta_id
       AND (v_todo OR ((p_desde IS NULL OR p.hasta >= p_desde)
                       AND (p_hasta IS NULL OR p.desde <= p_hasta)));
    SELECT COALESCE(array_agg(l.id), '{}') INTO v_lin
      FROM public.nomina_lineas l
     WHERE l.cuenta_id = p_cuenta_id
       AND (v_todo OR l.periodo_id = ANY(v_per));
    SELECT COALESCE(array_agg(c.id), '{}') INTO v_conc
      FROM public.nomina_linea_conceptos c
     WHERE c.cuenta_id = p_cuenta_id
       AND (v_todo OR c.linea_id = ANY(v_lin));
    SELECT COALESCE(array_agg(a.id), '{}') INTO v_asis
      FROM public.registro_asistencia a
     WHERE a.cuenta_id = p_cuenta_id
       AND (v_todo OR ((p_desde IS NULL OR a.fecha >= p_desde)
                       AND (p_hasta IS NULL OR a.fecha <= p_hasta)));
    -- Tasas congeladas: solo las de los períodos que se borran (la tasa de un
    -- período vivo jamás se toca); en modo total, todas las del período.
    SELECT COALESCE(array_agg(s.id), '{}') INTO v_tasas
      FROM public.nomina_tasas_snapshot s
     WHERE s.cuenta_id = p_cuenta_id
       AND s.periodo_id IS NOT NULL
       AND (v_todo OR s.periodo_id = ANY(v_per));
  END IF;

  IF 'finanzas' = ANY(p_modulos) THEN
    SELECT COALESCE(array_agg(o.id), '{}') INTO v_ops
      FROM public.finanzas_operaciones o
     WHERE o.cuenta_id = p_cuenta_id
       AND (v_todo OR ((p_desde IS NULL OR (o.creado_en AT TIME ZONE 'America/Caracas')::date >= p_desde)
                       AND (p_hasta IS NULL OR (o.creado_en AT TIME ZONE 'America/Caracas')::date <= p_hasta)));
    SELECT COALESCE(array_agg(m.id), '{}') INTO v_mov
      FROM public.finanzas_movimientos m
     WHERE m.cuenta_id = p_cuenta_id
       AND (v_todo OR m.operacion_id = ANY(v_ops)
            OR ((p_desde IS NULL OR m.fecha >= p_desde)
                AND (p_hasta IS NULL OR m.fecha <= p_hasta)));
    -- Pagos de nómina: los del rango, los de una operación/movimiento borrado y
    -- los que apuntan a una línea borrada (aunque la línea venga del cierre de
    -- un período del rango en modo nómina+finanzas).
    SELECT COALESCE(array_agg(g.id), '{}') INTO v_asig
      FROM public.finanzas_nomina_asignaciones g
     WHERE g.cuenta_id = p_cuenta_id
       AND (v_todo OR g.operacion_id = ANY(v_ops)
            OR g.movimiento_id = ANY(v_mov)
            OR g.linea_id = ANY(v_lin)
            OR g.revertida_por_operacion_id = ANY(v_ops)
            OR ((p_desde IS NULL OR (g.creado_en AT TIME ZONE 'America/Caracas')::date >= p_desde)
                AND (p_hasta IS NULL OR (g.creado_en AT TIME ZONE 'America/Caracas')::date <= p_hasta)));
    -- La versión del libro es un contador sin fecha: solo se resetea al purgar
    -- el histórico completo, nunca en modo rango.
    v_libro := v_todo;
  END IF;

  -- Coherencia: nómina no se purga sola si hay pagos de nómina vinculados
  -- (finanzas_nomina_asignaciones); esos pagos pertenecen a Finanzas.
  IF 'nomina' = ANY(p_modulos) AND NOT ('finanzas' = ANY(p_modulos)) THEN
    SELECT count(*) INTO vinculados
      FROM public.finanzas_nomina_asignaciones a
     WHERE a.cuenta_id = p_cuenta_id
       AND (v_todo OR a.linea_id = ANY(v_lin));
    IF vinculados > 0 THEN
      RAISE EXCEPTION 'Hay % pago(s) de nómina vinculados; selecciona también Finanzas', vinculados
        USING ERRCODE = 'PT409';
    END IF;
  END IF;

  -- Conteos por tabla (los mismos del previo y de la purga ejecutada).
  IF 'finanzas' = ANY(p_modulos) THEN
    n := COALESCE(array_length(v_asig, 1), 0);
    por_tabla := por_tabla || jsonb_build_object('finanzas_nomina_asignaciones', n);
    total := total + n;
    SELECT count(*) INTO n FROM public.finanzas_operacion_contexto c
     WHERE c.cuenta_id = p_cuenta_id AND c.operacion_id = ANY(v_ops);
    por_tabla := por_tabla || jsonb_build_object('finanzas_operacion_contexto', n);
    total := total + n;
    n := COALESCE(array_length(v_mov, 1), 0);
    por_tabla := por_tabla || jsonb_build_object('finanzas_movimientos', n);
    total := total + n;
    n := COALESCE(array_length(v_ops, 1), 0);
    por_tabla := por_tabla || jsonb_build_object('finanzas_operaciones', n);
    total := total + n;
    SELECT count(*) INTO n FROM public.finanzas_libro_version v
     WHERE v.cuenta_id = p_cuenta_id AND v_libro;
    por_tabla := por_tabla || jsonb_build_object('finanzas_libro_version', n);
    total := total + n;
  END IF;
  IF 'nomina' = ANY(p_modulos) THEN
    n := COALESCE(array_length(v_conc, 1), 0);
    por_tabla := por_tabla || jsonb_build_object('nomina_linea_conceptos', n);
    total := total + n;
    n := COALESCE(array_length(v_lin, 1), 0);
    por_tabla := por_tabla || jsonb_build_object('nomina_lineas', n);
    total := total + n;
    n := COALESCE(array_length(v_asis, 1), 0);
    por_tabla := por_tabla || jsonb_build_object('registro_asistencia', n);
    total := total + n;
    n := COALESCE(array_length(v_tasas, 1), 0);
    por_tabla := por_tabla || jsonb_build_object('nomina_tasas_snapshot', n);
    total := total + n;
    n := COALESCE(array_length(v_per, 1), 0);
    por_tabla := por_tabla || jsonb_build_object('nomina_periodos', n);
    total := total + n;
  END IF;

  IF NOT p_ejecutar THEN
    RETURN jsonb_build_object(
      'total_eliminadas', total, 'por_tabla', por_tabla,
      'modulos', to_jsonb(p_modulos),
      'rango', jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
    );
  END IF;

  -- RESPALDO PREVIO: copia exacta de cada fila que se va a borrar.
  IF 'finanzas' = ANY(p_modulos) THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.finanzas_nomina_asignaciones a WHERE a.id = ANY(v_asig);
    payload := payload || jsonb_build_object('finanzas_nomina_asignaciones', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.finanzas_operacion_contexto a
     WHERE a.cuenta_id = p_cuenta_id AND a.operacion_id = ANY(v_ops);
    payload := payload || jsonb_build_object('finanzas_operacion_contexto', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.finanzas_movimientos a WHERE a.id = ANY(v_mov);
    payload := payload || jsonb_build_object('finanzas_movimientos', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.finanzas_operaciones a WHERE a.id = ANY(v_ops);
    payload := payload || jsonb_build_object('finanzas_operaciones', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.finanzas_libro_version a WHERE a.cuenta_id = p_cuenta_id AND v_libro;
    payload := payload || jsonb_build_object('finanzas_libro_version', filas);
  END IF;
  IF 'nomina' = ANY(p_modulos) THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.nomina_linea_conceptos a WHERE a.id = ANY(v_conc);
    payload := payload || jsonb_build_object('nomina_linea_conceptos', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.nomina_lineas a WHERE a.id = ANY(v_lin);
    payload := payload || jsonb_build_object('nomina_lineas', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.registro_asistencia a WHERE a.id = ANY(v_asis);
    payload := payload || jsonb_build_object('registro_asistencia', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.nomina_tasas_snapshot a WHERE a.id = ANY(v_tasas);
    payload := payload || jsonb_build_object('nomina_tasas_snapshot', filas);
    SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO filas
      FROM public.nomina_periodos a WHERE a.id = ANY(v_per);
    payload := payload || jsonb_build_object('nomina_periodos', filas);
  END IF;

  INSERT INTO public.purga_backups (cuenta_id, ejecutado_por, ejecutado_nombre, modulos, desde, hasta, payload, total_filas)
  VALUES (p_cuenta_id, p_operador_id, p_ejecutado_nombre, p_modulos, p_desde, p_hasta, payload, total)
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
    DELETE FROM public.finanzas_nomina_asignaciones WHERE id = ANY(v_asig);
    DELETE FROM public.finanzas_operacion_contexto
     WHERE cuenta_id = p_cuenta_id AND operacion_id = ANY(v_ops);
    -- finanzas_movimientos.operacion_id referencia a finanzas_operaciones:
    -- los movimientos se borran ANTES que sus operaciones.
    DELETE FROM public.finanzas_movimientos WHERE id = ANY(v_mov);
    DELETE FROM public.finanzas_operaciones WHERE id = ANY(v_ops);
    IF v_libro THEN
      DELETE FROM public.finanzas_libro_version WHERE cuenta_id = p_cuenta_id;
    END IF;
  END IF;
  IF 'nomina' = ANY(p_modulos) THEN
    DELETE FROM public.nomina_linea_conceptos WHERE id = ANY(v_conc);
    DELETE FROM public.nomina_lineas WHERE id = ANY(v_lin);
    DELETE FROM public.registro_asistencia WHERE id = ANY(v_asis);
    -- La tasa manual global (periodo_id IS NULL) se conserva a propósito.
    DELETE FROM public.nomina_tasas_snapshot WHERE id = ANY(v_tasas);
    DELETE FROM public.nomina_periodos WHERE id = ANY(v_per);
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

  -- Bitácora de purga (misma tabla que la retención), con el rango aplicado.
  INSERT INTO public.purga_log (cuenta_id, ejecutado_por, ejecutado_nombre, disparador, dry_run, retencion_meses, cutoff, resumen, total_eliminadas)
  VALUES (p_cuenta_id, p_operador_id, p_ejecutado_nombre, 'manual', false, 0, CURRENT_DATE,
          jsonb_build_object('tipo', 'mantenimiento', 'modulos', to_jsonb(p_modulos),
                             'rango', jsonb_build_object('desde', p_desde, 'hasta', p_hasta),
                             'por_tabla', por_tabla, 'backup_id', backup_id),
          total);

  RETURN jsonb_build_object(
    'backup_id', backup_id,
    'total_eliminadas', total,
    'por_tabla', por_tabla,
    'modulos', to_jsonb(p_modulos),
    'rango', jsonb_build_object('desde', p_desde, 'hasta', p_hasta)
  );
END $$;

-- 4) Previo: cuántas filas borraría cada módulo (sin tocar nada).
CREATE OR REPLACE FUNCTION public.mantenimiento_purge_preview(
  p_cuenta_id UUID,
  p_modulos TEXT[] DEFAULT ARRAY['nomina','finanzas']::TEXT[],
  p_desde DATE DEFAULT NULL,
  p_hasta DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN (public.mantenimiento_purga_core(p_cuenta_id, p_modulos, p_desde, p_hasta, false)) -> 'por_tabla';
END $$;

-- 5) Purga atómica: respalda, borra en orden de claves foráneas y registra.
--    Doble compuerta: el operador debe existir, estar activo y tener la
--    capacidad `purgarRegistros` (solo jefe).
CREATE OR REPLACE FUNCTION public.mantenimiento_purgar(
  p_cuenta_id UUID,
  p_modulos TEXT[],
  p_operador_id UUID,
  p_ejecutado_nombre TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT NULL,
  p_desde DATE DEFAULT NULL,
  p_hasta DATE DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor public.usuarios%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.usuarios u
   WHERE u.id = p_operador_id AND u.cuenta_id = p_cuenta_id AND u.activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operador no encontrado o inactivo' USING ERRCODE = 'PT403';
  END IF;
  -- La capacidad se deriva de la matriz única (espejo SQL, mig. 245/250): nunca
  -- roles literales aquí. Debe coincidir con la guarda del Worker
  -- (requireCapacidad(operador, 'purgarRegistros')).
  IF NOT (actor.rol = ANY(public.roles_capacidad('purgarRegistros'))) THEN
    RAISE EXCEPTION 'La purga de mantenimiento es exclusiva del rol Jefe' USING ERRCODE = 'PT403';
  END IF;
  RETURN public.mantenimiento_purga_core(p_cuenta_id, p_modulos, p_desde, p_hasta, true,
                                         p_operador_id, p_ejecutado_nombre, p_ip);
END $$;

-- Solo el Worker (service_role) puede ejecutar estas funciones; el núcleo no lo
-- invoca nadie más (queda sin grants, solo vía las dos funciones públicas).
REVOKE ALL ON FUNCTION public.mantenimiento_purga_core(UUID, TEXT[], DATE, DATE, BOOLEAN, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mantenimiento_purga_core(UUID, TEXT[], DATE, DATE, BOOLEAN, UUID, TEXT, TEXT) FROM anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.mantenimiento_purge_preview(UUID, TEXT[], DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mantenimiento_purge_preview(UUID, TEXT[], DATE, DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mantenimiento_purge_preview(UUID, TEXT[], DATE, DATE) TO service_role;

REVOKE ALL ON FUNCTION public.mantenimiento_purgar(UUID, TEXT[], UUID, TEXT, TEXT, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mantenimiento_purgar(UUID, TEXT[], UUID, TEXT, TEXT, DATE, DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mantenimiento_purgar(UUID, TEXT[], UUID, TEXT, TEXT, DATE, DATE) TO service_role;
