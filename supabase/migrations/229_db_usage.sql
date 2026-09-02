-- 229_db_usage.sql
-- Medidor de uso de la base de datos para el panel de retención.
-- Devuelve, por tabla del tenant: bytes en disco (heap + índices + TOAST),
-- filas exactas del tenant y tamaño de la mayor fila. Todo se agrega en
-- servidor para que el egress sea prácticamente cero.
--
-- Límite de referencia: 500 MB del tier gratuito de Supabase, compartido entre
-- todos los tenants de la instancia. El % se calcula contra ese presupuesto.
-- NOTA: pg_total_relation_size mide la tabla física completa (compartida entre
-- tenants), por lo que el reporte es una COTA SUPERIOR conservadora del uso
-- atribuible al tenant — apropiado para vigilar presupuesto, no una contabilidad exacta.
--
-- Contrato de filas devueltas (la columna `tabla` es una etiqueta):
--   tabla = '<nombre>'  -> una fila por tabla CON datos del tenant:
--                          total_bytes, total_filas, max_fila
--   tabla = 'resumen'   -> totales: total_bytes, total_filas,
--                          pct = bytes / (500 MB) * 100, n_tablas
--   tabla = 'max_fila'  -> tamaño de la mayor fila del tenant (diagnóstico)
--
-- SEGURIDAD: SECURITY DEFINER con tabla acotada a lista fija y cuenta_id
-- parametrizado; solo el Worker (service_role) puede ejecutarla.

CREATE OR REPLACE FUNCTION public.db_usage(p_cuenta_id UUID)
RETURNS TABLE(
  tabla       TEXT,
  total_bytes BIGINT,
  total_filas BIGINT,
  pct         NUMERIC,
  n_tablas    BIGINT,
  max_fila    BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_presupuesto CONSTANT BIGINT := 500 * 1024 * 1024; -- 500 MB tier gratuito
  v_tables TEXT[] := ARRAY[
    'finanzas_movimientos', 'finanzas_categorias', 'cuentas_custodia',
    'nomina_empleados', 'nomina_config_empleado', 'registro_asistencia',
    'nomina_periodos', 'nomina_lineas', 'nomina_linea_conceptos',
    'nomina_tasas_snapshot', 'auditoria', 'purga_log'
  ];
  v_t       TEXT;
  v_oid     OID;
  v_rows    BIGINT;
  v_bytes   BIGINT;
  v_max     BIGINT;
  v_total_bytes BIGINT := 0;
  v_total_rows  BIGINT := 0;
  v_n_tablas    BIGINT := 0;
  v_max_fila    BIGINT := 0;
BEGIN
  FOREACH v_t IN ARRAY v_tables LOOP
    v_oid := to_regclass('public.' || v_t);
    IF v_oid IS NULL THEN
      CONTINUE; -- tabla aún no creada en esta base
    END IF;

    -- Filas exactas del tenant + tamaño de su mayor fila (tope 20k filas por
    -- tabla para acotar el costo; ambas métricas usan el índice de cuenta_id).
    EXECUTE format(
      'SELECT count(*), COALESCE((
         SELECT max(pg_column_size(s.row_))
         FROM (SELECT t AS row_ FROM public.%I t WHERE t.cuenta_id = $1 LIMIT 20000) s
       ), 0)
       FROM public.%I WHERE cuenta_id = $1',
      v_t, v_t)
    INTO v_rows, v_max
    USING p_cuenta_id;

    IF v_rows = 0 THEN
      CONTINUE; -- sin datos del tenant: no aporta al presupuesto
    END IF;

    v_bytes := pg_total_relation_size(v_oid);

    tabla := v_t;
    total_bytes := v_bytes;
    total_filas := v_rows;
    pct := NULL;
    n_tablas := NULL;
    max_fila := v_max;
    RETURN NEXT;

    v_total_bytes := v_total_bytes + v_bytes;
    v_total_rows  := v_total_rows + v_rows;
    v_n_tablas    := v_n_tablas + 1;
    IF v_max > v_max_fila THEN
      v_max_fila := v_max;
    END IF;
  END LOOP;

  -- Fila resumen del tenant
  tabla := 'resumen';
  total_bytes := v_total_bytes;
  total_filas := v_total_rows;
  pct := round(v_total_bytes::numeric / v_presupuesto * 100, 2);
  n_tablas := v_n_tablas;
  max_fila := NULL;
  RETURN NEXT;

  -- Fila de la mayor fila (diagnóstico de crecimiento anómalo)
  tabla := 'max_fila';
  total_bytes := v_total_bytes;
  total_filas := v_total_rows;
  pct := NULL;
  n_tablas := NULL;
  max_fila := v_max_fila;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.db_usage(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.db_usage(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_usage(UUID) TO service_role;

COMMENT ON FUNCTION public.db_usage(UUID) IS
  'Uso de BD por tabla del tenant (bytes/filas/mayor fila) contra el presupuesto de 500 MB. Solo service-role (Worker).';
