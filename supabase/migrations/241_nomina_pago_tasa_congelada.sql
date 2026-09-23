-- supabase/migrations/241_nomina_pago_tasa_congelada.sql
-- Congela la tasa de pago y el monto en bolívares EN el recibo de nómina.
--
-- Problemática (hoja de Excel del negocio): "neto en bolívares a la tasa que
-- se determine ese día que se va a pagar". Hasta ahora el RPC atómico (238)
-- registraba la tasa en finanzas_nomina_asignaciones (tabla de servicio, no
-- legible por la UI); el recibo quedaba sin evidencia de la tasa aplicada.
--
-- Este cambio:
--   1. nomina_lineas.tasa_pago_usd_ves  NUMERIC(24,8): tasa usada al pagar.
--   2. nomina_lineas.total_pagado_bs    NUMERIC(14,2): neto USD × tasa, redondeado a 2 dec.
--   3. Redefine finanzas_operar (CREATE OR REPLACE, misma firma):
--      - pagar_nomina:     escribe ambas columnas junto al resto del pago.
--      - revertir_nomina:  las pone en NULL (revocar pago revoca la evidencia).
--   4. Grants idénticos a los de 238 (service_role ejecuta; público sin acceso).
--
-- Compatible hacia atrás: los recibos pagados antes de esta migración quedan
-- con NULL en ambas columnas; la UI/PDF muestra "—" para esos casos.

BEGIN;

ALTER TABLE public.nomina_lineas
  ADD COLUMN IF NOT EXISTS tasa_pago_usd_ves NUMERIC(24,8),
  ADD COLUMN IF NOT EXISTS total_pagado_bs   NUMERIC(14,2);

COMMENT ON COLUMN public.nomina_lineas.tasa_pago_usd_ves IS
  'Tasa Bs/USD congelada al momento del pago (pagar_nomina). NULL si no pagado.';
COMMENT ON COLUMN public.nomina_lineas.total_pagado_bs IS
  'Monto neto pagado en Bs = total_neto_usd * tasa_pago_usd_ves, redondeado a 2 dec. NULL si no pagado.';

CREATE OR REPLACE FUNCTION public.finanzas_operar(
  p_cuenta_id UUID, p_operador_id UUID, p_tipo TEXT, p_clave TEXT, p_payload JSONB, p_ip TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE
  actor public.usuarios%ROWTYPE;
  operation public.finanzas_operaciones%ROWTYPE;
  source_account public.cuentas_custodia%ROWTYPE;
  target_account public.cuentas_custodia%ROWTYPE;
  receipt public.nomina_lineas%ROWTYPE;
  assignment public.finanzas_nomina_asignaciones%ROWTYPE;
  normalized JSONB := p_payload;
  hash TEXT;
  ids UUID[];
  period_ids UUID[];
  receipt_id UUID;
  movement_id UUID;
  movement_ids UUID[] := '{}';
  assignment_ids UUID[] := '{}';
  assignment_id UUID;
  usd_rate NUMERIC(24,8);
  usdt_rate NUMERIC(24,8);
  native_rate NUMERIC(24,8);
  transfer_rate NUMERIC(24,8);
  target_rate NUMERIC(24,8);
  source_amount NUMERIC(18,6);
  target_amount NUMERIC(18,6);
  usd_total NUMERIC(18,6) := 0;
  balance NUMERIC;
  outcome JSONB;
  response JSONB;
  rate_source TEXT;
  note TEXT;
  method TEXT;
  reference TEXT;
  operation_date DATE;
  business_timezone TEXT := 'America/Caracas';
BEGIN
  PERFORM pg_advisory_xact_lock(238, 1);
  SELECT * INTO actor FROM public.usuarios u WHERE u.id = p_operador_id
    AND u.cuenta_id = p_cuenta_id AND u.activo AND u.rol = 'administracion' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized operator' USING ERRCODE = 'PT403'; END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('pagar_nomina','revertir_nomina','traspaso') OR
    p_clave IS NULL OR p_clave !~ '^[A-Za-z0-9._:-]{16,128}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid operation envelope' USING ERRCODE = 'PT400';
  END IF;
  IF p_tipo = 'pagar_nomina' THEN
    IF jsonb_typeof(p_payload->'lineaIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'lineaIds') NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'Invalid receipt selection' USING ERRCODE = 'PT400';
    END IF;
    SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT DISTINCT value::uuid id FROM jsonb_array_elements_text(p_payload->'lineaIds')) x;
    normalized := jsonb_set(normalized, '{lineaIds}', to_jsonb(ids));
  END IF;
  business_timezone := coalesce(nullif(p_payload->>'zonaHoraria',''),'America/Caracas');
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name = business_timezone) THEN
    RAISE EXCEPTION 'Zona horaria del negocio inválida' USING ERRCODE = 'PT400';
  END IF;
  hash := encode(digest(convert_to(normalized::text, 'UTF8'), 'sha256'), 'hex');
  SELECT * INTO operation FROM public.finanzas_operaciones o
    WHERE o.cuenta_id = p_cuenta_id AND o.tipo = p_tipo AND o.clave = p_clave FOR UPDATE;
  IF FOUND THEN
    IF operation.payload_hash <> hash THEN RAISE EXCEPTION 'Idempotency payload conflict' USING ERRCODE = 'PT409'; END IF;
    RETURN operation.resultado;
  END IF;
  INSERT INTO public.finanzas_operaciones(cuenta_id,tipo,clave,payload,payload_hash,operador_id,operador_nombre,operador_rol,ip_origen)
    VALUES(p_cuenta_id,p_tipo,p_clave,normalized,hash,actor.id,actor.nombre,actor.rol,p_ip) RETURNING * INTO operation;
  INSERT INTO public.finanzas_operacion_contexto(transaction_id,cuenta_id,operacion_id)
    VALUES(txid_current(),p_cuenta_id,operation.id);

  IF p_tipo = 'pagar_nomina' THEN
    SELECT * INTO source_account FROM public.cuentas_custodia c WHERE c.cuenta_id = p_cuenta_id
      AND c.id = (p_payload->>'cuentaCustodiaId')::uuid AND c.activo FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Custody account not found' USING ERRCODE = 'PT404'; END IF;
    usd_rate := (p_payload->>'tasaBcv')::numeric;
    IF usd_rate IS NULL OR usd_rate <= 0 OR usd_rate > 1000000 THEN RAISE EXCEPTION 'Explicit payroll rate required' USING ERRCODE = 'PT400'; END IF;
    native_rate := CASE source_account.moneda WHEN 'VES' THEN 1 ELSE usd_rate END;
    IF source_account.moneda = 'USDT' THEN
      usd_rate := (p_payload->>'tasaUsdVes')::numeric;
      IF usd_rate IS NULL OR usd_rate <= 0 OR usd_rate > 1000000 THEN RAISE EXCEPTION 'Explicit USD/VES rate required for USDT' USING ERRCODE = 'PT400'; END IF;
    ELSIF p_payload->>'tasaUsdVes' IS NOT NULL AND (p_payload->>'tasaUsdVes')::numeric <> usd_rate THEN
      RAISE EXCEPTION 'Conflicting USD/VES rates' USING ERRCODE = 'PT400';
    END IF;
    rate_source := p_payload->>'fuenteTasa';
    note := nullif(trim(p_payload->>'observacionTasa'),'');
    method := nullif(trim(p_payload->>'metodoPago'),'');
    reference := nullif(trim(p_payload->>'referencia'),'');
    IF rate_source IS NULL OR rate_source NOT IN ('BCV','EURO','USDT','MANUAL') OR method IS NULL OR length(method) > 60
      OR length(reference) > 160 OR length(note) > 1000 OR (rate_source = 'MANUAL' AND note IS NULL) THEN
      RAISE EXCEPTION 'Invalid payment metadata' USING ERRCODE = 'PT400';
    END IF;
    SELECT array_agg(DISTINCT l.periodo_id ORDER BY l.periodo_id) INTO period_ids FROM public.nomina_lineas l
      WHERE l.cuenta_id = p_cuenta_id AND l.id = ANY(ids);
    PERFORM p.id FROM public.nomina_periodos p WHERE p.cuenta_id = p_cuenta_id AND p.id = ANY(period_ids) ORDER BY p.id FOR UPDATE;
    PERFORM l.id FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.id = ANY(ids) ORDER BY l.id FOR UPDATE;
    IF (SELECT count(*) FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.id = ANY(ids)) <> cardinality(ids) THEN
      RAISE EXCEPTION 'Receipt not found' USING ERRCODE = 'PT404';
    END IF;
    IF EXISTS(SELECT 1 FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.id = ANY(ids) AND l.pagado)
      OR EXISTS(SELECT 1 FROM public.nomina_periodos p WHERE p.cuenta_id = p_cuenta_id AND p.id = ANY(period_ids) AND p.estado <> 'cerrado') THEN
      RAISE EXCEPTION 'Receipts must be unpaid and periods closed' USING ERRCODE = 'PT409';
    END IF;
    FOR receipt IN SELECT * FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.id = ANY(ids) ORDER BY l.id LOOP
      source_amount := round(receipt.total_neto_usd * usd_rate / native_rate, 6);
      IF receipt.total_neto_usd > 0 AND source_amount <= 0 THEN RAISE EXCEPTION 'Settlement rounds to zero' USING ERRCODE = 'PT400'; END IF;
      movement_id := NULL;
      IF source_amount > 0 THEN
        INSERT INTO public.finanzas_movimientos(cuenta_id,fecha,tipo,categoria,concepto,monto,moneda,tasa_ves,tasa_usd_ves,
          fuente_tasa,observacion_tasa,tasa_observada_en,referencia,observaciones,idempotency_key,estado,creado_por,
          metodo_pago,cuenta_origen,cuenta_custodia_id,operacion_id)
        VALUES(p_cuenta_id,(now() AT TIME ZONE business_timezone)::date,'egreso','Nómina',
          left('Pago de recibo ' || receipt.id || ' / período ' || receipt.periodo_id || ' / ' || method,180),
          source_amount,source_account.moneda,native_rate,usd_rate,rate_source,note,now(),reference,
          'Payroll operation ' || operation.id,'op:' || operation.id || ':' || receipt.id,'activo',actor.id,
          method,source_account.nombre,source_account.id,operation.id) RETURNING id INTO movement_id;
        movement_ids := array_append(movement_ids,movement_id);
      END IF;
      INSERT INTO public.finanzas_nomina_asignaciones(cuenta_id,operacion_id,linea_id,movimiento_id,cuenta_custodia_id,
        monto_usd,monto_nativo,moneda,tasa_ves,tasa_usd_ves,fuente_tasa,observacion_tasa,metodo_pago)
      VALUES(p_cuenta_id,operation.id,receipt.id,movement_id,source_account.id,receipt.total_neto_usd,source_amount,
        source_account.moneda,native_rate,usd_rate,rate_source,note,method) RETURNING id INTO assignment_id;
      assignment_ids := array_append(assignment_ids,assignment_id);
      usd_total := usd_total + receipt.total_neto_usd;
      UPDATE public.nomina_lineas SET pagado = true,pagado_en = now(),pagado_por = actor.id,
        pagado_por_nombre = actor.nombre,referencia_pago = reference,
        tasa_pago_usd_ves = usd_rate,total_pagado_bs = round(receipt.total_neto_usd * usd_rate, 2)
        WHERE cuenta_id = p_cuenta_id AND id = receipt.id;
    END LOOP;
    UPDATE public.nomina_periodos p SET estado = 'pagado' WHERE p.cuenta_id = p_cuenta_id AND p.id = ANY(period_ids)
      AND NOT EXISTS(SELECT 1 FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.periodo_id = p.id AND NOT l.pagado);
    outcome := jsonb_build_object('recibos_pagados',cardinality(ids),'total_usd',usd_total::text,
      'asignacionIds',to_jsonb(assignment_ids),'movimientoIds',to_jsonb(movement_ids));

  ELSIF p_tipo = 'revertir_nomina' THEN
    receipt_id := (p_payload->>'lineaId')::uuid;
    note := nullif(trim(p_payload->>'motivo'),'');
    IF receipt_id IS NULL OR note IS NULL OR length(note) > 300 THEN RAISE EXCEPTION 'Receipt and reversal reason required' USING ERRCODE = 'PT400'; END IF;
    SELECT * INTO receipt FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.id = receipt_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found' USING ERRCODE = 'PT404'; END IF;
    SELECT * INTO assignment FROM public.finanzas_nomina_asignaciones a WHERE a.cuenta_id = p_cuenta_id
      AND a.linea_id = receipt.id AND a.revertida_por_operacion_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Legacy receipt requires reconciliation; no explicit assignment' USING ERRCODE = 'PT422'; END IF;
    PERFORM c.id FROM public.cuentas_custodia c WHERE c.cuenta_id = p_cuenta_id AND c.id = assignment.cuenta_custodia_id FOR UPDATE;
    PERFORM p.id FROM public.nomina_periodos p WHERE p.cuenta_id = p_cuenta_id AND p.id = receipt.periodo_id FOR UPDATE;
    SELECT * INTO receipt FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.id = receipt_id FOR UPDATE;
    IF NOT receipt.pagado THEN RAISE EXCEPTION 'Receipt is not paid' USING ERRCODE = 'PT409'; END IF;
    IF assignment.movimiento_id IS NOT NULL THEN
      UPDATE public.finanzas_movimientos SET estado = 'anulado',anulado_en = now(),anulado_por = actor.id,motivo_anulacion = note
        WHERE cuenta_id = p_cuenta_id AND id = assignment.movimiento_id AND operacion_id = assignment.operacion_id AND estado = 'activo';
      IF NOT FOUND THEN RAISE EXCEPTION 'Linked ledger entry requires reconciliation' USING ERRCODE = 'PT422'; END IF;
    END IF;
    UPDATE public.finanzas_nomina_asignaciones SET revertida_por_operacion_id = operation.id,revertida_en = now()
      WHERE cuenta_id = p_cuenta_id AND id = assignment.id;
    UPDATE public.nomina_lineas SET pagado = false,pagado_en = NULL,pagado_por = NULL,pagado_por_nombre = NULL,referencia_pago = NULL,
      tasa_pago_usd_ves = NULL,total_pagado_bs = NULL
      WHERE cuenta_id = p_cuenta_id AND id = receipt.id;
    UPDATE public.nomina_periodos SET estado = 'cerrado' WHERE cuenta_id = p_cuenta_id AND id = receipt.periodo_id AND estado = 'pagado';
    outcome := jsonb_build_object('lineaId',receipt.id,'asignacionId',assignment.id,'movimientoId',assignment.movimiento_id,
      'total_usd',assignment.monto_usd::text,'reversionContable',true);

  ELSE
    IF (p_payload->>'origenCuentaId')::uuid = (p_payload->>'destinoCuentaId')::uuid THEN
      RAISE EXCEPTION 'Transfer accounts must differ' USING ERRCODE = 'PT400';
    END IF;
    PERFORM c.id FROM public.cuentas_custodia c WHERE c.cuenta_id = p_cuenta_id
      AND c.id IN ((p_payload->>'origenCuentaId')::uuid,(p_payload->>'destinoCuentaId')::uuid) ORDER BY c.id FOR UPDATE;
    SELECT * INTO source_account FROM public.cuentas_custodia c WHERE c.cuenta_id = p_cuenta_id AND c.id = (p_payload->>'origenCuentaId')::uuid AND c.activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source account not found' USING ERRCODE = 'PT404'; END IF;
    SELECT * INTO target_account FROM public.cuentas_custodia c WHERE c.cuenta_id = p_cuenta_id AND c.id = (p_payload->>'destinoCuentaId')::uuid AND c.activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Destination account not found' USING ERRCODE = 'PT404'; END IF;
    source_amount := (p_payload->>'montoOrigen')::numeric;
    transfer_rate := (p_payload->>'tasaCambio')::numeric;
    usd_rate := (p_payload->>'tasaUsdVes')::numeric;
    note := nullif(trim(p_payload->>'observaciones'),'');
    reference := nullif(trim(p_payload->>'referencia'),'');
    operation_date := (p_payload->>'fecha')::date;
    IF source_amount IS NULL OR source_amount <= 0 OR source_amount > 1000000000
      OR transfer_rate IS NULL OR transfer_rate <= 0 OR transfer_rate > 1000000
      OR usd_rate IS NULL OR usd_rate <= 0 OR usd_rate > 1000000 OR note IS NULL OR length(note) > 1000
      OR length(reference) > 160 OR operation_date IS NULL THEN RAISE EXCEPTION 'Invalid transfer data' USING ERRCODE = 'PT400'; END IF;
    IF source_account.moneda = target_account.moneda AND transfer_rate <> 1 THEN
      RAISE EXCEPTION 'Same-currency transfers require identity rate' USING ERRCODE = 'PT400';
    END IF;
    -- Rates are destination-native units per source-native unit. USDT/USD parity is never assumed.
    usdt_rate := (p_payload->>'tasaUsdtVes')::numeric;
    IF usdt_rate IS NOT NULL AND (usdt_rate <= 0 OR usdt_rate > 1000000) THEN
      RAISE EXCEPTION 'Invalid USDT/VES valuation rate' USING ERRCODE = 'PT400';
    END IF;
    IF source_account.moneda = 'USDT' AND target_account.moneda = 'USDT' AND usdt_rate IS NULL THEN
      RAISE EXCEPTION 'USDT to USDT requires an explicit USDT/VES valuation rate' USING ERRCODE = 'PT400';
    END IF;
    IF usdt_rate IS NOT NULL THEN
      -- Preserve supplied valuation rates. Compare their quotient at transport
      -- precision below; reversing a rounded quotient corrupts the snapshot.
      native_rate := CASE source_account.moneda WHEN 'USD' THEN usd_rate WHEN 'VES' THEN 1 ELSE usdt_rate END;
      target_rate := CASE target_account.moneda WHEN 'USD' THEN usd_rate WHEN 'VES' THEN 1 ELSE usdt_rate END;
    ELSE
      native_rate := CASE source_account.moneda WHEN 'USD' THEN usd_rate WHEN 'VES' THEN 1
        ELSE transfer_rate * CASE target_account.moneda WHEN 'USD' THEN usd_rate ELSE 1 END END;
      target_rate := CASE target_account.moneda WHEN 'USD' THEN usd_rate WHEN 'VES' THEN 1 ELSE native_rate / transfer_rate END;
    END IF;
    IF round(native_rate / target_rate,8) <> transfer_rate OR native_rate <= 0 OR native_rate > 1000000
      OR target_rate <= 0 OR target_rate > 1000000 THEN
      RAISE EXCEPTION 'Transfer and valuation rates are inconsistent' USING ERRCODE = 'PT400';
    END IF;
    target_amount := round(source_amount * transfer_rate,6);
    IF target_amount <= 0 OR target_amount > 1000000000 THEN RAISE EXCEPTION 'Invalid destination amount' USING ERRCODE = 'PT400'; END IF;
    IF EXISTS(SELECT 1 FROM public.finanzas_movimientos m WHERE m.cuenta_id = p_cuenta_id AND m.estado = 'activo'
      AND (m.cuenta_custodia_id IS NULL OR (m.partes IS NOT NULL AND m.partes <> '[]'::jsonb)))
      OR EXISTS(SELECT 1 FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.pagado AND NOT EXISTS(
        SELECT 1 FROM public.finanzas_nomina_asignaciones a WHERE a.cuenta_id = p_cuenta_id AND a.linea_id = l.id AND a.revertida_por_operacion_id IS NULL)) THEN
      RAISE EXCEPTION 'Unassigned ledger or payroll entries require reconciliation' USING ERRCODE = 'PT422';
    END IF;
    SELECT coalesce(sum(CASE WHEN m.tipo = 'ingreso' THEN m.monto ELSE -m.monto END),0) INTO balance
      FROM public.finanzas_movimientos m WHERE m.cuenta_id = p_cuenta_id AND m.cuenta_custodia_id = source_account.id
      AND m.moneda = source_account.moneda AND m.estado = 'activo';
    IF balance < source_amount THEN RAISE EXCEPTION 'Insufficient funds' USING ERRCODE = 'PT402'; END IF;
    INSERT INTO public.finanzas_movimientos(cuenta_id,fecha,tipo,categoria,concepto,monto,moneda,tasa_ves,tasa_usd_ves,
      fuente_tasa,observacion_tasa,referencia,observaciones,idempotency_key,creado_por,metodo_pago,cuenta_origen,cuenta_custodia_id,operacion_id)
    VALUES(p_cuenta_id,operation_date,'egreso','Traspasos','Transfer to ' || target_account.nombre,
      source_amount,source_account.moneda,native_rate,usd_rate,'MANUAL',note,reference,note,'op:' || operation.id || ':out',
      actor.id,'Transferencia',source_account.nombre,source_account.id,operation.id) RETURNING id INTO movement_id;
    movement_ids := array_append(movement_ids,movement_id);
    INSERT INTO public.finanzas_movimientos(cuenta_id,fecha,tipo,categoria,concepto,monto,moneda,tasa_ves,tasa_usd_ves,
      fuente_tasa,observacion_tasa,referencia,observaciones,idempotency_key,creado_por,metodo_pago,cuenta_origen,cuenta_custodia_id,operacion_id)
    VALUES(p_cuenta_id,operation_date,'ingreso','Traspasos','Transfer from ' || source_account.nombre,
      target_amount,target_account.moneda,target_rate,usd_rate,'MANUAL',note,reference,note,'op:' || operation.id || ':in',
      actor.id,'Transferencia',target_account.nombre,target_account.id,operation.id) RETURNING id INTO movement_id;
    movement_ids := array_append(movement_ids,movement_id);
    outcome := jsonb_build_object('origenCuentaId',source_account.id,'destinoCuentaId',target_account.id,
      'montoOrigen',source_amount::text,'montoDestino',target_amount::text,'monedaOrigen',source_account.moneda,
      'monedaDestino',target_account.moneda,'tasaCambio',transfer_rate::text,'movimientoIds',to_jsonb(movement_ids));
  END IF;

  response := jsonb_build_object('ok',true,'operationId',operation.id,'idempotencyKey',p_clave,'tipo',p_tipo,
    'estado','confirmada','resultado',outcome) || outcome;
  INSERT INTO public.auditoria(cuenta_id,usuario_id,usuario_nombre,usuario_rol,categoria,accion,entidad_tipo,entidad_id,meta)
    VALUES(p_cuenta_id,actor.id,actor.nombre,actor.rol,'FINANZAS',upper(p_tipo),'finanzas_operacion',operation.id,
      jsonb_build_object('operationId',operation.id,'payloadHash',hash,'resultado',outcome,'ip',p_ip));
  UPDATE public.finanzas_operaciones SET resultado = response WHERE cuenta_id = p_cuenta_id AND id = operation.id;
  DELETE FROM public.finanzas_operacion_contexto WHERE transaction_id = txid_current();
  RETURN response;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION 'Invalid operation value' USING ERRCODE = 'PT400';
END;
$$;

-- Grants idénticos a 238 (reemplazo de función conserva los grants previos, pero
-- los redeclaramos por claridad y para idempotencia si alguien revocó a mano).
REVOKE ALL ON FUNCTION public.finanzas_operar(UUID,UUID,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_operar(UUID,UUID,TEXT,TEXT,JSONB,TEXT) TO service_role;

COMMIT;
