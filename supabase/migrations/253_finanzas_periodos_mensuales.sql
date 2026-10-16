-- Apertura y cierre mensual de tesorería. No crea movimientos de ingreso/egreso:
-- las aperturas son una base de saldo independiente y el libro histórico no se reescribe.
BEGIN;

CREATE OR REPLACE FUNCTION public.roles_capacidad(p_capacidad TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT CASE p_capacidad
    WHEN 'verNomina' THEN ARRAY['desarrollador','jefe','nomina']
    WHEN 'administrarNomina' THEN ARRAY['desarrollador','jefe','nomina']
    WHEN 'verFinanzas' THEN ARRAY['desarrollador','finanzas','jefe']
    WHEN 'operarFinanzas' THEN ARRAY['desarrollador','finanzas','jefe']
    WHEN 'verSaldos' THEN ARRAY['desarrollador','jefe']
    WHEN 'gestionarUsuarios' THEN ARRAY['desarrollador','jefe']
    WHEN 'administrarSistema' THEN ARRAY['desarrollador','jefe']
    WHEN 'purgarRegistros' THEN ARRAY['jefe']
    ELSE ARRAY[]::TEXT[] END;
$$;

CREATE TABLE public.finanzas_periodos_mensuales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id UUID NOT NULL REFERENCES auth.users(id),
  mes_inicio DATE NOT NULL CHECK (extract(day FROM mes_inicio)=1),
  mes_fin DATE NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('abierto','cerrado')) DEFAULT 'abierto',
  apertura_clave TEXT NOT NULL,
  apertura_hash TEXT NOT NULL,
  aperturado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  aperturado_por UUID NOT NULL REFERENCES public.usuarios(id),
  cerrado_en TIMESTAMPTZ,
  cerrado_por UUID REFERENCES public.usuarios(id),
  cierre_clave TEXT,
  cierre_hash TEXT,
  ip_apertura TEXT,
  ip_cierre TEXT,
  UNIQUE(cuenta_id,mes_inicio), UNIQUE(cuenta_id,id),
  CHECK ((estado='abierto' AND cerrado_en IS NULL AND cerrado_por IS NULL) OR
         (estado='cerrado' AND cerrado_en IS NOT NULL AND cerrado_por IS NOT NULL))
);
CREATE TABLE public.finanzas_periodos_mensuales_cuentas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id UUID NOT NULL,
  periodo_id UUID NOT NULL,
  cuenta_custodia_id UUID NOT NULL,
  moneda TEXT NOT NULL CHECK(moneda IN ('USD','VES','USDT')),
  metodo_apertura TEXT NOT NULL CHECK(metodo_apertura IN ('saldo_real','cierre_anterior','alta_cuenta')),
  fecha_inicio DATE NOT NULL,
  fecha_verificacion DATE NOT NULL,
  saldo_apertura NUMERIC(18,6) NOT NULL CHECK(saldo_apertura>=0),
  saldo_contado_apertura NUMERIC(18,6) CHECK(saldo_contado_apertura IS NULL OR saldo_contado_apertura>=0),
  diferencia_apertura NUMERIC(18,6) NOT NULL DEFAULT 0,
  motivo_apertura TEXT,
  tasa_ves NUMERIC(24,8) NOT NULL CHECK(tasa_ves>0),
  tasa_usd_ves NUMERIC(24,8) NOT NULL CHECK(tasa_usd_ves>0),
  tasa_usdt_ves NUMERIC(24,8) NOT NULL CHECK(tasa_usdt_ves>0),
  saldo_apertura_usd NUMERIC(24,6) NOT NULL CHECK(saldo_apertura_usd>=0),
  saldo_cierre_libro NUMERIC(18,6),
  saldo_cierre_real NUMERIC(18,6) CHECK(saldo_cierre_real IS NULL OR saldo_cierre_real>=0),
  diferencia_cierre NUMERIC(18,6),
  motivo_cierre TEXT,
  tasa_cierre_ves NUMERIC(24,8),
  tasa_cierre_usd_ves NUMERIC(24,8),
  tasa_cierre_usdt_ves NUMERIC(24,8),
  saldo_cierre_usd NUMERIC(24,6),
  apertura_clave TEXT,
  operacion_hash TEXT,
  cierre_clave TEXT,
  aperturado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(periodo_id,cuenta_custodia_id),
  UNIQUE(cuenta_id,periodo_id,cuenta_custodia_id),
  FOREIGN KEY(cuenta_id,periodo_id) REFERENCES public.finanzas_periodos_mensuales(cuenta_id,id),
  FOREIGN KEY(cuenta_id,cuenta_custodia_id) REFERENCES public.cuentas_custodia(cuenta_id,id)
);
CREATE INDEX finanzas_periodos_mensuales_cuenta_idx ON public.finanzas_periodos_mensuales(cuenta_id,mes_inicio DESC);
CREATE INDEX finanzas_periodos_mensuales_cuentas_wallet_idx ON public.finanzas_periodos_mensuales_cuentas(cuenta_id,cuenta_custodia_id,periodo_id);
ALTER TABLE public.finanzas_periodos_mensuales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finanzas_periodos_mensuales_cuentas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finanzas_periodos_mensuales,public.finanzas_periodos_mensuales_cuentas FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.finanzas_saldo_periodo(p_cuenta_id UUID,p_custodia_id UUID,p_fecha DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
      SELECT coalesce(sum(CASE WHEN m.tipo='ingreso' THEN m.monto ELSE -m.monto END),0),NULL
        INTO v_saldo,v_base FROM public.finanzas_movimientos m
        WHERE m.cuenta_id=p_cuenta_id AND m.cuenta_custodia_id=p_custodia_id AND m.estado='activo';
      RETURN v_saldo;
    END IF;
  END IF;
  RETURN coalesce(v_saldo,0)+coalesce((SELECT sum(CASE WHEN m.tipo='ingreso' THEN m.monto ELSE -m.monto END)
    FROM public.finanzas_movimientos m WHERE m.cuenta_id=p_cuenta_id AND m.cuenta_custodia_id=p_custodia_id
      AND m.estado='activo' AND m.fecha>=v_base AND m.fecha<=p_fecha),0);
END;
$$;

CREATE FUNCTION public.finanzas_periodo_mensual_estado(p_cuenta_id UUID,p_mes_inicio DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_period public.finanzas_periodos_mensuales%ROWTYPE; v_prev DATE; v_result JSONB; v_fin DATE;
BEGIN
  IF p_cuenta_id IS NULL OR p_mes_inicio IS NULL OR extract(day FROM p_mes_inicio)<>1 THEN
    RAISE EXCEPTION 'Invalid month' USING ERRCODE='PT400';
  END IF;
  v_fin:=(p_mes_inicio+interval '1 month - 1 day')::date; v_prev:=(p_mes_inicio-interval '1 month')::date;
  SELECT * INTO v_period FROM public.finanzas_periodos_mensuales p WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=p_mes_inicio;
  SELECT jsonb_build_object('schemaVersion',1,'mes',p_mes_inicio,'hasta',v_fin,
    'estado',coalesce(v_period.estado,'sin_apertura'),'aperturado',v_period.id IS NOT NULL,
    'cerrado',coalesce(v_period.estado='cerrado',false),'aperturadoEn',v_period.aperturado_en,
    'aperturadoPor',v_period.aperturado_por,'cerradoEn',v_period.cerrado_en,
    'cierreAnterior',coalesce((SELECT jsonb_agg(jsonb_build_object('cuentaCustodiaId',c.cuenta_custodia_id,
      'moneda',c.moneda,'saldo',c.saldo_cierre_real,'saldoUsd',c.saldo_cierre_usd) ORDER BY c.cuenta_custodia_id)
      FROM public.finanzas_periodos_mensuales p JOIN public.finanzas_periodos_mensuales_cuentas c
        ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id WHERE p.cuenta_id=p_cuenta_id
          AND p.mes_inicio=(p_mes_inicio-interval '1 month')::date AND p.estado='cerrado'),'[]'::jsonb),
    'cuentas',coalesce((SELECT jsonb_agg(jsonb_build_object('cuentaCustodiaId',a.id,'nombre',a.nombre,'moneda',a.moneda,
      'activo',a.activo,'saldoHistorico',coalesce(h.saldo,0)::text,'movimientosMes',coalesce(m.neto,0)::text,
      'movimientosMesCantidad',coalesce(m.total,0),'saldoCierreAnterior',pc.saldo_cierre_real,
      'saldoApertura',fc.saldo_apertura,'saldoCalculado',CASE WHEN fc.id IS NOT NULL THEN
        public.finanzas_saldo_periodo(p_cuenta_id,a.id,least(current_date,v_fin)) ELSE NULL END,
      'metodoApertura',fc.metodo_apertura,'saldoContadoApertura',fc.saldo_contado_apertura,
      'saldoAperturaUsd',fc.saldo_apertura_usd,'tasaVes',fc.tasa_ves,'tasaUsdVes',fc.tasa_usd_ves,'tasaUsdtVes',fc.tasa_usdt_ves,
      'diferenciaApertura',fc.diferencia_apertura,'saldoCierreReal',fc.saldo_cierre_real,
      'saldoCierreLibro',fc.saldo_cierre_libro,'diferenciaCierre',fc.diferencia_cierre,'motivoCierre',fc.motivo_cierre,
      'saldoCierreUsd',fc.saldo_cierre_usd,'tasaCierreUsdVes',fc.tasa_cierre_usd_ves,'tasaCierreUsdtVes',fc.tasa_cierre_usdt_ves,
      'saldoUsadoApertura',CASE WHEN fc.id IS NOT NULL THEN fc.saldo_apertura
        WHEN pc.saldo_cierre_real IS NOT NULL THEN pc.saldo_cierre_real ELSE NULL END,
      'saldoUsdUsadoApertura',CASE WHEN fc.id IS NOT NULL THEN fc.saldo_apertura_usd
        WHEN pc.saldo_cierre_usd IS NOT NULL THEN pc.saldo_cierre_usd ELSE NULL END,
      'fechaInicioUsada',CASE WHEN fc.id IS NOT NULL THEN fc.fecha_inicio
        WHEN pc.saldo_cierre_real IS NOT NULL THEN p_mes_inicio ELSE NULL END,
      'origenSaldo',CASE WHEN fc.metodo_apertura='alta_cuenta' THEN 'alta_cuenta'
        WHEN fc.id IS NOT NULL THEN fc.metodo_apertura
        WHEN pc.saldo_cierre_real IS NOT NULL THEN 'cierre_anterior'
        ELSE 'saldo_historico' END)
      ORDER BY a.nombre,a.id) FROM public.cuentas_custodia a
      LEFT JOIN LATERAL (SELECT sum(CASE WHEN x.tipo='ingreso' THEN x.monto ELSE -x.monto END) saldo
        FROM public.finanzas_movimientos x WHERE x.cuenta_id=p_cuenta_id AND x.cuenta_custodia_id=a.id AND x.estado='activo') h ON true
      LEFT JOIN LATERAL (SELECT sum(CASE WHEN x.tipo='ingreso' THEN x.monto ELSE -x.monto END) neto,count(*) total
        FROM public.finanzas_movimientos x WHERE x.cuenta_id=p_cuenta_id AND x.cuenta_custodia_id=a.id
          AND x.estado='activo' AND x.fecha BETWEEN p_mes_inicio AND least(current_date,v_fin)) m ON true
      LEFT JOIN public.finanzas_periodos_mensuales_cuentas pc ON pc.cuenta_id=p_cuenta_id
        AND pc.periodo_id=(SELECT p.id FROM public.finanzas_periodos_mensuales p WHERE p.cuenta_id=p_cuenta_id
          AND p.mes_inicio=(p_mes_inicio-interval '1 month')::date AND p.estado='cerrado')
        AND pc.cuenta_custodia_id=a.id
      LEFT JOIN public.finanzas_periodos_mensuales_cuentas fc ON fc.cuenta_id=p_cuenta_id AND fc.periodo_id=v_period.id AND fc.cuenta_custodia_id=a.id
      WHERE a.cuenta_id=p_cuenta_id AND (a.activo OR fc.id IS NOT NULL)),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.finanzas_periodo_mensual_operar(
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
    IF EXISTS(SELECT 1 FROM public.finanzas_movimientos m WHERE m.cuenta_id=p_cuenta_id AND m.fecha>=p_mes_inicio
      AND m.fecha<=(p_mes_inicio+interval '1 month - 1 day')::date AND m.estado='activo'
      AND m.cuenta_custodia_id IS NULL) THEN
      RAISE EXCEPTION 'Reconcile movements without a custody wallet before opening the month' USING ERRCODE='PT409';
    END IF;
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
        apertura:=real_amount-neto; base_day:=p_mes_inicio;
        IF apertura<0 THEN RAISE EXCEPTION 'Calculated opening balance cannot be negative' USING ERRCODE='PT400'; END IF;
        diff:=CASE WHEN anterior IS NULL THEN 0 ELSE apertura-anterior END;
        IF abs(diff)>0.000001 AND (note IS NULL OR length(note)<8 OR length(note)>300) THEN
          RAISE EXCEPTION 'Explain difference from previous closing balance' USING ERRCODE='PT400';
        END IF;
      ELSE RAISE EXCEPTION 'Invalid opening method' USING ERRCODE='PT400'; END IF;
      IF anterior IS NOT NULL AND apertura<anterior THEN
        RAISE EXCEPTION 'Opening balance cannot reduce confirmed funds' USING ERRCODE='PT409';
      END IF;
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
    INSERT INTO public.finanzas_periodos_mensuales_cuentas(cuenta_id,periodo_id,cuenta_custodia_id,moneda,metodo_apertura,
      fecha_inicio,fecha_verificacion,saldo_apertura,saldo_contado_apertura,tasa_ves,tasa_usd_ves,tasa_usdt_ves,saldo_apertura_usd,motivo_apertura,apertura_clave,operacion_hash)
    VALUES(p_cuenta_id,periodo.id,row_data.id,row_data.moneda,'alta_cuenta',current_date,current_date,real_amount,real_amount,
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
  IF EXISTS(SELECT 1 FROM public.cuentas_custodia a WHERE a.cuenta_id=p_cuenta_id AND a.activo
    AND NOT EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales_cuentas c WHERE c.cuenta_id=p_cuenta_id
      AND c.periodo_id=periodo.id AND c.cuenta_custodia_id=a.id)) THEN
    RAISE EXCEPTION 'Every active wallet must have a monthly opening before close' USING ERRCODE='PT409';
  END IF;
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
    IF abs(diff)>0.000001 AND (note IS NULL OR length(note)<8 OR length(note)>300) THEN
      RAISE EXCEPTION 'Explain each closing difference' USING ERRCODE='PT400';
    END IF;
    IF diff<0 THEN RAISE EXCEPTION 'Closing balance cannot reduce confirmed funds' USING ERRCODE='PT409'; END IF;
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

-- Saldos confirmados usan apertura del período vigente + actividad del mes.
ALTER FUNCTION public.finanzas_saldos(UUID) RENAME TO finanzas_saldos_historicos;
CREATE FUNCTION public.finanzas_saldos(p_cuenta_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result JSONB; item JSONB; accounts JSONB:='[]'::jsonb; amount NUMERIC; usd_value NUMERIC; base_usd NUMERIC;
  usd_rate NUMERIC; usdt_rate NUMERIC; has_opening BOOLEAN; month_start DATE:=date_trunc('month',current_date)::date; pending BOOLEAN;
BEGIN
  result:=public.finanzas_saldos_historicos(p_cuenta_id);
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(result->'cuentas','[]'::jsonb)) LOOP
    amount:=public.finanzas_saldo_periodo(p_cuenta_id,(item->>'cuentaCustodiaId')::uuid,current_date);
    SELECT EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales p JOIN public.finanzas_periodos_mensuales_cuentas c
      ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id WHERE p.cuenta_id=p_cuenta_id
        AND p.mes_inicio=month_start AND p.estado='abierto' AND c.cuenta_custodia_id=(item->>'cuentaCustodiaId')::uuid)
      INTO has_opening;
    base_usd:=NULL; usd_rate:=NULL; usdt_rate:=NULL;
    IF has_opening THEN
      SELECT c.saldo_apertura_usd,c.tasa_usd_ves,c.tasa_usdt_ves INTO base_usd,usd_rate,usdt_rate
        FROM public.finanzas_periodos_mensuales p JOIN public.finanzas_periodos_mensuales_cuentas c
          ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id
        WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=month_start AND p.estado='abierto'
          AND c.cuenta_custodia_id=(item->>'cuentaCustodiaId')::uuid;
    ELSIF NOT EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales p WHERE p.cuenta_id=p_cuenta_id
      AND p.mes_inicio=month_start AND p.estado='abierto') THEN
      SELECT c.saldo_cierre_usd,c.tasa_cierre_usd_ves,c.tasa_cierre_usdt_ves INTO base_usd,usd_rate,usdt_rate
        FROM public.finanzas_periodos_mensuales p JOIN public.finanzas_periodos_mensuales_cuentas c
          ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id
        WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=(month_start-interval '1 month')::date
          AND p.estado='cerrado' AND c.cuenta_custodia_id=(item->>'cuentaCustodiaId')::uuid;
    END IF;
    IF has_opening THEN
      SELECT c.saldo_apertura_usd,c.tasa_usd_ves,c.tasa_usdt_ves INTO base_usd,usd_rate,usdt_rate
        FROM public.finanzas_periodos_mensuales p JOIN public.finanzas_periodos_mensuales_cuentas c
          ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id
        WHERE p.cuenta_id=p_cuenta_id AND p.mes_inicio=month_start AND p.estado='abierto'
          AND c.cuenta_custodia_id=(item->>'cuentaCustodiaId')::uuid;
      SELECT coalesce(sum(CASE WHEN m.tipo='ingreso' THEN 1 ELSE -1 END * CASE WHEN m.moneda='USD' THEN m.monto
        WHEN m.moneda IN ('VES','USDT') AND m.tasa_registrada_en IS NOT NULL AND m.tasa_ves>0 AND m.tasa_usd_ves>0 THEN m.monto_ves/m.tasa_usd_ves
        WHEN m.moneda='VES' AND usd_rate>0 THEN m.monto/usd_rate
        WHEN m.moneda='USDT' AND usd_rate>0 AND usdt_rate>0 THEN m.monto*usdt_rate/usd_rate
        ELSE 0 END),0)
        INTO usd_value FROM public.finanzas_movimientos m WHERE m.cuenta_id=p_cuenta_id
          AND m.cuenta_custodia_id=(item->>'cuentaCustodiaId')::uuid AND m.estado='activo'
          AND m.fecha>=month_start AND m.fecha<=current_date;
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

CREATE OR REPLACE FUNCTION public.finanzas_guard_saldo_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_wallet UUID; v_month DATE; v_state TEXT; v_balance NUMERIC; v_i INT; v_currency TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(238,1);
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.cuenta_id::text,251));
  FOR v_i IN 1..2 LOOP
    IF v_i=1 THEN v_wallet:=NEW.cuenta_custodia_id; v_currency:=NEW.moneda; v_month:=date_trunc('month',NEW.fecha)::date;
    ELSIF TG_OP='UPDATE' AND (OLD.cuenta_custodia_id IS DISTINCT FROM NEW.cuenta_custodia_id OR OLD.moneda<>NEW.moneda OR OLD.fecha<>NEW.fecha) THEN
      v_wallet:=OLD.cuenta_custodia_id; v_currency:=OLD.moneda; v_month:=date_trunc('month',OLD.fecha)::date;
    ELSE EXIT; END IF;
    CONTINUE WHEN v_wallet IS NULL;
    SELECT p.estado INTO v_state FROM public.finanzas_periodos_mensuales p WHERE p.cuenta_id=NEW.cuenta_id AND p.mes_inicio=v_month;
    IF v_state='cerrado' THEN RAISE EXCEPTION 'Closed monthly ledger is immutable' USING ERRCODE='PT409'; END IF;
    -- Durante el mes sin apertura se permiten registrar movimientos; el wizard revisa
    -- esos asientos. No aplicar el saldo histórico negativo como bloqueo provisional.
    IF v_state IS NULL AND v_month=date_trunc('month',current_date)::date THEN CONTINUE; END IF;
    IF v_state='abierto' THEN
      IF NOT EXISTS(SELECT 1 FROM public.finanzas_periodos_mensuales p JOIN public.finanzas_periodos_mensuales_cuentas c
        ON c.cuenta_id=p.cuenta_id AND c.periodo_id=p.id WHERE p.cuenta_id=NEW.cuenta_id
          AND p.mes_inicio=v_month AND c.cuenta_custodia_id=v_wallet) THEN
        RAISE EXCEPTION 'Wallet must be opened before recording monthly movements' USING ERRCODE='PT409';
      END IF;
      v_balance:=public.finanzas_saldo_periodo(NEW.cuenta_id,v_wallet,least(v_month+interval '1 month - 1 day',current_date)::date);
      IF v_balance<0 THEN RAISE EXCEPTION 'Insufficient monthly wallet balance' USING ERRCODE='PT402',DETAIL='FINANCIAL_INSUFFICIENT_FUNDS'; END IF;
    ELSE
      SELECT coalesce(sum(public.finanzas_aporte_saldo(m.tipo,m.monto,m.estado)),0) INTO v_balance FROM public.finanzas_movimientos m
        WHERE m.cuenta_id=NEW.cuenta_id AND m.cuenta_custodia_id=v_wallet AND m.moneda=v_currency AND m.estado='activo';
      IF v_balance<0 THEN RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE='PT402',DETAIL='FINANCIAL_INSUFFICIENT_FUNDS'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.finanzas_saldo_periodo(UUID,UUID,DATE),
  public.finanzas_periodo_mensual_estado(UUID,DATE),
  public.finanzas_periodo_mensual_operar(UUID,UUID,TEXT,DATE,TEXT,JSONB,TEXT),
  public.finanzas_guard_saldo_movement() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.finanzas_saldos(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_periodo_mensual_estado(UUID,DATE),
  public.finanzas_periodo_mensual_operar(UUID,UUID,TEXT,DATE,TEXT,JSONB,TEXT),
  public.finanzas_saldos(UUID) TO service_role;
COMMIT;
