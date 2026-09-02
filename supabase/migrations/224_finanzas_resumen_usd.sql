-- 224_finanzas_resumen_usd.sql
-- USD como moneda primaria del resumen financiero (regla del proyecto):
-- cada movimiento guarda la tasa USD→VES congelada al registrarse y el
-- agregado expone totales en USD, con VES como equivalente. La migración no
-- borra ni modifica movimientos existentes; los registros anteriores sin
-- tasa USD quedan contados en movimientos_sin_usd para no inflar totales.

ALTER TABLE public.finanzas_movimientos
  ADD COLUMN IF NOT EXISTS tasa_usd_ves NUMERIC(24,8)
  CHECK (tasa_usd_ves IS NULL OR tasa_usd_ves > 0);

COMMENT ON COLUMN public.finanzas_movimientos.tasa_usd_ves IS
  'Tasa USD→VES congelada al registrar; base del equivalente en USD del movimiento.';

-- VES es la moneda base: se registra con tasa fija 1:1 en vez de fingir una fuente externa.
ALTER TABLE public.finanzas_movimientos
  DROP CONSTRAINT IF EXISTS finanzas_movimientos_fuente_tasa_check;
ALTER TABLE public.finanzas_movimientos
  ADD CONSTRAINT finanzas_movimientos_fuente_tasa_check
  CHECK (fuente_tasa IN ('BCV', 'EURO', 'USDT', 'MANUAL', 'FIJA'));

DROP FUNCTION IF EXISTS public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT);

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
             WHEN m.tasa_usd_ves IS NOT NULL THEN m.monto_ves / m.tasa_usd_ves
           END
         ), 6) AS total_usd,
         count(*)::BIGINT AS movimientos,
         count(*) FILTER (WHERE m.moneda <> 'USD' AND m.tasa_usd_ves IS NULL)::BIGINT AS movimientos_sin_usd
  FROM public.finanzas_movimientos m
  WHERE m.cuenta_id = p_cuenta_id
    AND m.estado = 'activo'
    AND m.fecha BETWEEN p_desde AND p_hasta
    AND (p_moneda IS NULL OR m.moneda = p_moneda)
    AND (p_tipo IS NULL OR m.tipo = p_tipo)
    AND (p_categoria IS NULL OR m.categoria = p_categoria)
  GROUP BY m.tipo, m.categoria
  ORDER BY m.tipo, m.categoria;
$$;

REVOKE ALL ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.finanzas_resumen(UUID, DATE, DATE, TEXT, TEXT, TEXT) IS
  'Agregado server-side para reducir egress; total_usd usa la tasa USD congelada de cada movimiento.';
