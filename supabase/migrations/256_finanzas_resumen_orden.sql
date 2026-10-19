-- 256_finanzas_resumen_orden.sql
-- Restaura el orden determinista del agregado financiero. Las versiones 221/223
-- traían ORDER BY tipo, categoria; la 232 (multimoneda) reemplazó la función sin
-- él y las 233/239 heredaron la omisión: el "mes a mes" podía volver en distinto
-- orden entre corridas. Esta migración SOLO agrega el ORDER BY al cuerpo vigente
-- (el de la 239: desglose por moneda, filtro de traspasos y tasa_registrada_en);
-- ni la firma, ni el retorno, ni los permisos cambian.
BEGIN;

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
  GROUP BY m.tipo,m.categoria
  ORDER BY m.tipo,m.categoria;
$$;

COMMENT ON FUNCTION public.finanzas_resumen(UUID,DATE,DATE,TEXT,TEXT,TEXT) IS
  'Agregado server-side para reducir egress; solo el Worker service-role debe invocarlo. Filas ordenadas por tipo y categoria.';

REVOKE ALL ON FUNCTION public.finanzas_resumen(UUID,DATE,DATE,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_resumen(UUID,DATE,DATE,TEXT,TEXT,TEXT) TO service_role;

COMMIT;
