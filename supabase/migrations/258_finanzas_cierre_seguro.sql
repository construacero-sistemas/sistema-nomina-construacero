-- Cierre mensual más seguro (auditoría de finanzas, 2026-11-01).
--  1. Las funciones del período mensual cuentan "hoy" en hora de Caracas, no en UTC:
--     de 8 pm a medianoche del último día del mes la base ya creía estar en el mes
--     siguiente (permitía cerrar antes de tiempo y bloqueaba los movimientos de esas horas).
--  2. Un mes cerrado es inmutable también en sus campos descriptivos (fecha, categoría,
--     concepto, referencia, observaciones, método de pago, cuenta y tramos): el trigger
--     de saldos solo vigilaba monto, cuenta, tipo, moneda y estado, así que el detalle de
--     un cierre podía cambiar después de emitido.
--  3. Reabrir el último mes cerrado (solo mientras sea el mes anterior y el siguiente no
--     esté abierto), con motivo obligatorio y auditoría que conserva los saldos del cierre.
BEGIN;

ALTER FUNCTION public.finanzas_saldo_periodo(UUID,UUID,DATE) SET timezone = 'America/Caracas';
ALTER FUNCTION public.finanzas_periodo_mensual_estado(UUID,DATE) SET timezone = 'America/Caracas';
ALTER FUNCTION public.finanzas_periodo_mensual_operar(UUID,UUID,TEXT,DATE,TEXT,JSONB,TEXT) SET timezone = 'America/Caracas';
ALTER FUNCTION public.finanzas_saldos(UUID) SET timezone = 'America/Caracas';
ALTER FUNCTION public.finanzas_guard_saldo_movement() SET timezone = 'America/Caracas';

CREATE OR REPLACE FUNCTION public.finanzas_cierre_campos_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF (OLD.fecha,OLD.categoria,OLD.concepto,OLD.referencia,OLD.observaciones,OLD.metodo_pago,OLD.cuenta_origen,OLD.partes::text)
     IS NOT DISTINCT FROM
     (NEW.fecha,NEW.categoria,NEW.concepto,NEW.referencia,NEW.observaciones,NEW.metodo_pago,NEW.cuenta_origen,NEW.partes::text) THEN
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales p WHERE p.cuenta_id=OLD.cuenta_id AND p.estado='cerrado'
    AND p.mes_inicio IN (date_trunc('month',OLD.fecha)::date,date_trunc('month',NEW.fecha)::date)) THEN
    RAISE EXCEPTION 'Closed monthly ledger is immutable' USING ERRCODE='PT409';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS finanzas_cierre_campos_guard ON public.finanzas_movimientos;
CREATE TRIGGER finanzas_cierre_campos_guard
BEFORE UPDATE OF fecha,categoria,concepto,referencia,observaciones,metodo_pago,cuenta_origen,partes ON public.finanzas_movimientos
FOR EACH ROW EXECUTE FUNCTION public.finanzas_cierre_campos_guard();

CREATE OR REPLACE FUNCTION public.finanzas_periodo_mensual_reabrir(
  p_cuenta_id UUID,p_operador_id UUID,p_mes_inicio DATE,p_motivo TEXT,p_ip TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='America/Caracas' AS $$
DECLARE actor public.usuarios%ROWTYPE; periodo public.finanzas_periodos_mensuales%ROWTYPE; note TEXT; previo JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_operador_id IS NULL OR p_mes_inicio IS NULL OR extract(day FROM p_mes_inicio)<>1 THEN
    RAISE EXCEPTION 'Invalid monthly reopen' USING ERRCODE='PT400';
  END IF;
  note:=btrim(coalesce(p_motivo,''));
  IF length(note)<8 OR length(note)>300 THEN RAISE EXCEPTION 'Explain why the month is reopened' USING ERRCODE='PT400'; END IF;
  PERFORM pg_advisory_xact_lock(238,1);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cuenta_id::text,251));
  SELECT * INTO actor FROM public.usuarios u WHERE u.id=p_operador_id AND u.cuenta_id=p_cuenta_id AND u.activo
    AND u.rol=ANY(public.roles_capacidad('gestionarUsuarios')) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized operator' USING ERRCODE='PT403'; END IF;
  SELECT * INTO periodo FROM public.finanzas_periodos_mensuales WHERE cuenta_id=p_cuenta_id AND mes_inicio=p_mes_inicio FOR UPDATE;
  IF NOT FOUND OR periodo.estado<>'cerrado' THEN RAISE EXCEPTION 'Month is not closed' USING ERRCODE='PT409'; END IF;
  IF p_mes_inicio<>(date_trunc('month',current_date)::date - interval '1 month')::date THEN
    RAISE EXCEPTION 'Only the previous month may be reopened' USING ERRCODE='PT409';
  END IF;
  IF EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales p WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio>p_mes_inicio) THEN
    RAISE EXCEPTION 'A later month is already opened' USING ERRCODE='PT409';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('cuentaCustodiaId',c.cuenta_custodia_id,'moneda',c.moneda,
    'saldoCierreLibro',c.saldo_cierre_libro,'saldoCierreReal',c.saldo_cierre_real,'diferencia',c.diferencia_cierre,
    'motivo',c.motivo_cierre,'saldoCierreUsd',c.saldo_cierre_usd) ORDER BY c.cuenta_custodia_id),'[]'::jsonb) INTO previo
    FROM public.finanzas_periodos_mensuales_cuentas c WHERE c.cuenta_id=p_cuenta_id AND c.periodo_id=periodo.id;
  UPDATE public.finanzas_periodos_mensuales_cuentas SET saldo_cierre_libro=NULL,saldo_cierre_real=NULL,diferencia_cierre=NULL,
    motivo_cierre=NULL,tasa_cierre_ves=NULL,tasa_cierre_usd_ves=NULL,tasa_cierre_usdt_ves=NULL,saldo_cierre_usd=NULL,cierre_clave=NULL
    WHERE cuenta_id=p_cuenta_id AND periodo_id=periodo.id;
  UPDATE public.finanzas_periodos_mensuales SET estado='abierto',cerrado_en=NULL,cerrado_por=NULL,cierre_clave=NULL,
    cierre_hash=NULL,ip_cierre=NULL WHERE id=periodo.id;
  INSERT INTO public.auditoria(cuenta_id,usuario_id,usuario_nombre,usuario_rol,categoria,accion,entidad_tipo,entidad_id,meta,ip_origen)
    VALUES(p_cuenta_id,actor.id,actor.nombre,actor.rol,'FINANZAS','CIERRE_MENSUAL_REABIERTO','finanzas_periodos_mensuales',periodo.id,
      jsonb_build_object('mes',p_mes_inicio,'motivo',note,'cierreAnterior',previo,'cerradoEnOriginal',periodo.cerrado_en),nullif(p_ip,'')::inet);
  RETURN public.finanzas_periodo_mensual_estado(p_cuenta_id,p_mes_inicio)||jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.finanzas_cierre_campos_guard(),
  public.finanzas_periodo_mensual_reabrir(UUID,UUID,DATE,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finanzas_periodo_mensual_reabrir(UUID,UUID,DATE,TEXT,TEXT) TO service_role;
COMMIT;
