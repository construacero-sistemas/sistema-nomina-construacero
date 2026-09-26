-- supabase/migrations/248_nomina_comisiones_atomicas.sql
-- Applying a batch of POS commissions must be all-or-nothing. The former Worker
-- loop patched one receipt at a time, so a later failure left a partial payroll.
-- Serialize with payments/transfers and lock the period/receipts before changes.

CREATE OR REPLACE FUNCTION public.nomina_aplicar_comisiones_pos(
  p_cuenta_id UUID,
  p_operador_id UUID,
  p_periodo_id UUID,
  p_aplicaciones JSONB,
  p_ip TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor public.usuarios%ROWTYPE;
  payroll_period public.nomina_periodos%ROWTYPE;
  item JSONB;
  employee_id UUID;
  line public.nomina_lineas%ROWTYPE;
  commission NUMERIC(12,4);
  dispatches JSONB;
  applications_count INTEGER;
  updated_count INTEGER := 0;
  commission_total NUMERIC(18,4) := 0;
  details JSONB := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(238, 1);

  SELECT * INTO actor FROM public.usuarios u
  WHERE u.id = p_operador_id AND u.cuenta_id = p_cuenta_id AND u.activo
    AND u.rol = ANY(public.roles_capacidad('gestionarUsuarios'))
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized operator' USING ERRCODE = 'PT403'; END IF;

  IF p_cuenta_id IS NULL OR p_periodo_id IS NULL OR jsonb_typeof(p_aplicaciones) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_aplicaciones) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid commission applications' USING ERRCODE = 'PT400';
  END IF;
  applications_count := jsonb_array_length(p_aplicaciones);

  SELECT * INTO payroll_period FROM public.nomina_periodos p
  WHERE p.id = p_periodo_id AND p.cuenta_id = p_cuenta_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll period not found' USING ERRCODE = 'PT404'; END IF;
  IF payroll_period.estado <> 'abierto' THEN RAISE EXCEPTION 'Payroll period is not open' USING ERRCODE = 'PT409'; END IF;

  -- Validate the complete request before the first write.
  FOR item IN SELECT value FROM jsonb_array_elements(p_aplicaciones)
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR jsonb_typeof(item->'empleadoId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'comisionesUsd') IS NULL
      OR jsonb_typeof(item->'comisionesUsd') NOT IN ('number','string')
      OR jsonb_typeof(item->'despachosIds') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid commission application' USING ERRCODE = 'PT400';
    END IF;
    employee_id := (item->>'empleadoId')::uuid;
    commission := (item->>'comisionesUsd')::numeric;
    dispatches := item->'despachosIds';
    IF commission < 0 OR commission > 99999999.9999 OR jsonb_array_length(dispatches) > 5000
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(dispatches) value WHERE jsonb_typeof(value) <> 'string')
      OR (SELECT count(*) FROM jsonb_array_elements_text(dispatches)) <>
         (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(dispatches) value) THEN
      RAISE EXCEPTION 'Invalid commission amount or dispatch list' USING ERRCODE = 'PT400';
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(p_aplicaciones) app WHERE app->>'empleadoId' = item->>'empleadoId') <> 1 THEN
      RAISE EXCEPTION 'Duplicate commission employee' USING ERRCODE = 'PT400';
    END IF;
  END LOOP;

  -- Lock and validate every target before updating any line. Row locks plus the
  -- shared financial advisory lock prevent racing a payment or another import.
  FOR item IN
    SELECT value FROM jsonb_array_elements(p_aplicaciones)
    ORDER BY value->>'empleadoId'
  LOOP
    employee_id := (item->>'empleadoId')::uuid;
    SELECT * INTO line FROM public.nomina_lineas l
    WHERE l.cuenta_id = p_cuenta_id AND l.periodo_id = p_periodo_id AND l.empleado_id = employee_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payroll line not found' USING ERRCODE = 'PT404'; END IF;
    IF line.pagado THEN RAISE EXCEPTION 'Payroll line is already paid' USING ERRCODE = 'PT409'; END IF;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(p_aplicaciones)
  LOOP
    employee_id := (item->>'empleadoId')::uuid;
    commission := (item->>'comisionesUsd')::numeric;
    dispatches := item->'despachosIds';
    SELECT * INTO line FROM public.nomina_lineas l
    WHERE l.cuenta_id = p_cuenta_id AND l.periodo_id = p_periodo_id AND l.empleado_id = employee_id;

    UPDATE public.nomina_lineas SET
      comisiones_pos_usd = commission,
      comisiones_despachos_ids = dispatches,
      total_bruto_usd = round(line.monto_normal_usd + line.monto_extra_usd + line.monto_sabado_usd
        + line.monto_feriado_usd + line.bonos_usd + commission, 4),
      total_neto_usd = greatest(0, round(line.monto_normal_usd + line.monto_extra_usd + line.monto_sabado_usd
        + line.monto_feriado_usd + line.bonos_usd + commission - line.deducciones_usd, 4))
    WHERE cuenta_id = p_cuenta_id AND id = line.id;

    updated_count := updated_count + 1;
    commission_total := commission_total + commission;
    details := details || jsonb_build_array(jsonb_build_object(
      'empleado_id', employee_id, 'linea_id', line.id, 'comisiones_pos_usd', commission,
      'despachos_count', jsonb_array_length(dispatches),
      'total_neto_usd', greatest(0, round(line.monto_normal_usd + line.monto_extra_usd + line.monto_sabado_usd
        + line.monto_feriado_usd + line.bonos_usd + commission - line.deducciones_usd, 4))
    ));
  END LOOP;

  INSERT INTO public.auditoria(cuenta_id,usuario_id,usuario_nombre,usuario_rol,categoria,accion,
    entidad_tipo,entidad_id,meta,ip_origen)
  VALUES(p_cuenta_id,actor.id,actor.nombre,actor.rol,'NOMINA','APLICAR_COMISIONES_POS',
    'nomina_periodo',p_periodo_id,
    jsonb_build_object('periodo',payroll_period.nombre,'empleados_actualizados',updated_count,
      'total_comisiones_usd',commission_total),nullif(p_ip,'')::inet);

  RETURN jsonb_build_object('ok',true,'actualizados',updated_count,
    'total_comisiones_usd',commission_total,'detalle',details);
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
    RAISE EXCEPTION 'Invalid commission application value' USING ERRCODE = 'PT400';
END;
$$;

REVOKE ALL ON FUNCTION public.nomina_aplicar_comisiones_pos(UUID,UUID,UUID,JSONB,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nomina_aplicar_comisiones_pos(UUID,UUID,UUID,JSONB,TEXT)
  TO service_role;
