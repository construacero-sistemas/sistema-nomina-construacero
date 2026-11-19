-- 269: al cerrar el período se marcan todos los recibos como pagados (sin pago aparte).
--
-- Regla del usuario (19/11/2026): «al cerrar se paga todo, no se paga aparte»;
-- «solo marcar pagado y ya; por ahora no debe pedir forma de pago ni nada extra».
--
-- La protección de la 238 (`finanzas_guard_nomina`) solo deja marcar recibos como
-- pagados dentro de una operación registrada (`finanzas_operaciones` + contexto de
-- la transacción). Esta función es esa operación, con el mismo candado global,
-- idempotencia y autor, pero SIN egreso en Finanzas ni forma de pago:
--   'cerrar'   período abierto o cerrado → todos los recibos sin pagar quedan
--              pagados (con la tasa del cierre si se envía) y el período «pagado».
--   'reabrir'  deshace un cierre hecho con 'cerrar': solo si ningún recibo del
--              período se pagó con la operación de pago de Finanzas (asignaciones).
--
-- Idempotente.

DO $$
DECLARE restriccion TEXT;
BEGIN
  SELECT conname INTO restriccion FROM pg_constraint
   WHERE conrelid = 'public.finanzas_operaciones'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%pagar_nomina%';
  IF restriccion IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.finanzas_operaciones DROP CONSTRAINT %I', restriccion);
  END IF;
  ALTER TABLE public.finanzas_operaciones ADD CONSTRAINT finanzas_operaciones_tipo_check
    CHECK (tipo IN ('pagar_nomina','revertir_nomina','traspaso','cerrar_nomina','reabrir_nomina'));
END $$;

CREATE OR REPLACE FUNCTION public.nomina_cerrar_marcar_pagado(
  p_cuenta_id UUID, p_operador_id UUID, p_periodo_id UUID, p_accion TEXT, p_clave TEXT,
  p_tasa_usd_ves NUMERIC DEFAULT NULL, p_ip TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE
  actor public.usuarios%ROWTYPE;
  operation public.finanzas_operaciones%ROWTYPE;
  periodo public.nomina_periodos%ROWTYPE;
  tipo_op TEXT;
  payload JSONB;
  hash TEXT;
  marcados INTEGER := 0;
  total NUMERIC := 0;
  outcome JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(238, 1);
  IF p_accion IS NULL OR p_accion NOT IN ('cerrar','reabrir')
    OR p_clave IS NULL OR p_clave !~ '^[A-Za-z0-9._:-]{16,128}$' OR p_periodo_id IS NULL THEN
    RAISE EXCEPTION 'Invalid operation envelope' USING ERRCODE = 'PT400';
  END IF;
  IF p_tasa_usd_ves IS NOT NULL AND (p_tasa_usd_ves <= 0 OR p_tasa_usd_ves > 10000000) THEN
    RAISE EXCEPTION 'Invalid rate' USING ERRCODE = 'PT400';
  END IF;
  SELECT * INTO actor FROM public.usuarios u WHERE u.id = p_operador_id
    AND u.cuenta_id = p_cuenta_id AND u.activo
    AND u.rol = ANY(public.roles_capacidad('administrarNomina'))
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized operator' USING ERRCODE = 'PT403'; END IF;

  tipo_op := CASE p_accion WHEN 'cerrar' THEN 'cerrar_nomina' ELSE 'reabrir_nomina' END;
  payload := jsonb_build_object('periodoId', p_periodo_id, 'tasaUsdVes', p_tasa_usd_ves);
  hash := encode(digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex');
  SELECT * INTO operation FROM public.finanzas_operaciones o
    WHERE o.cuenta_id = p_cuenta_id AND o.tipo = tipo_op AND o.clave = p_clave FOR UPDATE;
  IF FOUND THEN
    IF operation.payload_hash <> hash THEN RAISE EXCEPTION 'Idempotency payload conflict' USING ERRCODE = 'PT409'; END IF;
    RETURN operation.resultado;
  END IF;

  SELECT * INTO periodo FROM public.nomina_periodos p
    WHERE p.cuenta_id = p_cuenta_id AND p.id = p_periodo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Period not found' USING ERRCODE = 'PT404'; END IF;
  PERFORM l.id FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.periodo_id = p_periodo_id ORDER BY l.id FOR UPDATE;

  IF p_accion = 'cerrar' THEN
    IF periodo.estado NOT IN ('abierto','cerrado') THEN
      RAISE EXCEPTION 'Period already paid' USING ERRCODE = 'PT409';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.periodo_id = p_periodo_id) THEN
      RAISE EXCEPTION 'Period has no receipts' USING ERRCODE = 'PT409';
    END IF;
  ELSE
    IF periodo.estado <> 'pagado' THEN
      RAISE EXCEPTION 'Period is not closed and paid' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS(SELECT 1 FROM public.finanzas_nomina_asignaciones a
      JOIN public.nomina_lineas l ON l.cuenta_id = a.cuenta_id AND l.id = a.linea_id
      WHERE a.cuenta_id = p_cuenta_id AND l.periodo_id = p_periodo_id) THEN
      RAISE EXCEPTION 'Period has payments recorded in Finanzas; revert them first' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  INSERT INTO public.finanzas_operaciones(cuenta_id,tipo,clave,payload,payload_hash,operador_id,operador_nombre,operador_rol,ip_origen)
    VALUES(p_cuenta_id,tipo_op,p_clave,payload,hash,actor.id,actor.nombre,actor.rol,p_ip) RETURNING * INTO operation;
  INSERT INTO public.finanzas_operacion_contexto(transaction_id,cuenta_id,operacion_id)
    VALUES(txid_current(),p_cuenta_id,operation.id);

  IF p_accion = 'cerrar' THEN
    SELECT count(*), coalesce(sum(l.total_neto_usd),0) INTO marcados, total FROM public.nomina_lineas l
      WHERE l.cuenta_id = p_cuenta_id AND l.periodo_id = p_periodo_id AND NOT l.pagado;
    UPDATE public.nomina_lineas SET pagado = true, pagado_en = now(), pagado_por = actor.id,
      pagado_por_nombre = actor.nombre, referencia_pago = 'Marcado pagado al cerrar el período',
      tasa_pago_usd_ves = p_tasa_usd_ves,
      total_pagado_bs = CASE WHEN p_tasa_usd_ves IS NULL THEN NULL ELSE round(total_neto_usd * p_tasa_usd_ves, 2) END
      WHERE cuenta_id = p_cuenta_id AND periodo_id = p_periodo_id AND NOT pagado;
    UPDATE public.nomina_periodos SET estado = 'pagado',
      cerrado_en = coalesce(cerrado_en, now()), cerrado_por = coalesce(cerrado_por, actor.id)
      WHERE cuenta_id = p_cuenta_id AND id = p_periodo_id;
    outcome := jsonb_build_object('recibos_marcados', marcados, 'total_usd', total::text, 'operacionId', operation.id);
  ELSE
    SELECT count(*) INTO marcados FROM public.nomina_lineas l
      WHERE l.cuenta_id = p_cuenta_id AND l.periodo_id = p_periodo_id AND l.pagado;
    UPDATE public.nomina_lineas SET pagado = false, pagado_en = NULL, pagado_por = NULL, pagado_por_nombre = NULL,
      referencia_pago = NULL, tasa_pago_usd_ves = NULL, total_pagado_bs = NULL
      WHERE cuenta_id = p_cuenta_id AND periodo_id = p_periodo_id AND pagado;
    UPDATE public.nomina_periodos SET estado = 'abierto', cerrado_en = NULL, cerrado_por = NULL
      WHERE cuenta_id = p_cuenta_id AND id = p_periodo_id;
    outcome := jsonb_build_object('recibos_desmarcados', marcados, 'operacionId', operation.id);
  END IF;

  UPDATE public.finanzas_operaciones SET resultado = outcome WHERE id = operation.id;
  DELETE FROM public.finanzas_operacion_contexto WHERE transaction_id = txid_current();
  RETURN outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.nomina_cerrar_marcar_pagado(UUID,UUID,UUID,TEXT,TEXT,NUMERIC,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nomina_cerrar_marcar_pagado(UUID,UUID,UUID,TEXT,TEXT,NUMERIC,TEXT) TO service_role;
