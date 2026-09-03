-- 232_finanzas_resumen_multimoneda.sql
-- Mejora el cálculo de resumen financiero multimoneda para que ingresos y egresos
-- en Bolívares (VES), Dólares ($) y USDT computen correctamente tanto en vista
-- consolidada como al filtrar por moneda específica.

-- 1. Sanear movimientos históricos donde tasa_usd_ves quedó en NULL
UPDATE public.finanzas_movimientos
SET tasa_usd_ves = 804.81
WHERE moneda = 'VES' AND tasa_usd_ves IS NULL;

UPDATE public.finanzas_movimientos
SET tasa_usd_ves = 1.0
WHERE moneda IN ('USD', 'USDT') AND tasa_usd_ves IS NULL;

-- 2. Función finanzas_resumen con soporte nativo de USDT (1:1 con USD)
-- y fallback en VES para nunca descartar ingresos con $0.00
CREATE OR REPLACE FUNCTION public.finanzas_resumen(
  p_cuenta_id UUID,
  p_desde DATE,
  p_hasta DATE,
  p_moneda TEXT DEFAULT NULL,
  p_tipo TEXT DEFAULT NULL,
  p_categoria TEXT DEFAULT NULL
)
RETURNS TABLE(
  tipo TEXT,
  categoria TEXT,
  total_ves NUMERIC,
  total_usd NUMERIC,
  movimientos BIGINT,
  movimientos_sin_usd BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.tipo, m.categoria,
         round(sum(m.monto_ves), 6) AS total_ves,
         round(sum(
           CASE
             WHEN m.moneda = 'USD' THEN m.monto
             WHEN m.moneda = 'USDT' THEN m.monto
             WHEN m.tasa_usd_ves IS NOT NULL AND m.tasa_usd_ves > 0 THEN m.monto_ves / m.tasa_usd_ves
             WHEN m.moneda = 'VES' AND m.tasa_ves > 1 THEN m.monto / m.tasa_ves
             ELSE m.monto
           END
         ), 6) AS total_usd,
         count(*)::BIGINT AS movimientos,
         count(*) FILTER (WHERE m.moneda NOT IN ('USD', 'USDT') AND m.tasa_usd_ves IS NULL)::BIGINT AS movimientos_sin_usd
  FROM public.finanzas_movimientos m
  WHERE m.cuenta_id = p_cuenta_id
    AND m.estado = 'activo'
    AND m.fecha BETWEEN p_desde AND p_hasta
    AND (p_moneda IS NULL OR m.moneda = p_moneda)
    AND (p_tipo IS NULL OR m.tipo = p_tipo)
    AND (p_categoria IS NULL OR m.categoria = p_categoria)
  GROUP BY m.tipo, m.categoria;
$$;

REVOKE ALL ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT) TO authenticated, service_role;
