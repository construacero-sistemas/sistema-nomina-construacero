-- 254: Apertura y cierre simples (plan docs/PLAN_SIMPLIFICACION_FINANZAS.md).
-- Cambios de regla, sin tocar tablas ni datos:
--   4.1 La apertura SÍ puede quedar por debajo del cierre anterior (faltante),
--       con motivo obligatorio de 8..300 caracteres.
--   D1  La apertura negativa (descubierto: el conteo no cubre los movimientos
--       ya registrados) se permite SOLO con motivo.
--   4.2 El cierre SÍ puede registrar menos dinero del que dice el libro
--       (faltante), con motivo obligatorio.
--   4.4 El cierre da de alta automáticamente las cuentas activas sin apertura
--       del mes (antes bloqueaba para siempre el cierre).
--   4.5 Los movimientos sin cuenta de custodia dejan de bloquear la apertura
--       (el guard de alta ya los impide; los históricos son aviso de UI).
-- Rollback: restaurar la definición de 253_finanzas_periodos_mensuales.sql
-- (misma firma) y volver a añadir los dos CHECK de importe no negativo.
BEGIN;

ALTER TABLE public.finanzas_periodos_mensuales_cuentas
  DROP CONSTRAINT IF EXISTS finanzas_periodos_mensuales_cuentas_saldo_apertura_check,
  DROP CONSTRAINT IF EXISTS finanzas_periodos_mensuales_cuentas_saldo_apertura_usd_check;

CREATE OR REPLACE FUNCTION public.finanzas_periodo_mensual_operar(
  p_cuenta_id UUID,p_operador_id UUID,p_accion TEXT,p_mes_inicio DATE,p_clave TEXT,p_payload JSONB,p_ip TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.usuarios%ROWTYPE; periodo public.finanzas_periodos_mensuales%ROWTYPE; row_data RECORD;
  item JSONB; cnt INTEGER; monto NUMERIC; neto NUMERIC; apertura NUMERIC; anterior NUMERIC;
  real_amount NUMERIC; diff NUMERIC; rate_ves NUMERIC; usd_rate NUMERIC; usdt_rate NUMERIC; usd_value NUMERIC;
  note TEXT; method TEXT; hash TEXT; result JSONB; closing_day DATE; base_day DATE; action_key TEXT;
BEGIN
  IF p_cuenta_id IS NULL OR p_operador_id IS NULL THEN
    RAISE EXCEPTION 'Invalid monthly operator' USING ERRCODE='PT400';
  END IF;
  PERFORM pg_advisory_xact_lock(238,1);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cuenta_id::text,251));
  SELECT * INTO actor FROM public.usuarios u WHERE u.id=p_operador_id AND u.cuenta_id=p_cuenta_id AND u.activo
    AND u.rol=ANY(public.roles_capacidad('gestionarUsuarios')) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized operator' USING ERRCODE='PT403'; END IF;
  IF p_accion NOT IN ('aperturar','cerrar','alta_cuenta') OR p_cuenta_id IS NULL OR p_operador_id IS NULL
    OR p_mes_inicio IS NULL OR extract(day FROM p_mes_inicio)<>1 OR p_clave IS NULL OR p_clave !~ '^[A-Za-z0-9._:-]{16,128}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid monthly operation' USING ERRCODE='PT400';
  END IF;
  hash:=encode(digest(convert_to(p_accion||':'||p_mes_inicio||':'||p_payload::text,'UTF8'),'sha256'),'hex');
  closing_day:=(p_mes_inicio+interval '1 month - 1 day')::date;

  IF p_accion='aperturar' THEN
    IF EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales WHERE cuenta_id=p_cuenta_id AND mes_inicio=p_mes_inicio
      AND apertura_clave=p_clave AND apertura_hash=hash) THEN
      RETURN public.finanzas_periodo_mensual_estado(p_cuenta_id,p_mes_inicio)||jsonb_build_object('ok',true,'idempotente',true);
    END IF;
    SELECT * INTO periodo FROM public.finanzas_periodos_mensuales WHERE cuenta_id=p_cuenta_id AND mes_inicio=p_mes_inicio FOR UPDATE;
    IF FOUND THEN
      IF periodo.apertura_clave=p_clave AND periodo.apertura_hash=hash THEN
        RETURN public.finanzas_periodo_mensual_estado(p_cuenta_id,p_mes_inicio)||jsonb_build_object('ok',true,'idempotente',true);
      END IF;
      RAISE EXCEPTION 'Month already opened with different data' USING ERRCODE='PT409';
    END IF;
    IF EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales p WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=(p_mes_inicio-interval '1 month')::date AND p.estado<>'cerrado') THEN
      RAISE EXCEPTION 'Previous month must be closed first' USING ERRCODE='PT409';
    END IF;
    IF EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales p WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio>p_mes_inicio) THEN
      RAISE EXCEPTION 'Cannot open a month older than an existing period' USING ERRCODE='PT409';
    END IF;
    -- 4.5: los movimientos sin cuenta de custodia ya no bloquean la apertura;
    -- el guard de alta de movimientos impide crear nuevos y los históricos se
    -- muestran como aviso en la interfaz (conciliación).
    IF jsonb_typeof(p_payload->'cuentas') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'cuentas')=0 THEN
      RAISE EXCEPTION 'All active wallets are required' USING ERRCODE='PT400';
    END IF;
    SELECT count(*) INTO cnt FROM public.cuentas_custodia c WHERE c.cuenta_id=p_cuenta_id AND c.activo;
    SELECT count(*) INTO monto FROM jsonb_array_elements(p_payload->'cuentas');
    IF cnt<>monto OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'cuentas') e
      WHERE NOT EXISTS(SELECT 1 FROM public.cuentas_custodia c WHERE c.cuenta_id=p_cuenta_id AND c.activo AND c.id=(e->>'cuentaCustodiaId')::uuid)) THEN
      RAISE EXCEPTION 'Opening must include every active wallet exactly once' USING ERRCODE='PT400';
    END IF;
    INSERT INTO public.finanzas_periodos_mensuales(cuenta_id,mes_inicio,mes_fin,apertura_clave,apertura_hash,aperturado_por,ip_apertura)
      VALUES(p_cuenta_id,p_mes_inicio,closing_day,p_clave,hash,actor.id,p_ip) RETURNING * INTO periodo;
    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'cuentas') LOOP
      SELECT * INTO row_data FROM public.cuentas_custodia c WHERE c.cuenta_id=p_cuenta_id AND c.id=(item->>'cuentaCustodiaId')::uuid AND c.activo FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found or inactive' USING ERRCODE='PT404'; END IF;
      note:=nullif(btrim(item->>'motivo'),''); method:=item->>'metodo';
      SELECT c.saldo_cierre_real INTO anterior FROM public.finanzas_periodos_mensuales p
        JOIN public.finanzas_periodos_mensuales_cuentas c ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id
        WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=(p_mes_inicio-interval '1 month')::date AND p.estado='cerrado'
          AND c.cuenta_custodia_id=row_data.id;
      IF method='cierre_anterior' THEN
        IF anterior IS NULL OR anterior<0 THEN RAISE EXCEPTION 'No valid non-negative previous closing balance' USING ERRCODE='PT409'; END IF;
        apertura:=anterior; real_amount:=NULL; diff:=0; base_day:=p_mes_inicio;
      ELSIF method='saldo_real' THEN
        real_amount:=(item->>'saldoReal')::numeric;
        IF real_amount IS NULL OR real_amount<0 THEN RAISE EXCEPTION 'Opening balance must be zero or positive' USING ERRCODE='PT400'; END IF;
        SELECT coalesce(sum(CASE WHEN m.tipo='ingreso' THEN m.monto ELSE -m.monto END),0) INTO neto
          FROM public.finanzas_movimientos m WHERE m.cuenta_id=p_cuenta_id AND m.cuenta_custodia_id=row_data.id
            AND m.estado='activo' AND m.fecha BETWEEN p_mes_inicio AND least(current_date,closing_day);
        -- D1: la apertura puede quedar en negativo (descubierto real) si el
        -- conteo no cubre los movimientos ya registrados; exige motivo.
        apertura:=real_amount-neto; base_day:=p_mes_inicio;
        diff:=CASE WHEN anterior IS NULL THEN 0 ELSE apertura-anterior END;
        -- 4.1: faltantes y sobrantes frente al cierre anterior permitidos, con
        -- motivo de 8..300 caracteres; también el descubierto sin cierre previo.
        IF (abs(diff)>0.000001 OR apertura<0) AND (note IS NULL OR length(note)<8 OR length(note)>300) THEN
          RAISE EXCEPTION 'Explain difference from previous closing balance' USING ERRCODE='PT400';
        END IF;
      ELSE RAISE EXCEPTION 'Invalid opening method' USING ERRCODE='PT400'; END IF;
      rate_ves:=CASE row_data.moneda WHEN 'VES' THEN 1 WHEN 'USD' THEN 1 ELSE coalesce((item->>'tasaUsdtVes')::numeric,0) END;
      usd_rate:=CASE row_data.moneda WHEN 'USD' THEN coalesce((item->>'tasaUsdVes')::numeric,1) ELSE coalesce((item->>'tasaUsdVes')::numeric,0) END;
      usdt_rate:=CASE row_data.moneda WHEN 'USDT' THEN rate_ves ELSE coalesce((item->>'tasaUsdtVes')::numeric,1) END;
      IF rate_ves<=0 OR usd_rate<=0 OR usdt_rate<=0 THEN RAISE EXCEPTION 'Freeze valid USD/VES and USDT/VES rates at opening' USING ERRCODE='PT400'; END IF;
      usd_value:=CASE row_data.moneda WHEN 'USD' THEN apertura WHEN 'VES' THEN apertura/usd_rate ELSE apertura*usdt_rate/usd_rate END;
      INSERT INTO public.finanzas_periodos_mensuales_cuentas(cuenta_id,periodo_id,cuenta_custodia_id,moneda,metodo_apertura,
        fecha_inicio,fecha_verificacion,saldo_apertura,saldo_contado_apertura,diferencia_apertura,motivo_apertura,
        tasa_ves,tasa_usd_ves,tasa_usdt_ves,saldo_apertura_usd,apertura_clave,operacion_hash)
      VALUES(p_cuenta_id,periodo.id,row_data.id,row_data.moneda,method,p_mes_inicio,current_date,apertura,real_amount,diff,note,
        rate_ves,usd_rate,usdt_rate,usd_value,p_clave,hash);
    END LOOP;
    INSERT INTO public.auditoria(cuenta_id,usuario_id,usuario_nombre,usuario_rol,categoria,accion,entidad_tipo,entidad_id,meta,ip_origen)
      VALUES(p_cuenta_id,actor.id,actor.nombre,actor.rol,'FINANZAS','APERTURA_MENSUAL','finanzas_periodos_mensuales',periodo.id,
        jsonb_build_object('mes',p_mes_inicio,'cuentas',jsonb_array_length(p_payload->'cuentas'),'metodo','por_cartera'),nullif(p_ip,'')::inet);
    RETURN public.finanzas_periodo_mensual_estado(p_cuenta_id,p_mes_inicio)||jsonb_build_object('ok',true,'idempotente',false);
  END IF;

  SELECT * INTO periodo FROM public.finanzas_periodos_mensuales WHERE cuenta_id=p_cuenta_id AND mes_inicio=p_mes_inicio FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Month is not open' USING ERRCODE='PT409'; END IF;
  IF p_accion='cerrar' AND periodo.estado='cerrado' THEN
    IF periodo.cierre_clave=p_clave AND periodo.cierre_hash=hash THEN
      RETURN public.finanzas_periodo_mensual_estado(p_cuenta_id,p_mes_inicio)||jsonb_build_object('ok',true,'idempotente',true);
    END IF;
    RAISE EXCEPTION 'Month already closed with different data' USING ERRCODE='PT409';
  END IF;
  IF periodo.estado<>'abierto' THEN RAISE EXCEPTION 'Month is not open' USING ERRCODE='PT409'; END IF;
  IF p_accion='alta_cuenta' THEN
    IF p_mes_inicio<>(date_trunc('month',current_date)::date) THEN
      RAISE EXCEPTION 'Cannot add an account to a non-current month' USING ERRCODE='PT409';
    END IF;
    row_data:=NULL;
    SELECT * INTO row_data FROM public.finanzas_periodos_mensuales_cuentas c WHERE c.cuenta_id=p_cuenta_id AND c.periodo_id=periodo.id AND c.cuenta_custodia_id=(p_payload->>'cuentaCustodiaId')::uuid FOR UPDATE;
    IF FOUND THEN
      IF row_data.cierre_clave IS NULL AND row_data.metodo_apertura='alta_cuenta'
        AND row_data.apertura_clave=p_clave AND row_data.operacion_hash=hash THEN
        RETURN jsonb_build_object('ok',true,'idempotente',true,'cuentaCustodiaId',row_data.cuenta_custodia_id);
      END IF;
      RAISE EXCEPTION 'Wallet already has a monthly opening' USING ERRCODE='PT409';
    END IF;
    SELECT * INTO row_data FROM public.cuentas_custodia c WHERE c.cuenta_id=p_cuenta_id
      AND c.id=(p_payload->>'cuentaCustodiaId')::uuid AND c.activo FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found or inactive' USING ERRCODE='PT404'; END IF;
    real_amount:=(p_payload->>'saldoReal')::numeric; note:=nullif(btrim(p_payload->>'motivo'),'');
    IF real_amount IS NULL OR real_amount<0 THEN RAISE EXCEPTION 'Opening balance must be zero or positive' USING ERRCODE='PT400'; END IF;
    rate_ves:=CASE row_data.moneda WHEN 'VES' THEN 1 WHEN 'USD' THEN 1 ELSE coalesce((p_payload->>'tasaUsdtVes')::numeric,0) END;
    usd_rate:=CASE row_data.moneda WHEN 'USD' THEN 1 ELSE coalesce((p_payload->>'tasaUsdVes')::numeric,0) END;
    usdt_rate:=CASE row_data.moneda WHEN 'USDT' THEN rate_ves ELSE 1 END;
    IF rate_ves<=0 OR usd_rate<=0 OR usdt_rate<=0 THEN RAISE EXCEPTION 'Freeze valid valuation rates' USING ERRCODE='PT400'; END IF;
    usd_value:=CASE row_data.moneda WHEN 'USD' THEN real_amount WHEN 'VES' THEN real_amount/usd_rate ELSE real_amount*usdt_rate/usd_rate END;
    -- Coherencia con la apertura y con el alta automática del cierre: el período
    -- de la cuenta arranca el día 1 del mes (p_mes_inicio), no el día del alta,
    -- para que los movimientos del mes fechados antes del alta cuenten en el
    -- saldo del período y en el cierre (saldoCalculado = saldoApertura + neto).
    INSERT INTO public.finanzas_periodos_mensuales_cuentas(cuenta_id,periodo_id,cuenta_custodia_id,moneda,metodo_apertura,
      fecha_inicio,fecha_verificacion,saldo_apertura,saldo_contado_apertura,tasa_ves,tasa_usd_ves,tasa_usdt_ves,saldo_apertura_usd,motivo_apertura,apertura_clave,operacion_hash)
    VALUES(p_cuenta_id,periodo.id,row_data.id,row_data.moneda,'alta_cuenta',p_mes_inicio,current_date,real_amount,real_amount,
      rate_ves,usd_rate,usdt_rate,usd_value,note,p_clave,hash);
    INSERT INTO public.auditoria(cuenta_id,usuario_id,usuario_nombre,usuario_rol,categoria,accion,entidad_tipo,entidad_id,meta,ip_origen)
      VALUES(p_cuenta_id,actor.id,actor.nombre,actor.rol,'FINANZAS','APERTURA_CUENTA_EN_MES','cuentas_custodia',row_data.id,
        jsonb_build_object('mes',p_mes_inicio,'saldo',real_amount,'moneda',row_data.moneda),nullif(p_ip,'')::inet);
    RETURN jsonb_build_object('ok',true,'idempotente',false,'cuentaCustodiaId',row_data.id,'saldoApertura',real_amount);
  END IF;

  IF p_mes_inicio<>(date_trunc('month',current_date)::date - interval '1 month')::date THEN
    RAISE EXCEPTION 'Only the previous month may be closed' USING ERRCODE='PT409';
  END IF;
  IF current_date<closing_day THEN RAISE EXCEPTION 'Month can only close after its last day' USING ERRCODE='PT409'; END IF;
  -- 4.4: en vez de bloquear el cierre, se da de alta automáticamente la
  -- apertura del mes (saldo calculado) para toda cuenta activa que falte.
  FOR row_data IN SELECT * FROM public.cuentas_custodia c WHERE c.cuenta_id=p_cuenta_id AND c.activo LOOP
    IF NOT EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales_cuentas x WHERE x.cuenta_id=p_cuenta_id
      AND x.periodo_id=periodo.id AND x.cuenta_custodia_id=row_data.id) THEN
      SELECT c.saldo_cierre_real INTO anterior FROM public.finanzas_periodos_mensuales p
        JOIN public.finanzas_periodos_mensuales_cuentas c ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id
        WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=(p_mes_inicio-interval '1 month')::date AND p.estado='cerrado'
          AND c.cuenta_custodia_id=row_data.id;
      IF anterior IS NULL THEN
        SELECT coalesce(sum(CASE WHEN m.tipo='ingreso' THEN m.monto ELSE -m.monto END),0) INTO neto
          FROM public.finanzas_movimientos m WHERE m.cuenta_id=p_cuenta_id AND m.cuenta_custodia_id=row_data.id
            AND m.estado='activo' AND m.fecha<p_mes_inicio;
        apertura:=neto;
      ELSE
        apertura:=anterior;
      END IF;
      rate_ves:=CASE row_data.moneda WHEN 'VES' THEN 1 WHEN 'USD' THEN 1 ELSE coalesce((p_payload->>'tasaUsdtVes')::numeric,0) END;
      usd_rate:=CASE row_data.moneda WHEN 'USD' THEN coalesce((p_payload->>'tasaUsdVes')::numeric,1) ELSE coalesce((p_payload->>'tasaUsdVes')::numeric,0) END;
      usdt_rate:=CASE row_data.moneda WHEN 'USDT' THEN rate_ves ELSE coalesce((p_payload->>'tasaUsdtVes')::numeric,1) END;
      IF rate_ves<=0 OR usd_rate<=0 OR usdt_rate<=0 THEN RAISE EXCEPTION 'Freeze valid closing valuation rates' USING ERRCODE='PT400'; END IF;
      usd_value:=CASE row_data.moneda WHEN 'USD' THEN apertura WHEN 'VES' THEN apertura/usd_rate ELSE apertura*usdt_rate/usd_rate END;
      INSERT INTO public.finanzas_periodos_mensuales_cuentas(cuenta_id,periodo_id,cuenta_custodia_id,moneda,metodo_apertura,
        fecha_inicio,fecha_verificacion,saldo_apertura,saldo_contado_apertura,diferencia_apertura,motivo_apertura,
        tasa_ves,tasa_usd_ves,tasa_usdt_ves,saldo_apertura_usd,apertura_clave,operacion_hash)
      VALUES(p_cuenta_id,periodo.id,row_data.id,row_data.moneda,'alta_cuenta',p_mes_inicio,current_date,apertura,NULL,0,
        'Alta automática al cerrar el mes',rate_ves,usd_rate,usdt_rate,usd_value,p_clave,hash);
      INSERT INTO public.auditoria(cuenta_id,usuario_id,usuario_nombre,usuario_rol,categoria,accion,entidad_tipo,entidad_id,meta,ip_origen)
        VALUES(p_cuenta_id,actor.id,actor.nombre,actor.rol,'FINANZAS','APERTURA_CUENTA_EN_MES','cuentas_custodia',row_data.id,
          jsonb_build_object('mes',p_mes_inicio,'saldo',apertura,'moneda',row_data.moneda,'automatico',true),nullif(p_ip,'')::inet);
    END IF;
  END LOOP;
  IF jsonb_typeof(p_payload->'cuentas') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'cuentas')=0 THEN
    RAISE EXCEPTION 'Closing balances are required for every wallet' USING ERRCODE='PT400';
  END IF;
  SELECT count(*) INTO cnt FROM public.finanzas_periodos_mensuales_cuentas WHERE cuenta_id=p_cuenta_id AND periodo_id=periodo.id;
  SELECT count(*) INTO monto FROM jsonb_array_elements(p_payload->'cuentas');
  IF cnt<>monto OR EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales_cuentas c WHERE c.cuenta_id=p_cuenta_id AND c.periodo_id=periodo.id
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'cuentas') e WHERE (e->>'cuentaCustodiaId')::uuid=c.cuenta_custodia_id))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'cuentas') e WHERE NOT EXISTS(
      SELECT 1 FROM public.finanzas_periodos_mensuales_cuentas c WHERE c.cuenta_id=p_cuenta_id AND c.periodo_id=periodo.id
        AND c.cuenta_custodia_id=(e->>'cuentaCustodiaId')::uuid)) THEN
    RAISE EXCEPTION 'Closing must include all opened wallets exactly once' USING ERRCODE='PT400';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'cuentas') LOOP
    SELECT c.* INTO row_data FROM public.finanzas_periodos_mensuales_cuentas c WHERE c.cuenta_id=p_cuenta_id
      AND c.periodo_id=periodo.id AND c.cuenta_custodia_id=(item->>'cuentaCustodiaId')::uuid FOR UPDATE;
    real_amount:=(item->>'saldoReal')::numeric; note:=nullif(btrim(item->>'motivo'),'');
    IF real_amount IS NULL OR real_amount<0 THEN RAISE EXCEPTION 'Closing balance must be zero or positive' USING ERRCODE='PT400'; END IF;
    SELECT coalesce(sum(CASE WHEN m.tipo='ingreso' THEN m.monto ELSE -m.monto END),0) INTO neto
      FROM public.finanzas_movimientos m WHERE m.cuenta_id=p_cuenta_id AND m.cuenta_custodia_id=row_data.cuenta_custodia_id
        AND m.estado='activo' AND m.fecha BETWEEN row_data.fecha_inicio AND closing_day;
    apertura:=row_data.saldo_apertura+neto; diff:=real_amount-apertura;
    -- 4.2: faltantes y sobrantes permitidos; el motivo documenta la diferencia.
    IF abs(diff)>0.000001 AND (note IS NULL OR length(note)<8 OR length(note)>300) THEN
      RAISE EXCEPTION 'Explain each closing difference' USING ERRCODE='PT400';
    END IF;
    rate_ves:=CASE row_data.moneda WHEN 'VES' THEN 1 WHEN 'USD' THEN 1 ELSE coalesce((item->>'tasaUsdtVes')::numeric,0) END;
    usd_rate:=CASE row_data.moneda WHEN 'USD' THEN coalesce((item->>'tasaUsdVes')::numeric,1) ELSE coalesce((item->>'tasaUsdVes')::numeric,0) END;
    usdt_rate:=CASE row_data.moneda WHEN 'USDT' THEN rate_ves ELSE coalesce((item->>'tasaUsdtVes')::numeric,1) END;
    IF rate_ves<=0 OR usd_rate<=0 OR usdt_rate<=0 THEN RAISE EXCEPTION 'Freeze valid closing valuation rates' USING ERRCODE='PT400'; END IF;
    usd_value:=CASE row_data.moneda WHEN 'USD' THEN real_amount WHEN 'VES' THEN real_amount/usd_rate ELSE real_amount*usdt_rate/usd_rate END;
    UPDATE public.finanzas_periodos_mensuales_cuentas SET saldo_cierre_libro=apertura,saldo_cierre_real=real_amount,
      diferencia_cierre=diff,motivo_cierre=note,tasa_cierre_ves=rate_ves,tasa_cierre_usd_ves=usd_rate,
      tasa_cierre_usdt_ves=usdt_rate,saldo_cierre_usd=usd_value,cierre_clave=p_clave
      WHERE id=row_data.id;
  END LOOP;
  UPDATE public.finanzas_periodos_mensuales SET estado='cerrado',cerrado_en=now(),cerrado_por=actor.id,
    cierre_clave=p_clave,cierre_hash=hash,ip_cierre=p_ip WHERE id=periodo.id;
  INSERT INTO public.auditoria(cuenta_id,usuario_id,usuario_nombre,usuario_rol,categoria,accion,entidad_tipo,entidad_id,meta,ip_origen)
    VALUES(p_cuenta_id,actor.id,actor.nombre,actor.rol,'FINANZAS','CIERRE_MENSUAL','finanzas_periodos_mensuales',periodo.id,
      jsonb_build_object('mes',p_mes_inicio,'cuentas',cnt),nullif(p_ip,'')::inet);
  RETURN public.finanzas_periodo_mensual_estado(p_cuenta_id,p_mes_inicio)||jsonb_build_object('ok',true,'idempotente',false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION 'Invalid monthly operation value' USING ERRCODE='PT400';
END;
$$;

COMMENT ON FUNCTION public.finanzas_periodo_mensual_operar(UUID,UUID,TEXT,DATE,TEXT,JSONB,TEXT) IS
  'Apertura/cierre mensuales simples (254): faltantes y sobrantes con motivo, apertura negativa solo con motivo, alta automática al cerrar.';

-- Privilegios idénticos a 253: RPC privado, solo service_role ejecuta.
REVOKE ALL ON FUNCTION public.finanzas_periodo_mensual_operar(UUID,UUID,TEXT,DATE,TEXT,JSONB,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finanzas_periodo_mensual_operar(UUID,UUID,TEXT,DATE,TEXT,JSONB,TEXT) TO service_role;

COMMIT;
