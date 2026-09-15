-- Lecturas privadas consistentes por versión del libro. Sin backfill de históricos.
BEGIN;
CREATE FUNCTION public.finanzas_movimientos_pagina(
  p_cuenta_id UUID, p_desde DATE, p_hasta DATE,
  p_tipo TEXT DEFAULT NULL, p_categoria TEXT DEFAULT NULL, p_moneda TEXT DEFAULT NULL,
  p_cartera TEXT DEFAULT NULL, p_anulados BOOLEAN DEFAULT false,
  p_limite INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0, p_version TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_version TEXT; total_rows BIGINT; rows_json JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 366
    OR p_limite NOT BETWEEN 1 AND 100 OR p_offset < 0 OR p_offset > 100000
    OR (p_tipo IS NOT NULL AND p_tipo NOT IN ('ingreso','egreso'))
    OR (p_moneda IS NOT NULL AND p_moneda NOT IN ('USD','VES','EUR','USDT'))
    OR (p_cartera IS NOT NULL AND p_cartera NOT IN ('USD','VES')) THEN
    RAISE EXCEPTION 'Filtros de lectura inválidos' USING ERRCODE='PT400';
  END IF;
  SELECT coalesce((SELECT version::text FROM public.finanzas_libro_version WHERE cuenta_id=p_cuenta_id),'0') INTO current_version;
  IF p_version IS NOT NULL AND p_version <> current_version THEN
    RAISE EXCEPTION 'El libro cambió. Actualiza la lista antes de continuar.' USING ERRCODE='PT409';
  END IF;
  SELECT count(*) INTO total_rows FROM public.finanzas_movimientos m
    WHERE m.cuenta_id=p_cuenta_id AND m.fecha BETWEEN p_desde AND p_hasta
      AND (p_tipo IS NULL OR m.tipo=p_tipo) AND (p_categoria IS NULL OR m.categoria=p_categoria)
      AND (p_moneda IS NULL OR m.moneda=p_moneda) AND (p_anulados OR m.estado='activo')
      AND (p_cartera IS NULL OR (p_cartera='VES' AND m.moneda='VES') OR (p_cartera='USD' AND m.moneda<>'VES'));
  SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.fecha DESC,row_data.creado_en DESC,row_data.id DESC),'[]'::jsonb)
    INTO rows_json FROM (
      SELECT m.id,m.fecha,m.tipo,m.categoria,m.concepto,m.monto,m.moneda,m.tasa_ves,m.tasa_usd_ves,m.monto_ves,
        m.fuente_tasa,m.observacion_tasa,m.tasa_registrada_en,m.referencia,m.observaciones,m.metodo_pago,m.cuenta_origen,m.cuenta_custodia_id,
        m.partes,m.estado,m.creado_en,m.anulado_en,m.motivo_anulacion,m.operacion_id,
        CASE WHEN o.tipo IS NOT NULL THEN o.tipo ELSE NULL END AS origen_operacion
      FROM public.finanzas_movimientos m LEFT JOIN public.finanzas_operaciones o ON o.id=m.operacion_id AND o.cuenta_id=m.cuenta_id
      WHERE m.cuenta_id=p_cuenta_id AND m.fecha BETWEEN p_desde AND p_hasta
        AND (p_tipo IS NULL OR m.tipo=p_tipo) AND (p_categoria IS NULL OR m.categoria=p_categoria)
        AND (p_moneda IS NULL OR m.moneda=p_moneda) AND (p_anulados OR m.estado='activo')
        AND (p_cartera IS NULL OR (p_cartera='VES' AND m.moneda='VES') OR (p_cartera='USD' AND m.moneda<>'VES'))
      ORDER BY m.fecha DESC,m.creado_en DESC,m.id DESC LIMIT p_limite OFFSET p_offset
    ) row_data;
  RETURN jsonb_build_object('movimientos',rows_json,'versionLibro',current_version,'corte',statement_timestamp(),
    'paginacion',jsonb_build_object('total',total_rows,'limit',p_limite,'offset',p_offset,'recibidos',jsonb_array_length(rows_json),
      'siguiente',CASE WHEN p_offset+jsonb_array_length(rows_json)<total_rows THEN p_offset+jsonb_array_length(rows_json) ELSE NULL END));
END;
$$;
REVOKE ALL ON FUNCTION public.finanzas_movimientos_pagina(UUID,DATE,DATE,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER,INTEGER,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_movimientos_pagina(UUID,DATE,DATE,TEXT,TEXT,TEXT,TEXT,BOOLEAN,INTEGER,INTEGER,TEXT) TO service_role;

-- Mantiene la firma de la aplicación; no inventa paridad de una tasa desconocida.
CREATE OR REPLACE FUNCTION public.finanzas_resumen(p_cuenta_id UUID,p_desde DATE,p_hasta DATE,p_moneda TEXT DEFAULT NULL,p_tipo TEXT DEFAULT NULL,p_categoria TEXT DEFAULT NULL)
RETURNS TABLE(tipo TEXT,categoria TEXT,total_ves NUMERIC,total_usd NUMERIC,total_usd_puro NUMERIC,total_usdt_puro NUMERIC,total_ves_puro NUMERIC,movimientos BIGINT,movimientos_sin_usd BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT m.tipo,m.categoria,round(sum(m.monto_ves),6),
    round(sum(CASE WHEN m.moneda='USD' THEN m.monto
      WHEN m.tasa_registrada_en IS NOT NULL AND m.tasa_ves>0 AND m.tasa_usd_ves>0 THEN m.monto_ves/m.tasa_usd_ves ELSE NULL END),6),
    round(sum(CASE WHEN m.moneda='USD' THEN m.monto ELSE 0 END),6),
    round(sum(CASE WHEN m.moneda='USDT' THEN m.monto ELSE 0 END),6),
    round(sum(CASE WHEN m.moneda='VES' THEN m.monto ELSE 0 END),6),count(*)::BIGINT,
    count(*) FILTER(WHERE m.moneda<>'USD' AND (m.tasa_registrada_en IS NULL
      OR m.tasa_ves IS NULL OR m.tasa_ves<=0 OR m.tasa_usd_ves IS NULL OR m.tasa_usd_ves<=0))::BIGINT
  FROM public.finanzas_movimientos m LEFT JOIN public.finanzas_operaciones o ON o.id=m.operacion_id AND o.cuenta_id=m.cuenta_id
  WHERE m.cuenta_id=p_cuenta_id AND m.fecha BETWEEN p_desde AND p_hasta AND m.estado='activo'
    AND (o.tipo IS NULL OR o.tipo<>'traspaso')
    AND (p_moneda IS NULL OR m.moneda=p_moneda) AND (p_tipo IS NULL OR m.tipo=p_tipo) AND (p_categoria IS NULL OR m.categoria=p_categoria)
  GROUP BY m.tipo,m.categoria;
$$;
REVOKE ALL ON FUNCTION public.finanzas_resumen(UUID,DATE,DATE,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_resumen(UUID,DATE,DATE,TEXT,TEXT,TEXT) TO service_role;

-- Un único snapshot para cartera, categorías y totales. Se conserva la función
-- anterior para consumidores autorizados sin crear firmas ambiguas.
CREATE FUNCTION public.finanzas_resumen_consistente(
  p_cuenta_id UUID, p_desde DATE, p_hasta DATE, p_moneda TEXT DEFAULT NULL,
  p_tipo TEXT DEFAULT NULL, p_categoria TEXT DEFAULT NULL, p_cartera TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result JSONB;
BEGIN
  IF p_cuenta_id IS NULL OR p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta-p_desde > 366
    OR (p_cartera IS NOT NULL AND p_cartera NOT IN ('USD','VES'))
    OR (p_moneda IS NOT NULL AND p_moneda NOT IN ('USD','VES','USDT','EUR'))
    OR (p_tipo IS NOT NULL AND p_tipo NOT IN ('ingreso','egreso')) THEN
    RAISE EXCEPTION 'Filtros de resumen inválidos' USING ERRCODE='PT400';
  END IF;
  WITH currencies AS (
    SELECT unnest(CASE WHEN p_moneda IS NOT NULL THEN ARRAY[p_moneda]
      WHEN p_cartera='USD' THEN ARRAY['USD','USDT','EUR']
      WHEN p_cartera='VES' THEN ARRAY['VES'] ELSE ARRAY[NULL::TEXT] END) AS moneda
  ), rows AS (
    SELECT r.* FROM currencies c CROSS JOIN LATERAL
      public.finanzas_resumen(p_cuenta_id,p_desde,p_hasta,c.moneda,p_tipo,p_categoria) r
    WHERE p_cartera IS NULL OR (p_cartera='VES' AND c.moneda='VES') OR (p_cartera='USD' AND c.moneda<>'VES')
  ) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM rows r),'[]'::jsonb),
    'versionLibro',coalesce((SELECT version::text FROM public.finanzas_libro_version WHERE cuenta_id=p_cuenta_id),'0'),
    'corte',statement_timestamp()) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.finanzas_resumen_consistente(UUID,DATE,DATE,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_resumen_consistente(UUID,DATE,DATE,TEXT,TEXT,TEXT,TEXT) TO service_role;
COMMIT;
