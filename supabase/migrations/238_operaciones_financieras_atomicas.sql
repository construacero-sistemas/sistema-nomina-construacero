-- Atomic operations are service-only. Historical rows are never inferred or repaired.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_custodia_tenant_id ON public.cuentas_custodia(cuenta_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_linea_tenant_id ON public.nomina_lineas(cuenta_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_finanzas_movimiento_tenant_id ON public.finanzas_movimientos(cuenta_id, id);

CREATE TABLE public.finanzas_operaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id UUID NOT NULL REFERENCES auth.users(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('pagar_nomina','revertir_nomina','traspaso')),
  clave TEXT NOT NULL CHECK (clave ~ '^[A-Za-z0-9._:-]{16,128}$'),
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  operador_id UUID NOT NULL REFERENCES public.usuarios(id),
  operador_nombre TEXT NOT NULL,
  operador_rol TEXT NOT NULL,
  ip_origen TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  resultado JSONB,
  UNIQUE(cuenta_id, tipo, clave),
  UNIQUE(cuenta_id, id)
);

-- NULL for pre-existing rows: historical backfills are not rate evidence.
ALTER TABLE public.finanzas_movimientos
  ADD COLUMN tasa_registrada_en TIMESTAMPTZ,
  ADD COLUMN cuenta_custodia_id UUID,
  ADD COLUMN operacion_id UUID,
  ADD CONSTRAINT finanzas_custodia_tenant_fk FOREIGN KEY (cuenta_id, cuenta_custodia_id)
    REFERENCES public.cuentas_custodia(cuenta_id, id),
  ADD CONSTRAINT finanzas_operacion_tenant_fk FOREIGN KEY (cuenta_id, operacion_id)
    REFERENCES public.finanzas_operaciones(cuenta_id, id),
  ADD CONSTRAINT finanzas_operacion_custodia_required CHECK (operacion_id IS NULL OR cuenta_custodia_id IS NOT NULL);
CREATE INDEX idx_finanzas_custodia_ledger ON public.finanzas_movimientos(cuenta_id, cuenta_custodia_id, moneda, estado);
CREATE INDEX idx_finanzas_operacion ON public.finanzas_movimientos(cuenta_id, operacion_id);

CREATE TABLE public.finanzas_nomina_asignaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id UUID NOT NULL REFERENCES auth.users(id),
  operacion_id UUID NOT NULL,
  linea_id UUID NOT NULL,
  movimiento_id UUID,
  cuenta_custodia_id UUID NOT NULL,
  monto_usd NUMERIC(18,6) NOT NULL CHECK (monto_usd >= 0),
  monto_nativo NUMERIC(18,6) NOT NULL CHECK (monto_nativo >= 0),
  moneda TEXT NOT NULL CHECK (moneda IN ('USD','VES','USDT')),
  tasa_ves NUMERIC(24,8) NOT NULL CHECK (tasa_ves > 0),
  tasa_usd_ves NUMERIC(24,8) NOT NULL CHECK (tasa_usd_ves > 0),
  fuente_tasa TEXT NOT NULL,
  observacion_tasa TEXT,
  tasa_observada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  metodo_pago TEXT NOT NULL,
  revertida_por_operacion_id UUID,
  revertida_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (cuenta_id, operacion_id) REFERENCES public.finanzas_operaciones(cuenta_id, id),
  FOREIGN KEY (cuenta_id, revertida_por_operacion_id) REFERENCES public.finanzas_operaciones(cuenta_id, id),
  FOREIGN KEY (cuenta_id, linea_id) REFERENCES public.nomina_lineas(cuenta_id, id),
  FOREIGN KEY (cuenta_id, movimiento_id) REFERENCES public.finanzas_movimientos(cuenta_id, id),
  FOREIGN KEY (cuenta_id, cuenta_custodia_id) REFERENCES public.cuentas_custodia(cuenta_id, id),
  UNIQUE(cuenta_id, operacion_id, linea_id),
  UNIQUE(cuenta_id, movimiento_id),
  CHECK ((monto_usd = 0 AND monto_nativo = 0 AND movimiento_id IS NULL)
      OR (monto_usd > 0 AND monto_nativo > 0 AND movimiento_id IS NOT NULL)),
  CHECK ((revertida_por_operacion_id IS NULL) = (revertida_en IS NULL))
);
CREATE UNIQUE INDEX uq_nomina_asignacion_activa ON public.finanzas_nomina_asignaciones(cuenta_id, linea_id)
  WHERE revertida_por_operacion_id IS NULL;

CREATE TABLE public.finanzas_libro_version (
  cuenta_id UUID PRIMARY KEY REFERENCES auth.users(id),
  version BIGINT NOT NULL DEFAULT 0
);
-- A protected transaction context cannot be forged with set_config by an API client.
-- Only the SECURITY DEFINER operation function inserts it; successful commits remove it.
CREATE TABLE public.finanzas_operacion_contexto (
  transaction_id BIGINT PRIMARY KEY,
  cuenta_id UUID NOT NULL,
  operacion_id UUID NOT NULL,
  FOREIGN KEY (cuenta_id, operacion_id) REFERENCES public.finanzas_operaciones(cuenta_id, id)
);

ALTER TABLE public.finanzas_operaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finanzas_nomina_asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finanzas_libro_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finanzas_operacion_contexto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finanzas_operaciones, public.finanzas_nomina_asignaciones,
  public.finanzas_libro_version, public.finanzas_operacion_contexto FROM PUBLIC, anon, authenticated, service_role;

-- Acquire before any row locks, including legacy REST writers. Global serialization
-- is intentionally conservative; replacing it with tenant locks needs all writers upgraded.
CREATE FUNCTION public.finanzas_lock_escritura() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(238, 1);
  RETURN NULL;
END;
$$;
CREATE TRIGGER finanzas_lock_statement BEFORE INSERT OR UPDATE OR DELETE ON public.finanzas_movimientos
  FOR EACH STATEMENT EXECUTE FUNCTION public.finanzas_lock_escritura();
CREATE TRIGGER nomina_lineas_lock_statement BEFORE INSERT OR UPDATE OR DELETE ON public.nomina_lineas
  FOR EACH STATEMENT EXECUTE FUNCTION public.finanzas_lock_escritura();
CREATE TRIGGER nomina_periodos_lock_statement BEFORE INSERT OR UPDATE OR DELETE ON public.nomina_periodos
  FOR EACH STATEMENT EXECUTE FUNCTION public.finanzas_lock_escritura();
CREATE TRIGGER custodia_lock_statement BEFORE INSERT OR UPDATE OR DELETE ON public.cuentas_custodia
  FOR EACH STATEMENT EXECUTE FUNCTION public.finanzas_lock_escritura();

CREATE FUNCTION public.finanzas_guard_movimiento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  tenant UUID;
  context_operation UUID;
  currency TEXT;
  accounting_changed BOOLEAN := true;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The server records evidence at insertion, never a client-supplied date.
    NEW.tasa_registrada_en := CASE WHEN NEW.tasa_ves > 0 AND NEW.tasa_usd_ves > 0
      THEN statement_timestamp() ELSE NULL END;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.tasa_registrada_en := CASE
      WHEN NEW.tasa_ves IS DISTINCT FROM OLD.tasa_ves OR NEW.tasa_usd_ves IS DISTINCT FROM OLD.tasa_usd_ves THEN NULL
      ELSE OLD.tasa_registrada_en END;
    accounting_changed := ROW(NEW.monto, NEW.tipo, NEW.moneda, NEW.cuenta_custodia_id, NEW.cuenta_id, NEW.estado)
      IS DISTINCT FROM ROW(OLD.monto, OLD.tipo, OLD.moneda, OLD.cuenta_custodia_id, OLD.cuenta_id, OLD.estado);
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.estado = 'activo' AND accounting_changed
    AND EXISTS(SELECT 1 FROM public.cuentas_custodia c
      WHERE c.cuenta_id = OLD.cuenta_id AND c.id = OLD.cuenta_custodia_id AND NOT c.activo) THEN
    RAISE EXCEPTION 'Restore custody account before changing its balance' USING ERRCODE = 'PT409';
  END IF;
  IF TG_OP = 'DELETE' THEN tenant := OLD.cuenta_id; ELSE tenant := NEW.cuenta_id; END IF;
  SELECT c.operacion_id INTO context_operation FROM public.finanzas_operacion_contexto c
    WHERE c.transaction_id = txid_current() AND c.cuenta_id = tenant;
  IF TG_OP <> 'INSERT' THEN
    IF OLD.operacion_id IS NOT NULL AND (context_operation IS NULL OR TG_OP = 'DELETE') THEN
      RAISE EXCEPTION 'Linked entries can only change through their financial operation' USING ERRCODE = 'PT409';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id THEN
      RAISE EXCEPTION 'Ledger tenant is immutable' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.operacion_id IS NOT NULL AND context_operation IS NULL THEN
      RAISE EXCEPTION 'Operation entries require protected transaction context' USING ERRCODE = 'PT409';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.operacion_id IS DISTINCT FROM context_operation AND context_operation IS NOT NULL THEN
      RAISE EXCEPTION 'Operation entry context mismatch' USING ERRCODE = 'PT409';
    END IF;
    IF NEW.cuenta_custodia_id IS NOT NULL THEN
      SELECT c.moneda INTO currency FROM public.cuentas_custodia c
        WHERE c.cuenta_id = tenant AND c.id = NEW.cuenta_custodia_id
          AND (NEW.estado <> 'activo' OR c.activo OR (TG_OP = 'UPDATE' AND NOT accounting_changed));
      IF currency IS DISTINCT FROM NEW.moneda THEN
        RAISE EXCEPTION 'Custody currency mismatch' USING ERRCODE = 'PT400';
      END IF;
      IF NEW.partes IS NOT NULL AND NEW.partes <> '[]'::jsonb THEN
        RAISE EXCEPTION 'Split legacy entries require reconciliation' USING ERRCODE = 'PT422';
      END IF;
    END IF;
  END IF;
  INSERT INTO public.finanzas_libro_version(cuenta_id, version) VALUES(tenant, 1)
    ON CONFLICT(cuenta_id) DO UPDATE SET version = public.finanzas_libro_version.version + 1;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finanzas_movimiento_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.finanzas_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_guard_movimiento();

CREATE FUNCTION public.finanzas_guard_nomina() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  tenant UUID;
  period_id UUID;
  period_state TEXT;
  trusted BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN tenant := OLD.cuenta_id; ELSE tenant := NEW.cuenta_id; END IF;
  SELECT EXISTS(SELECT 1 FROM public.finanzas_operacion_contexto c
    WHERE c.transaction_id = txid_current() AND c.cuenta_id = tenant) INTO trusted;
  IF TG_OP = 'UPDATE' AND NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id THEN
    RAISE EXCEPTION 'Payroll tenant is immutable' USING ERRCODE = 'PT409';
  END IF;
  IF TG_TABLE_NAME = 'nomina_lineas' THEN
    IF TG_OP = 'DELETE' THEN period_id := OLD.periodo_id; ELSE period_id := NEW.periodo_id; END IF;
    IF TG_OP = 'UPDATE' AND NEW.periodo_id IS DISTINCT FROM OLD.periodo_id THEN
      RAISE EXCEPTION 'Receipt period is immutable' USING ERRCODE = 'PT409';
    END IF;
    SELECT p.estado INTO period_state FROM public.nomina_periodos p
      WHERE p.cuenta_id = tenant AND p.id = period_id FOR UPDATE;
    IF NOT trusted THEN
      IF period_state IS DISTINCT FROM 'abierto'
        OR (TG_OP <> 'INSERT' AND OLD.pagado)
        OR (TG_OP <> 'DELETE' AND NEW.pagado) THEN
        RAISE EXCEPTION 'Paid or closed payroll cannot be modified outside its operation' USING ERRCODE = 'PT409';
      END IF;
    END IF;
  ELSIF NOT trusted THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.estado <> 'abierto' THEN RAISE EXCEPTION 'New period must be open' USING ERRCODE = 'PT409'; END IF;
    ELSE
      IF OLD.estado = 'pagado' OR (TG_OP = 'UPDATE' AND NEW.estado = 'pagado')
        OR EXISTS(SELECT 1 FROM public.nomina_lineas l WHERE l.cuenta_id = tenant AND l.periodo_id = OLD.id AND l.pagado) THEN
        RAISE EXCEPTION 'Paid period requires a payroll operation' USING ERRCODE = 'PT409';
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.estado = 'cerrado'
        AND (to_jsonb(NEW) - ARRAY['estado','cerrado_en','cerrado_por']) IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['estado','cerrado_en','cerrado_por']) THEN
        RAISE EXCEPTION 'Closed period is immutable' USING ERRCODE = 'PT409';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nomina_linea_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.nomina_lineas
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_guard_nomina();
CREATE TRIGGER nomina_periodo_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.nomina_periodos
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_guard_nomina();

CREATE FUNCTION public.finanzas_guard_custodia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id OR
    (NEW.moneda IS DISTINCT FROM OLD.moneda AND EXISTS(
      SELECT 1 FROM public.finanzas_movimientos m WHERE m.cuenta_id = OLD.cuenta_id AND m.cuenta_custodia_id = OLD.id)) THEN
    RAISE EXCEPTION 'Custody tenant or ledger currency is immutable' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER custodia_operation_guard BEFORE UPDATE ON public.cuentas_custodia
  FOR EACH ROW EXECUTE FUNCTION public.finanzas_guard_custodia();

CREATE FUNCTION public.finanzas_operar(
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
        pagado_por_nombre = actor.nombre,referencia_pago = reference WHERE cuenta_id = p_cuenta_id AND id = receipt.id;
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
    UPDATE public.nomina_lineas SET pagado = false,pagado_en = NULL,pagado_por = NULL,pagado_por_nombre = NULL,referencia_pago = NULL
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

-- Deferred checks validate the committed receipt/assignment/entry relation, not
-- intermediate update order inside the RPC. Zero-value receipts have no ledger row.
CREATE FUNCTION public.finanzas_check_asignacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  a public.finanzas_nomina_asignaciones%ROWTYPE;
  l public.nomina_lineas%ROWTYPE;
  m public.finanzas_movimientos%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.finanzas_nomina_asignaciones WHERE cuenta_id = NEW.cuenta_id AND id = NEW.id;
  SELECT * INTO l FROM public.nomina_lineas WHERE cuenta_id = a.cuenta_id AND id = a.linea_id;
  IF a.revertida_por_operacion_id IS NULL AND (NOT l.pagado OR l.total_neto_usd <> a.monto_usd) THEN
    RAISE EXCEPTION 'Receipt and active assignment differ' USING ERRCODE = 'PT409';
  END IF;
  IF a.movimiento_id IS NOT NULL THEN
    SELECT * INTO m FROM public.finanzas_movimientos WHERE cuenta_id = a.cuenta_id AND id = a.movimiento_id;
    IF m.operacion_id IS DISTINCT FROM a.operacion_id OR m.cuenta_custodia_id IS DISTINCT FROM a.cuenta_custodia_id
      OR m.monto IS DISTINCT FROM a.monto_nativo OR m.moneda IS DISTINCT FROM a.moneda OR m.tipo <> 'egreso'
      OR m.tasa_ves IS DISTINCT FROM a.tasa_ves OR m.tasa_usd_ves IS DISTINCT FROM a.tasa_usd_ves
      OR m.estado IS DISTINCT FROM (CASE WHEN a.revertida_por_operacion_id IS NULL THEN 'activo' ELSE 'anulado' END) THEN
      RAISE EXCEPTION 'Payroll assignment and ledger entry differ' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER finanzas_asignacion_commit_check AFTER INSERT OR UPDATE ON public.finanzas_nomina_asignaciones
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.finanzas_check_asignacion();

CREATE FUNCTION public.finanzas_check_operacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.finanzas_operaciones%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.finanzas_operaciones WHERE cuenta_id = NEW.cuenta_id AND id = NEW.id;
  IF o.resultado IS NULL OR o.resultado->>'estado' IS DISTINCT FROM 'confirmada'
    OR EXISTS(SELECT 1 FROM public.finanzas_operacion_contexto c WHERE c.cuenta_id = o.cuenta_id AND c.operacion_id = o.id)
    OR NOT EXISTS(SELECT 1 FROM public.auditoria a WHERE a.cuenta_id = o.cuenta_id AND a.entidad_tipo = 'finanzas_operacion' AND a.entidad_id = o.id) THEN
    RAISE EXCEPTION 'Incomplete financial operation cannot commit' USING ERRCODE = 'PT409';
  END IF;
  IF o.tipo = 'traspaso' AND (
    (SELECT count(*) FROM public.finanzas_movimientos m WHERE m.cuenta_id = o.cuenta_id AND m.operacion_id = o.id) <> 2
    OR (SELECT count(DISTINCT m.tipo) FROM public.finanzas_movimientos m WHERE m.cuenta_id = o.cuenta_id AND m.operacion_id = o.id) <> 2) THEN
    RAISE EXCEPTION 'Transfer requires exactly two opposite entries' USING ERRCODE = 'PT409';
  END IF;
  IF o.tipo = 'pagar_nomina' AND (SELECT count(*) FROM public.finanzas_nomina_asignaciones a
    WHERE a.cuenta_id = o.cuenta_id AND a.operacion_id = o.id) <> jsonb_array_length(o.payload->'lineaIds') THEN
    RAISE EXCEPTION 'Every paid receipt requires an assignment' USING ERRCODE = 'PT409';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER finanzas_operacion_commit_check AFTER INSERT OR UPDATE ON public.finanzas_operaciones
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.finanzas_check_operacion();

CREATE FUNCTION public.finanzas_operacion_estado(p_cuenta_id UUID,p_tipo TEXT,p_clave TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT o.resultado FROM public.finanzas_operaciones o
    WHERE o.cuenta_id = p_cuenta_id AND o.tipo = p_tipo AND (o.clave = p_clave OR o.id::text = p_clave)
    ORDER BY (o.clave = p_clave) DESC LIMIT 1),
    jsonb_build_object('estado','no_encontrada','tipo',p_tipo,'idempotencyKey',p_clave));
$$;

CREATE FUNCTION public.finanzas_saldos(p_cuenta_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH ledger AS (
    SELECT m.*, CASE WHEN m.tipo = 'ingreso' THEN m.monto ELSE -m.monto END AS native_amount,
      CASE WHEN m.moneda = 'USD' THEN (CASE WHEN m.tipo = 'ingreso' THEN m.monto ELSE -m.monto END)
        WHEN m.cuenta_custodia_id IS NOT NULL AND m.tasa_registrada_en IS NOT NULL
          AND m.tasa_ves > 0 AND m.tasa_usd_ves > 0 THEN
          (CASE WHEN m.tipo = 'ingreso' THEN m.monto_ves ELSE -m.monto_ves END) / m.tasa_usd_ves
        ELSE NULL END AS usd_amount
    FROM public.finanzas_movimientos m WHERE m.cuenta_id = p_cuenta_id AND m.estado = 'activo'
  ), quality AS (
    SELECT EXISTS(SELECT 1 FROM ledger WHERE cuenta_custodia_id IS NULL OR (partes IS NOT NULL AND partes <> '[]'::jsonb))
      OR EXISTS(SELECT 1 FROM public.nomina_lineas l WHERE l.cuenta_id = p_cuenta_id AND l.pagado AND NOT EXISTS(
        SELECT 1 FROM public.finanzas_nomina_asignaciones a WHERE a.cuenta_id = p_cuenta_id AND a.linea_id = l.id AND a.revertida_por_operacion_id IS NULL)) AS pending
  ), accounts AS (
    SELECT c.id,c.nombre,c.moneda,c.activo,coalesce(sum(l.native_amount),0) AS amount,
      coalesce(sum(l.usd_amount),0) AS usd_amount,count(l.id) FILTER(WHERE l.usd_amount IS NULL) = 0 AS valued
    FROM public.cuentas_custodia c LEFT JOIN ledger l ON l.cuenta_custodia_id = c.id AND l.moneda = c.moneda
    WHERE c.cuenta_id = p_cuenta_id GROUP BY c.id,c.nombre,c.moneda,c.activo
  ), unassigned AS (
    SELECT moneda,sum(native_amount) AS amount,count(*) AS entries FROM ledger WHERE cuenta_custodia_id IS NULL GROUP BY moneda
  )
  SELECT jsonb_build_object('schemaVersion',1,'corte',statement_timestamp(),
    'versionLibro',coalesce((SELECT version::text FROM public.finanzas_libro_version WHERE cuenta_id = p_cuenta_id),'0'),
    'conciliacionPendiente',(SELECT pending FROM quality),
    'cuentas',coalesce((SELECT jsonb_agg(jsonb_build_object('cuentaCustodiaId',a.id,'nombre',a.nombre,'moneda',a.moneda,'activo',a.activo,
      'saldoNativo',round(a.amount,6)::text,'valorUsd',CASE WHEN a.valued THEN round(a.usd_amount,6)::text ELSE NULL END,
      'valoracionCompleta',a.valued,'valoracionBase','tasas_historicas','conciliacion',CASE WHEN q.pending THEN 'pendiente' ELSE 'confirmada' END,
      'disponible',a.activo AND NOT q.pending) ORDER BY a.nombre,a.id) FROM accounts a CROSS JOIN quality q),'[]'::jsonb),
    'noAsignados',coalesce((SELECT jsonb_agg(jsonb_build_object('moneda',moneda,'saldoNativo',round(amount,6)::text,'movimientos',entries) ORDER BY moneda)
      FROM unassigned),'[]'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.finanzas_lock_escritura(), public.finanzas_guard_movimiento(),
  public.finanzas_guard_nomina(), public.finanzas_guard_custodia(), public.finanzas_check_asignacion(),
  public.finanzas_check_operacion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finanzas_operar(UUID,UUID,TEXT,TEXT,JSONB,TEXT),
  public.finanzas_operacion_estado(UUID,TEXT,TEXT), public.finanzas_saldos(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_operar(UUID,UUID,TEXT,TEXT,JSONB,TEXT),
  public.finanzas_operacion_estado(UUID,TEXT,TEXT), public.finanzas_saldos(UUID) TO service_role;

COMMIT;
