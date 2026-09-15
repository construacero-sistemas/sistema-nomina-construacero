-- Explicit classification only, never an inferred historical backfill.
BEGIN;
CREATE FUNCTION public.finanzas_asignar_custodia(p_cuenta_id UUID,p_operador_id UUID,p_ids UUID[],p_custodia_id UUID,p_ip TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.usuarios%ROWTYPE; target public.cuentas_custodia%ROWTYPE; ids UUID[]; changed INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(238,1);
  SELECT * INTO actor FROM public.usuarios WHERE id=p_operador_id AND cuenta_id=p_cuenta_id AND activo AND rol='administracion' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized operator' USING ERRCODE='PT403'; END IF;
  IF coalesce(cardinality(p_ids),0) NOT BETWEEN 1 AND 100 OR array_position(p_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Select one to one hundred entries' USING ERRCODE='PT400';
  END IF;
  SELECT array_agg(DISTINCT item ORDER BY item) INTO ids FROM unnest(p_ids) item;
  SELECT * INTO target FROM public.cuentas_custodia WHERE cuenta_id=p_cuenta_id AND id=p_custodia_id AND activo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Custody account not found' USING ERRCODE='PT404'; END IF;
  PERFORM id FROM public.finanzas_movimientos WHERE cuenta_id=p_cuenta_id AND id=ANY(ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.finanzas_movimientos WHERE cuenta_id=p_cuenta_id AND id=ANY(ids)) <> cardinality(ids) THEN
    RAISE EXCEPTION 'Some entries were not found' USING ERRCODE='PT404';
  END IF;
  IF EXISTS(SELECT 1 FROM public.finanzas_movimientos WHERE cuenta_id=p_cuenta_id AND id=ANY(ids) AND
    (estado<>'activo' OR operacion_id IS NOT NULL OR moneda<>target.moneda OR
    (cuenta_custodia_id IS NOT NULL AND cuenta_custodia_id<>target.id) OR (partes IS NOT NULL AND partes<>'[]'::jsonb))) THEN
    RAISE EXCEPTION 'Entry cannot be classified into this account' USING ERRCODE='PT409';
  END IF;
  UPDATE public.finanzas_movimientos SET cuenta_custodia_id=target.id,cuenta_origen=target.nombre
    WHERE cuenta_id=p_cuenta_id AND id=ANY(ids) AND cuenta_custodia_id IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed>0 THEN
    INSERT INTO public.auditoria(cuenta_id,usuario_id,usuario_nombre,usuario_rol,categoria,accion,entidad_tipo,entidad_id,meta,ip_origen)
      VALUES(p_cuenta_id,actor.id,actor.nombre,actor.rol,'FINANZAS','CUSTODIA_ASIGNADA','cuentas_custodia',target.id,
        jsonb_build_object('ids',ids,'actualizados',changed,'cuentaCustodiaId',target.id),nullif(p_ip,'')::inet);
  END IF;
  RETURN jsonb_build_object('ok',true,'actualizados',changed,'idempotente',changed=0,'cuentaCustodiaId',target.id);
END;
$$;
REVOKE ALL ON FUNCTION public.finanzas_asignar_custodia(UUID,UUID,UUID[],UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_asignar_custodia(UUID,UUID,UUID[],UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.finanzas_guard_custodia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE funds NUMERIC;
BEGIN
  IF NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id OR NEW.moneda IS DISTINCT FROM OLD.moneda OR
    NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.cartera IS DISTINCT FROM OLD.cartera OR NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION 'Custody identity and currency are immutable' USING ERRCODE='PT409';
  END IF;
  IF OLD.activo AND NOT NEW.activo THEN
    IF EXISTS(SELECT 1 FROM public.finanzas_movimientos WHERE cuenta_id=OLD.cuenta_id AND estado='activo' AND cuenta_custodia_id IS NULL) THEN
      RAISE EXCEPTION 'Reconcile unassigned entries before removing an account' USING ERRCODE='PT422';
    END IF;
    SELECT coalesce(sum(CASE WHEN tipo='ingreso' THEN monto ELSE -monto END),0) INTO funds
      FROM public.finanzas_movimientos WHERE cuenta_id=OLD.cuenta_id AND cuenta_custodia_id=OLD.id AND estado='activo';
    IF funds<>0 THEN RAISE EXCEPTION 'Account must have zero confirmed balance' USING ERRCODE='PT409'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.finanzas_guard_custodia() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
