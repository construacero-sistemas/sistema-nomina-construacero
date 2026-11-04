-- Saldo de hoy con el mes anterior todavía abierto (cierre pendiente).
-- Antes: si el mes en curso no tenía apertura y el anterior no estaba cerrado, el saldo
-- se calculaba solo con la suma de movimientos e ignoraba el saldo de apertura del mes
-- anterior. Ejemplo real: Cuenta Venezuela abrió octubre con 144.677,09 Bs; con octubre
-- pendiente de cierre la tarjeta mostraba 555.697,42 (solo movimientos) mientras el
-- cierre mensual mostraba 700.374,51 (apertura + movimientos).
-- Ahora, con el mes anterior abierto, el saldo es su apertura + todos los movimientos
-- desde su inicio hasta la fecha pedida, y el valor en USD parte de su apertura.
BEGIN;

CREATE OR REPLACE FUNCTION public.finanzas_saldo_periodo(p_cuenta_id UUID,p_custodia_id UUID,p_fecha DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='America/Caracas' AS $$
DECLARE v_inicio DATE:=date_trunc('month',p_fecha)::date; v_base DATE; v_saldo NUMERIC; v_cierre NUMERIC; v_estado TEXT;
BEGIN
  SELECT p.estado,c.fecha_inicio,c.saldo_apertura,c.saldo_cierre_real
    INTO v_estado,v_base,v_saldo,v_cierre
    FROM public.finanzas_periodos_mensuales p JOIN public.finanzas_periodos_mensuales_cuentas c
      ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id
    WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=v_inicio AND c.cuenta_custodia_id=p_custodia_id;
  IF FOUND THEN
    IF v_estado='cerrado' THEN RETURN v_cierre; END IF;
  ELSE
    SELECT c.saldo_cierre_real INTO v_saldo FROM public.finanzas_periodos_mensuales p
      JOIN public.finanzas_periodos_mensuales_cuentas c ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id
      WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=(v_inicio-interval '1 month')::date AND p.estado='cerrado'
        AND c.cuenta_custodia_id=p_custodia_id;
    IF FOUND THEN v_base:=v_inicio; ELSE
      -- Mes anterior abierto (cierre pendiente): su apertura sigue siendo la base del saldo.
      SELECT c.saldo_apertura,c.fecha_inicio INTO v_saldo,v_base FROM public.finanzas_periodos_mensuales p
        JOIN public.finanzas_periodos_mensuales_cuentas c ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id
        WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=(v_inicio-interval '1 month')::date AND p.estado='abierto'
          AND c.cuenta_custodia_id=p_custodia_id AND c.saldo_apertura IS NOT NULL;
      IF NOT FOUND THEN
        SELECT coalesce(sum(CASE WHEN m.tipo='ingreso' THEN m.monto ELSE -m.monto END),0),NULL
          INTO v_saldo,v_base FROM public.finanzas_movimientos m
          WHERE m.cuenta_id=p_cuenta_id AND m.cuenta_custodia_id=p_custodia_id AND m.estado='activo';
        RETURN v_saldo;
      END IF;
    END IF;
  END IF;
  RETURN coalesce(v_saldo,0)+coalesce((SELECT sum(CASE WHEN m.tipo='ingreso' THEN m.monto ELSE -m.monto END)
    FROM public.finanzas_movimientos m WHERE m.cuenta_id=p_cuenta_id AND m.cuenta_custodia_id=p_custodia_id
      AND m.estado='activo' AND m.fecha>=v_base AND m.fecha<=p_fecha),0);
END;
$$;

CREATE OR REPLACE FUNCTION public.finanzas_saldos(p_cuenta_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='America/Caracas' AS $$
DECLARE result JSONB; item JSONB; accounts JSONB:='[]'::jsonb; amount NUMERIC; usd_value NUMERIC; base_usd NUMERIC;
  usd_rate NUMERIC; usdt_rate NUMERIC; has_opening BOOLEAN; month_start DATE:=date_trunc('month',current_date)::date; pending BOOLEAN;
  base_month DATE; wallet UUID;
BEGIN
  result:=public.finanzas_saldos_historicos(p_cuenta_id);
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(result->'cuentas','[]'::jsonb)) LOOP
    wallet:=(item->>'cuentaCustodiaId')::uuid;
    amount:=public.finanzas_saldo_periodo(p_cuenta_id,wallet,current_date);
    base_usd:=NULL; usd_rate:=NULL; usdt_rate:=NULL; base_month:=NULL;
    -- Base de la valoración USD: la apertura del mes en curso; si el mes en curso no está
    -- abierto y el anterior sigue abierto (cierre pendiente), la apertura de ese mes.
    SELECT p.mes_inicio,c.saldo_apertura_usd,c.tasa_usd_ves,c.tasa_usdt_ves INTO base_month,base_usd,usd_rate,usdt_rate
      FROM public.finanzas_periodos_mensuales p JOIN public.finanzas_periodos_mensuales_cuentas c
        ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id
      WHERE p.cuenta_id=p_cuenta_id AND p.estado='abierto' AND c.cuenta_custodia_id=wallet AND c.saldo_apertura IS NOT NULL
        AND (p.mes_inicio=month_start OR (p.mes_inicio=(month_start-interval '1 month')::date
          AND NOT EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales x WHERE x.cuenta_id=p_cuenta_id AND x.mes_inicio=month_start)))
      ORDER BY p.mes_inicio DESC LIMIT 1;
    has_opening:=FOUND;
    IF has_opening THEN
      SELECT coalesce(sum(CASE WHEN m.tipo='ingreso' THEN 1 ELSE -1 END * CASE WHEN m.moneda='USD' THEN m.monto
        WHEN m.moneda IN ('VES','USDT') AND m.tasa_registrada_en IS NOT NULL AND m.tasa_ves>0 AND m.tasa_usd_ves>0 THEN m.monto_ves/m.tasa_usd_ves
        WHEN m.moneda='VES' AND usd_rate>0 THEN m.monto/usd_rate
        WHEN m.moneda='USDT' AND usd_rate>0 AND usdt_rate>0 THEN m.monto*usdt_rate/usd_rate
        ELSE 0 END),0)
        INTO usd_value FROM public.finanzas_movimientos m WHERE m.cuenta_id=p_cuenta_id
          AND m.cuenta_custodia_id=wallet AND m.estado='activo'
          AND m.fecha>=base_month AND m.fecha<=current_date;
      usd_value:=base_usd+usd_value;
    ELSE
      usd_value:=nullif(item->>'valorUsd','')::numeric;
    END IF;
    accounts:=accounts||jsonb_build_array(item||jsonb_build_object('saldoNativo',round(amount,6)::text,
      'valorUsd',CASE WHEN usd_value IS NULL THEN NULL ELSE round(usd_value,6)::text END,
      'disponible',(item->>'activo')::boolean AND coalesce((result->>'conciliacionPendiente')::boolean,false)=false AND amount>=0));
  END LOOP;
  result:=jsonb_set(result,'{cuentas}',accounts,true);
  SELECT EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales p WHERE p.cuenta_id=p_cuenta_id
    AND p.mes_inicio=month_start AND p.estado='abierto' AND EXISTS(SELECT 1 FROM public.cuentas_custodia a
      WHERE a.cuenta_id=p_cuenta_id AND a.activo AND NOT EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales_cuentas c
        WHERE c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id AND c.cuenta_custodia_id=a.id))) INTO pending;
  RETURN jsonb_set(result,'{periodoMensual}',jsonb_build_object('mes',month_start,'aperturado',pending,
    'estado',CASE WHEN EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales p WHERE p.cuenta_id=p_cuenta_id
      AND p.mes_inicio=month_start AND p.estado='abierto') THEN 'abierto'
      ELSE coalesce((SELECT p.estado FROM public.finanzas_periodos_mensuales p
        WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=month_start),'sin_apertura') END,
    'cuentasPendientes',coalesce((SELECT jsonb_agg(a.id ORDER BY a.id) FROM public.cuentas_custodia a
      WHERE a.cuenta_id=p_cuenta_id AND a.activo AND EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales p
        WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=month_start AND p.estado='abierto')
        AND NOT EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales_cuentas c JOIN public.finanzas_periodos_mensuales p
          ON p.cuenta_id=c.cuenta_id AND p.id=c.periodo_id WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=month_start
          AND c.cuenta_custodia_id=a.id)),'[]'::jsonb)),true);
END;
$$;

REVOKE ALL ON FUNCTION public.finanzas_saldo_periodo(UUID,UUID,DATE) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finanzas_saldos(UUID) FROM PUBLIC,anon,authenticated;
COMMIT;
